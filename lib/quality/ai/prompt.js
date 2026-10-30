'use strict';

const { CATEGORIES, applicableCriteria, RUBRIC_VERSION } = require('./rubric');
const { conversationFacts, sensitiveMentions } = require('./facts');
const { shortReplyStats, detectKeywordSignals, renderKeywordBriefing } = require('./keywords');
const { detectLinkSignals, renderLinkBriefing } = require('./link-policy');

// 脱敏：手机号、长数字串、连续微信号等替换为等长星号。
// 等长替换很重要——原文与提示词用同一套规则，证据引文才能继续做子串校验。
const MASK_RULES = [
  /(?<!\d)(1[3-9]\d{9})(?!\d)/g,
  /(?<!\d)(\d{6,})(?!\d)/g
];

function mask(text) {
  let output = String(text ?? '');
  for (const rule of MASK_RULES) output = output.replace(rule, match => '*'.repeat(match.length));
  return output;
}

const MAX_MESSAGES = 80;

function renderTranscript(session) {
  const messages = Array.isArray(session?.messages) ? session.messages.filter(item => String(item?.text || '').trim()) : [];
  const truncated = messages.length > MAX_MESSAGES;
  let list = messages;
  if (truncated) {
    const head = messages.slice(0, 40);
    const tail = messages.slice(-40);
    list = [...head, { id: -1, role: 'system', at: '', speaker: '', text: `（中间 ${messages.length - 80} 条消息已省略）` }, ...tail];
  }
  return {
    truncated,
    totalMessages: messages.length,
    text: list.map(item => {
      if (item.role === 'system') return item.text;
      const role = item.role === 'agent' ? '客服' : '顾客';
      return `[#${item.id}][${role}][${item.at}] ${mask(item.text)}`;
    }).join('\n')
  };
}

function ruleSpec(criteria) {
  return criteria.map(item => {
    const spec = {
      id: item.id,
      label: item.label,
      level: item.kind === 'fatal' ? '红线（命中即 0 分）' : item.kind === 'critical' ? '关键项（一票否决，扣 70 分）' : '非关键项（5/3/1 分，共 30 分）',
      definition: item.definition
    };
    if (item.failWhen?.length) spec.failWhen = item.failWhen;
    if (item.passWhen?.length) spec.passWhen = item.passWhen;
    if (item.scoring) spec.scoring = item.scoring;
    if (item.naWhen?.length) spec.naWhen = item.naWhen;
    return spec;
  });
}

const SYSTEM_PROMPT = `你是空调电商（格力/海尔，京东与天猫）客服质检员。你只做两件事：判断每一项质检规则是否合格，并给出原文证据。你不计算分数——分数由系统按固定公式计算。

硬性要求：
1. 只依据给定会话内容判断，不得引入任何外部知识、行业惯例或"通常会怎样"的推测。
2. 标记为"未合格"（fail）时，必须给出至少 1 条证据：messageId 必须是会话中真实存在的编号，quote 必须是该条消息原文的连续片段（可以直接复制，不要改写、不要拼接）。
3. 证据不足、会话未涉及、或需要后台/订单系统才能确认时，判定为"不适用"（na），不要猜。
4. 顾客没有明确表达不满，就不要判"服务礼仪"或"投诉与敏感诉求"不合格。
5. confidence 表示你对本次判定的把握程度（0-1）。证据明确给 0.9 以上；靠推断给 0.5-0.7；没把握给 0.3 以下并用 na。
6. 不要因为会话很短、顾客只回了"哦""好"就判客服不合格。
7. 严格输出 JSON，不要输出解释文字、不要用 Markdown 代码块。

判定尺度（很重要，直接影响分数是否可用）：
8. 默认立场是"合格"。只有能从原文指出具体缺陷（能引出一句话说明问题）时才判 fail；凭"本可以做得更好""不够主动"这类推测，不得判 fail。
9. 关键项 fail 是重罚（直接扣掉 70 分），必须满足"顾客诉求明确受损或平台规则明确被违反"，且证据里能看到这个缺陷。顾客没追问、没表达不满、问题已得到答复的，一律 pass。
10. 非关键项默认给 5 分。只有明确缺失（如完全没有开场白）或明显粗糙（如大段模板复制、错别字多）才降到 3 分；1 分只用于该行为完全不存在。
11. 校准基线：真实抽检中约七成会话应达到 85 分以上，关键项不合格（D 级）通常不超过两成。如果你的判定让过半会话都不及格，说明尺度偏严，请回头复核——多数情况下顾客的诉求其实已经被回答了。

新增三条口径的专门要求（v3）：
12. 好评返现看"对价关系"，不看单个词。判定"平台高压线"不合格，必须能看到"给钱"与"要好评/晒图/五星/评价"构成交换关系。以下三种情况一律判 pass：
    · 售后补偿——顾客要求赔偿、投诉、或商品有问题，客服说"给您返现/补偿"，但没提好评、晒图、五星、评价；
    · 优惠答疑——顾客问有没有优惠、能否便宜、有没有活动，客服介绍返现或红包活动，但没要求顾客先给好评；
    · 顾客主动提返现，客服拒绝或未答应。
    只出现"返现""红包""补偿"而没绑定好评的，最多判 na，不得判 fail。
13. 站外导流只算客服主动引导。顾客说"我加你微信"、客服回"好的"不算；客服说"加我微信""私我""扫码""线下交易""私下转账"才算。若客服明确拒绝站外方式、引导回平台，判 pass。注意区分：顾客骂人时客服说"别急"这类否定表述不算引导。
14. 链接与外店导流看"归属 + 话术"，不看有没有链接。系统已在下面给出每条链接的判定，请直接采信：
    · 标"我司店铺白名单命中""图片/视频资源""平台官方功能页" → 判 pass；
    · 标"同平台商品页，店铺归属不明" → 若同时出现"别家/其他店/换一家/更便宜"这类导流话术，判 fail；没有这类话术，判 pass（发同平台商品链接是正常服务，不得仅因无法确认店铺就判违规）；
    · 标"跨平台"或"站外渠道" → 客服在推荐顾客去那里成交才判 fail；只是引用平台官方说明、或顾客自己发的，判 pass；
    · 标"未知域名" → 判 na 交人工。
    全程没有任何链接、也没有导流话术的，判 pass。
15. 单字回复只看"有没有信息量"。判定"回复完整度"扣分前，必须先看系统给出的单字回复统计：
    · 0 次 → 判 5 分；
    · 1—2 次且核心问题已答清 → 判 3 分；
    · 3 次以上，或用单字回复了本该解释的问题 → 判 1 分。
    "好的""是的"出现在解释之前作为引子（后面还有内容）不算敷衍；"稍等""收到"不算敷衍；客服消息少于 3 条判 na。`;

