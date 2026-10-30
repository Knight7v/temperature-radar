'use strict';

// 把「产品卖点」接回「客服会话」，给出具体怎么答。
//
// 分两步，顺序不能反：
//   1. 确定性骨架：顾客这句话提到了哪个卖点/参数（关键词命中），客服下一条回复里有没有这个事实
//      （参数值是否出现、卖点标题是否出现）。这一步不花钱、可复现，是「覆盖率」的唯一来源。
//   2. 模型写话：只让它把骨架翻译成能直接发给顾客的一句话，并说明缺在哪。
//
// 防幻觉三道闸：
//   · 建议必须挂 factRef（知识库条目名），挂不上的丢弃；
//   · messageId 必须是真实顾客消息，挂不上的按 factRef 回落到骨架里的那条；
//   · 建议里出现的数字，必须能在知识库或会话原文里找到，否则标「待核实」，不当成事实展示。

const client = require('../quality/ai/client');
const { productFacts, compactForPrompt } = require('./extract');

const VERSION = 'product-advice-v1';
const MAX_ITEMS = 6;

const norm = value => String(value == null ? '' : value).replace(/\s+/g, '');
const plain = (value, max) => {
  const clean = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return max && clean.length > max ? clean.slice(0, max) : clean;
};

const numbersIn = value => {
  const out = new Set();
  for (const hit of String(value == null ? '' : value).match(/\d+(?:\.\d+)?/g) || []) {
    out.add(String(Number(hit)));
  }
  return out;
};

/** 这条消息是不是在问这个事实：参数看名字，卖点看标题或关键词 */
function mentionsFact(text, fact) {
  const body = String(text || '');
  if (!body) return false;
  return (fact.keywords || []).some(word => word && word.length >= 2 && body.includes(word));
}

/** 客服回复有没有真的答到这个事实 */
function coversFact(replyText, fact) {
  const reply = String(replyText || '');
  if (!reply) return false;
  if (fact.kind === 'param') {
    const value = norm(fact.value);
    if (!value) return false;
    // 参数值必须原样出现（含单位），避免「说有 3500 但其实是制冷量 3500W」这种擦边
    if (norm(reply).includes(value)) return true;
    const bare = norm(fact.value).replace(/[a-zA-Z%℃°()（）/]+/g, '');
    return bare.length >= 2 && norm(reply).includes(bare);
  }
  // 卖点/售后：标题或任一关键词出现就算说到了，具体好不好由模型判断
  if (norm(reply).includes(norm(fact.label))) return true;
  return (fact.keywords || []).some(word => word && norm(reply).includes(norm(word)));
}

/**
 * 骨架：顾客提到的每个事实 → 客服接下来那条回复 → 答没答到。
 * 只取前 6 条，按「有没有答到」排序，没答到的排前面（那才是要改的）。
 */
function buildSkeleton({ messages, product }) {
  const list = Array.isArray(messages) ? messages.filter(item => String(item?.text || '').trim()) : [];
  const facts = productFacts(product);
  const items = [];

  for (let index = 0; index < list.length; index += 1) {
    const message = list[index];
    if (message.role !== 'customer') continue;
    const body = String(message.text || '');
    const touched = facts.filter(fact => mentionsFact(body, fact));
    if (!touched.length) continue;

    // 顾客这条之后的第一条客服消息，就是这条提问的答复
    const reply = list.slice(index + 1).find(item => item.role === 'agent') || null;
    const replyText = reply ? String(reply.text || '') : '';
    const judged = touched.map(fact => ({
      kind: fact.kind,
      label: fact.label,
      value: fact.value,
      stage: fact.stage,
      covered: coversFact(replyText, fact)
    }));

    items.push({
      messageId: message.id,
      askText: plain(body, 80),
      replyMessageId: reply ? reply.id : null,
      replyText: plain(replyText, 120),
      facts: judged,
      coveredCount: judged.filter(item => item.covered).length,
      totalCount: judged.length
    });
    if (items.length >= MAX_ITEMS) break;
  }

  const totalFacts = items.reduce((sum, item) => sum + item.totalCount, 0);
  const coveredFacts = items.reduce((sum, item) => sum + item.coveredCount, 0);
  return {
    items: items.sort((a, b) => a.coveredCount / a.totalCount - b.coveredCount / b.totalCount),
    stats: {
      asks: items.length,
      totalFacts,
      coveredFacts,
      missedFacts: totalFacts - coveredFacts,
      coverage: totalFacts ? Math.round((coveredFacts / totalFacts) * 1000) / 10 : null,
      noReply: items.filter(item => !item.replyMessageId).length
    }
  };
}