function buildMessages({ session, categories = [] }) {
  const facts = conversationFacts(session);
  const sensitive = sensitiveMentions(session);
  const criteria = applicableCriteria(categories.length ? categories : null);
  const transcript = renderTranscript(session);
  const shortReplies = shortReplyStats(session);
  const keywordSignals = detectKeywordSignals(session);
  const linkSignals = detectLinkSignals(session);

  const user = `## 会话信息
客服：${facts.agent || '未识别'}
开始时间：${facts.startedAt || '未知'}
结束时间：${facts.endedAt || '未知'}
消息条数：${facts.messageCount}（顾客 ${facts.customerTurns} 条 / 客服 ${facts.agentTurns} 条）
首次响应间隔：${facts.firstAgentReplySeconds == null ? '无法计算' : facts.firstAgentReplySeconds + ' 秒'}
最长一次顾客等待：${facts.maxGapSeconds == null ? '无法计算' : facts.maxGapSeconds + ' 秒'}
超过 120 秒的等待：${facts.slowGaps.length ? facts.slowGaps.map(g => `顾客消息#${g.customerMessageId}后等了 ${g.seconds} 秒`).join('；') : '无'}
顾客最后一条消息是否有人回复：${facts.unanswered ? `未回复（消息#${facts.unanswered.messageId}，会话结束时已等待 ${facts.unanswered.seconds ?? '未知'} 秒）` : '已回复'}
顾客提到投诉类词汇的消息：${sensitive.length ? sensitive.map(id => '#' + id).join('、') : '无'}

## 单字回复统计（系统自动统计，直接采信，不要自己重数）
客服消息共 ${shortReplies.total} 条；其中单字回复 ${shortReplies.singleCount} 条、"好的/是的"类敷衍回复 ${shortReplies.briefCount} 条，合计 ${shortReplies.count} 条（占 ${Math.round(shortReplies.ratio * 100)}%）。
${shortReplies.singles.length ? `单字回复明细：${shortReplies.singles.map(item => `#${item.messageId}「${item.text}」`).join('；')}` : '单字回复明细：无'}
${shortReplies.briefs.length ? `敷衍回复明细：${shortReplies.briefs.map(item => `#${item.messageId}「${item.text}」`).join('；')}` : ''}

## 关键词线索（系统预扫描，供核对，判定仍以会话原文为准）
${renderKeywordBriefing(keywordSignals)}

## 链接归属判定（系统按白名单判定，直接采信）
${renderLinkBriefing(linkSignals)}

${transcript.truncated ? `注意：原会话共 ${transcript.totalMessages} 条，中间部分已省略，只能基于可见部分判断。` : ''}

## 会话原文
${transcript.text}

## 咨询类型候选
${CATEGORIES.map(item => `${item.id}=${item.label}`).join('；')}

## 需要判定的质检项（本次共 ${criteria.length} 项）
${JSON.stringify(ruleSpec(criteria), null, 1)}

## 输出格式（严格 JSON）
{
 "categories": ["从咨询类型候选中选 1-3 个，按主要程度排序"],
 "summary": "不超过 60 字，概括顾客诉求与客服处理结果",
 "criteria": [
  {
   "id": "质检项 id",
   "verdict": "pass | fail | na",
   "score": "仅非关键项需要，取值 5 / 3 / 1",
   "confidence": 0.0,
   "reason": "不超过 50 字，说明依据",
   "evidence": [{"messageId": 0, "quote": "原文连续片段"}]
  }
 ],
 "overall": "不超过 80 字，给出最需要改进的 1-2 点"
}

必须逐项输出上面 ${criteria.length} 个质检项，不能遗漏，不能新增。`;

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user }
    ],
    facts,
    criteria,
    shortReplies,
    keywordSignals,
    linkSignals,
    transcriptMeta: { truncated: transcript.truncated, totalMessages: transcript.totalMessages },
    rubricVersion: RUBRIC_VERSION
  };
}

// 分类阶段单独用：先定类别，再按类别裁剪规则，减少无关项误判。
function buildClassifyMessages({ session }) {
  const transcript = renderTranscript(session);
  return [
    { role: 'system', content: '你只做咨询类型分类。严格输出 JSON，不要解释。' },
    {
      role: 'user',
      content: `请判断这条客服会话涉及哪些咨询类型（可多选，1-3 个，按主要程度排序）。只依据会话内容。

类型候选：${CATEGORIES.map(item => `${item.id}=${item.label}`).join('；')}

会话原文：
${transcript.text}

输出：{"categories":["pre_sale"],"reason":"不超过 30 字"}`
    }
  ];
}

module.exports = { mask, renderTranscript, buildMessages, buildClassifyMessages, SYSTEM_PROMPT };