const SYSTEM_PROMPT = `你是空调电商团队的客服教练。手上有两样东西：这台机器的产品资料（外观/卖点/参数/售后口径，均已从详情页核验过），和一段真实的客服会话。你的任务是：指出客服在回答这台机器时哪里没答到位，并给出可以直接发给顾客的改法。

硬性要求：
1. 只纠正与「产品事实」有关的地方：参数说错、卖点漏说、政策口径含糊、顾客问 A 答 B。不要评价语气、态度、响应速度，也不要给人打分。
2. 建议里提到的任何参数、政策、价格、时效，必须来自给定的产品资料原文。资料里没有的，一律不写。宁可建议"告知顾客以详情页为准"，也不要编一个数字。
3. 每条问题必须挂 factRef：产品资料里的条目名（如"噪音"、"自清洁"、"整机保修"）。挂不上任何条目的，不要输出。
4. messageId 必须是会话里真实存在的顾客消息编号，指向最体现这个问题的提问。
5. verdict 判定：
   · missing = 顾客问到了，客服完全没提这条事实；
   · wrong = 客服说的与产品资料冲突（数值不符、型号说错、政策说错）；
   · vague = 提了，但没有给顾客能用来决策的具体信息（如只说"很静音"没给噪音值）；
   · covered = 已经答对了。只有确实答得好才用，不要为了凑条数把 covered 写成 missing。
6. suggestedReply 是可以直接复制发给顾客的中文口语，1-2 句，不超过 70 字。不要用"亲"以外的平台话术，不要写"建议您咨询客服"这种空话。
7. 顾客问的是别的事（物流、催发货、价格优惠），不要硬扯产品卖点；这类问题不输出。
8. 最多 6 条，按严重程度排序（说错 > 没提 > 含糊）。没有需要改的就输出空数组，并在 summary 里说明答得可以。
9. 严格输出 JSON，不要 Markdown 代码块，不要解释文字。

输出 JSON：
{
 "summary": "不超过 60 字：这段会话在产品信息上最该改的一点",
 "items": [
  {
   "messageId": 0,
   "factRef": "产品资料里的条目名",
   "verdict": "missing | wrong | vague | covered",
   "why": "不超过 40 字：缺什么或错在哪",
   "suggestedReply": "不超过 70 字：可以直接发给顾客的说法",
   "severity": "high | medium | low"
  }
 ]
}`;

function buildMessages({ session, product, skeleton }) {
  const transcript = (Array.isArray(session?.messages) ? session.messages : [])
    .filter(item => String(item?.text || '').trim())
    .slice(0, 80)
    .map(item => `[#${item.id}][${item.role === 'agent' ? '客服' : '顾客'}][${item.at || ''}] ${String(item.text).slice(0, 300)}`)
    .join('\n');

  const skeletonText = skeleton.items
    .map(item => {
      const facts = item.facts.map(fact => `${fact.label}=${fact.value}（${fact.covered ? '已答到' : '没答到'}）`).join('；');
      return `- 顾客 #${item.messageId}「${item.askText}」→ 客服 ${item.replyMessageId ? '#' + item.replyMessageId : '无回复'}；涉及：${facts}`;
    })
    .join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `## 产品资料（型号 ${product.model || '未知'}）`,
        compactForPrompt(product),
        '',
        '## 会话原文',
        transcript,
        '',
        '## 程序先算出的对照（顾客提到的卖点/参数，客服有没有答到）',
        skeletonText || '（会话里没有提到产品资料中的任何卖点或参数）',
        '',
        '请只针对上面「没答到」或「答错」的事实给建议；如果都答到了，返回空数组。'
      ].join('\n')
    }
  ];
}

const VERDICTS = new Set(['missing', 'wrong', 'vague', 'covered']);
const SEVERITIES = new Set(['high', 'medium', 'low']);

/** 整段会话里，客服到底有没有在某一处答到这个事实 */
function messagesCoverFact(messages, fact) {
  return (Array.isArray(messages) ? messages : []).some(
    item => item.role === 'agent' && coversFact(item.text, fact)
  );
}

/**
 * 核验模型输出：
 *  - messageId 必须落在真实顾客消息上，找不到就按 factRef 回落到骨架里那条；
 *  - factRef 必须能对上知识库条目，对不上就丢；
 *  - 建议里出现知识库/会话里都没有的数字 → 标 needsReview（仍然展示，但不当作事实）。
 */
function verifyAdvice(raw, { session, product, skeleton }) {
  const warnings = [];
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const byId = new Map(messages.map(item => [Number(item.id), item]));
  const facts = productFacts(product);
  const factByName = new Map(facts.map(fact => [norm(fact.label).toLowerCase(), fact]));
  const knownNumbers = new Set([
    ...numbersIn(compactForPrompt(product)),
    ...numbersIn(messages.map(item => item.text).join('\n'))
  ]);

  const items = [];
  const seen = new Set();
  let dropped = 0;
  let offTopic = 0;
  let alreadyAnswered = 0;
  for (const item of Array.isArray(raw?.items) ? raw.items : []) {
    if (items.length >= MAX_ITEMS) break;
    const factRef = plain(item?.factRef, 16);
    const fact = factByName.get(norm(factRef).toLowerCase()) || null;
    if (!fact) {
      dropped += 1;
      continue;
    }
    let messageId = Number(item?.messageId);
    let message = byId.get(messageId);
    if (!message || message.role !== 'customer') {
      const fallback = skeleton.items.find(entry => entry.facts.some(one => norm(one.label) === norm(fact.label)));
      message = fallback ? byId.get(Number(fallback.messageId)) : null;
      if (message) messageId = Number(message.id);
    }
    if (!message) {
      dropped += 1;
      continue;
    }
    /* 顾客那条必须真的提过这件事。模型有时会为了凑建议，把「问插座」当场
       「没讲变频省电」的证据——这种硬扯一律丢掉，宁缺毋滥。 */
    if (!mentionsFact(message.text, fact)) {
      const fallback = skeleton.items.find(entry => entry.facts.some(one => norm(one.label) === norm(fact.label)));
      const alt = fallback ? byId.get(Number(fallback.messageId)) : null;
      if (alt && alt.role === 'customer' && mentionsFact(alt.text, fact)) {
        message = alt;
        messageId = Number(alt.id);
      } else {
        offTopic += 1;
        continue;
      }
    }

    const verdict = VERDICTS.has(item?.verdict) ? item.verdict : 'missing';
    const suggestedReply = plain(item?.suggestedReply, 120);
    if (verdict === 'covered') continue;

    /* 同一个卖点只留一条：模型偶尔对两处提问各写一遍，看的人会以为是两个问题 */
    const factKey = norm(fact.label).toLowerCase();
    if (seen.has(factKey)) continue;

    /* 「没答到」要真的整段会话都没答到。客服在前面已经讲过、顾客又问了一次的，
       建议补一句可以，但不能说成「没答」——那会让主管觉得工具没看上下文。 */
    if (verdict === 'missing' && messagesCoverFact(messages, fact)) {
      alreadyAnswered += 1;
      continue;
    }
    seen.add(factKey);

    const unknownNumbers = [...numbersIn(suggestedReply)].filter(value => !knownNumbers.has(value));
    if (unknownNumbers.length) {
      warnings.push(`建议里出现资料中没有的数字（${unknownNumbers.join('、')}），已标待核实`);
    }

    items.push({
      messageId,
      askText: plain(message.text, 80),
      factRef: fact.label,
      factKind: fact.kind,
      factValue: fact.value,
      verdict,
      why: plain(item?.why, 60),
      suggestedReply,
      severity: SEVERITIES.has(item?.severity) ? item.severity : 'medium',
      needsReview: unknownNumbers.length > 0
    });
  }
  if (dropped) warnings.push(`${dropped} 条建议挂不上产品资料里的条目，已丢弃`);
  if (offTopic) warnings.push(`${offTopic} 条建议对应的顾客原话没提到这件事（硬扯），已丢弃`);
  if (alreadyAnswered) warnings.push(`${alreadyAnswered} 条在会话别处已经答到了，没有算作「没答」`);

  const needFix = items.filter(item => item.verdict !== 'covered').length;
  return {
    summary: plain(raw?.summary, 80),
    items,
    warnings,
    stats: { ...skeleton.stats, suggested: items.length, needFix }
  };
}

/** 没 Key / 调不通时的兜底：直接把「没答到的参数/卖点」写成一句提醒，不编内容 */
function fallbackAdvice({ skeleton, product, messages }) {
  const items = [];
  const seen = new Set();
  for (const entry of skeleton.items) {
    for (const fact of entry.facts) {
      if (fact.covered) continue;
      const factKey = norm(fact.label).toLowerCase();
      if (seen.has(factKey)) continue;
      if (messagesCoverFact(messages, fact)) continue;
      seen.add(factKey);
      items.push({
        messageId: entry.messageId,
        askText: entry.askText,
        factRef: fact.label,
        factKind: fact.kind,
        factValue: fact.value,
        verdict: 'missing',
        why: entry.replyMessageId ? '客服回复里没有提到这条产品信息' : '顾客这条没有任何回复',
        suggestedReply: `${fact.label}：${fact.value}。`,
        severity: fact.kind === 'param' ? 'high' : 'medium',
        needsReview: false
      });
      if (items.length >= MAX_ITEMS) break;
    }
    if (items.length >= MAX_ITEMS) break;
  }
  return {
    summary: items.length
      ? `有 ${items.length} 处产品信息没答到，建议按后面的说法补上（未配置 AI，只做关键词对照）。`
      : '顾客提到的卖点/参数都答到了。',
    items,
    warnings: ['未配置 DeepSeek API Key，本条建议由关键词对照生成，没有经过模型改写'],
    stats: { ...skeleton.stats, suggested: items.length, needFix: items.length },
    aiUsed: false
  };
}

/**
 * 生成一条会话的产品修正建议。AI 可用走模型，不可用/失败走兜底（失败时带上原因）。
 */
async function adviseSession({ session, product, options = {} }) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const skeleton = buildSkeleton({ messages, product });
  const base = {
    version: VERSION,
    sessionId: session?.id || null,
    productId: product?.id || null,
    model: product?.model || '',
    generatedAt: new Date().toISOString()
  };

  if (!skeleton.items.length) {
    return {
      ...base,
      aiUsed: false,
      summary: '这段会话没有提到这台机器的卖点或参数，不做产品层面的纠正。',
      items: [],
      warnings: [],
      stats: { ...skeleton.stats, suggested: 0, needFix: 0 }
    };
  }

  if (!client.configured()) {
    return { ...base, ...fallbackAdvice({ skeleton, product, messages }), usage: null };
  }

  try {
    const built = buildMessages({ session, product, skeleton });
    const result = await client.chatWithRetry(
      { messages: built, maxTokens: 2000, temperature: 0.15, signal: options.signal },
      { retries: 1 }
    );
    const raw = client.parseJson(result.content);
    const verified = verifyAdvice(raw, { session, product, skeleton });
    return {
      ...base,
      aiUsed: true,
      summary: verified.summary || '模型未给出总结。',
      items: verified.items,
      warnings: verified.warnings,
      stats: verified.stats,
      modelName: result.model,
      usage: result.usage
    };
  } catch (error) {
    const fallback = fallbackAdvice({ skeleton, product, messages });
    return {
      ...base,
      ...fallback,
      warnings: [`AI 建议生成失败（${error.message}），已退回关键词对照`, ...fallback.warnings],
      usage: null
    };
  }
}

module.exports = {
  VERSION,
  numbersIn,
  mentionsFact,
  coversFact,
  buildSkeleton,
  verifyAdvice,
  fallbackAdvice,
  adviseSession
};
