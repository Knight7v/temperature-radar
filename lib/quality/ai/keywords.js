'use strict';

// 关键词线索检测（2026-10-22 客服主管新增要求）。
//
// 设计立场：本模块只负责"发现线索并归类"，不直接判违规。
// 最终判定仍由模型结合上下文给出，再经 verify.js 的证据与置信度双重校验。
// 原因：同样的词在不同场景含义完全不同——
//   「给您返现补偿」是售后安抚，"返现"换了"好评"才是违规；
//   「加我发您安装视频」和「加我微信转账」性质也不同。
// 代码贸然定性会把正常服务判成违规，这是质检里代价最高的一类错误。

// ---------- 词表 ----------

// 好评对价类：这些词代表"要求顾客做出好评行为"
const REVIEW_WORDS = Object.freeze([
  '好评', '五星', '晒图', '晒单', '晒照', '评价', '追评', '追加评价', '点星', '评星'
]);

// 金钱给付类：这些词代表"给顾客钱或等价物"
const MONEY_WORDS = Object.freeze([
  '返现', '返红包', '返利', '返款', '返您', '返你', '返多少钱', '返多少',
  '红包', '补偿', '返券', '打款', '转你', '转您'
]);

// 站外导流类：引导顾客离开平台沟通或支付
const OFFSITE_WORDS = Object.freeze([
  '加我', '加下我', '私我', '私聊', '私信我', '加微信', '加个微信', '加微信好友',
  '微信号', '加v', '加V', 'vx', 'VX', 'v信', 'V信', 'wx', 'WX',
  '扫码', '扫我', '扫这个码', '二维码', '线下交易', '私下', '私下转', '私人转账',
  '支付宝转', '走支付宝', '微信支付转', '银行卡转'
]);

// 否定语境：词前出现这些字，说明客服是在拒绝而非引导（"不能加微信"）
const NEGATIONS = ['不', '别', '勿', '禁', '无法', '不能', '不可', '不要', '不支持', '没有'];

// 售后安抚语境：出现这些词且未绑定好评，属正常补偿话术
const COMPENSATION_CONTEXT = ['抱歉', '对不起', '理解您', '给您添麻烦', '补偿', '赔偿', '安抚', '耽误您', '影响您'];

// 优惠咨询语境：顾客问优惠时出现"返现"，属价格答疑
const DISCOUNT_CONTEXT = ['优惠', '活动', '便宜', '少点', '让点', '券', '折扣', '补贴', '国补', '降价'];

// ---------- 文本处理 ----------

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, '');
}

// 客服消息按说话人角色取；顾客的话不算客服违规。
function agentMessages(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return messages.filter(item => item && item.role === 'agent' && String(item.text || '').trim());
}

function customerMessages(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return messages.filter(item => item && item.role === 'customer' && String(item.text || '').trim());
}

function hits(text, words) {
  const source = normalizeText(text);
  return words.filter(word => source.includes(normalizeText(word)));
}

function hasNegationBefore(text, word) {
  const source = normalizeText(text);
  const index = source.indexOf(normalizeText(word));
  if (index < 0) return false;
  const prefix = source.slice(Math.max(0, index - 4), index);
  return NEGATIONS.some(negation => prefix.includes(negation));
}

// ---------- 单字回复统计（需求 1） ----------

// 纯敷衍单字：整条消息只有一个字，且不是有信息量的答复
const SINGLE_CHAR_FILLERS = new Set(['嗯', '哦', '额', '啊', '噢', '喔', '好', '是', '有', '无', '行', '可', '对', '在', '不', '没', '等']);
// 两字敷衍：常见"看似礼貌实则无内容"的回复
const TWO_CHAR_FILLERS = new Set(['好的', '是的', '没有', '对的', '行的', '可以', '嗯嗯', '哦哦', '在的', '有得']);
// 两字的合理过渡语，不算敷衍（"稍等"是流程用语，不是冷场）
const TWO_CHAR_EXEMPT = new Set(['稍等', '稍後', '稍后', '收到', '明白', '了解', '正在', '已办']);

function stripToChinese(value) {
  return String(value ?? '')
    .replace(/[\s\p{P}\p{S}]/gu, '') // 去标点、符号、emoji
    .replace(/[a-zA-Z0-9]/g, '');
}

function shortReplyStats(session) {
  const agents = agentMessages(session);
  const singles = [];
  const briefs = [];
  for (const item of agents) {
    const core = stripToChinese(item.text);
    if (!core) continue;
    if (core.length === 1 && SINGLE_CHAR_FILLERS.has(core)) {
      singles.push({ messageId: item.id, text: String(item.text).slice(0, 20) });
      continue;
    }
    if (core.length === 2 && TWO_CHAR_FILLERS.has(core) && !TWO_CHAR_EXEMPT.has(core)) {
      briefs.push({ messageId: item.id, text: String(item.text).slice(0, 20) });
    }
  }
  const total = agents.length;
  const count = singles.length + briefs.length;
  return {
    total,
    singleCount: singles.length,
    briefCount: briefs.length,
    count,
    ratio: total ? Math.round((count / total) * 1000) / 1000 : 0,
    singles: singles.slice(0, 8),
    briefs: briefs.slice(0, 8)
  };
}

// ---------- 关键词线索 ----------

/**
 * 扫描会话中的三类线索。
 * @returns {{
 *   reviewCash: Array,   // 好评 + 金钱同条共现：强信号（疑似好评返现）
 *   moneyOnly: Array,    // 只有金钱词：弱信号，需结合场景
 *   offsite: Array,      // 站外导流词
 *   scenes: {compensation: boolean, discount: boolean},
 *   total: number
 * }}
 */
function detectKeywordSignals(session) {
  const agents = agentMessages(session);
  const customers = customerMessages(session);
  const reviewCash = [];
  const moneyOnly = [];
  const offsite = [];

  for (const item of agents) {
    const text = String(item.text || '');
    const review = hits(text, REVIEW_WORDS);
    const money = hits(text, MONEY_WORDS);
    if (review.length && money.length) {
      reviewCash.push({
        messageId: item.id,
        reviewWords: review,
        moneyWords: money,
        snippet: text.slice(0, 60)
      });
    } else if (money.length) {
      moneyOnly.push({ messageId: item.id, moneyWords: money, snippet: text.slice(0, 60) });
    }

    const raw = hits(text, OFFSITE_WORDS).filter(word => !hasNegationBefore(text, word));
    if (raw.length) offsite.push({ messageId: item.id, words: raw, snippet: text.slice(0, 60) });
  }

  // 场景语境：用于判断"返现"是补偿、优惠还是换好评
  const customerText = customers.map(item => String(item.text || '')).join(' ');
  const agentText = agents.map(item => String(item.text || '')).join(' ');
  const scenes = {
    compensation: hits(customerText + agentText, COMPENSATION_CONTEXT).length > 0
      || hits(customerText, ['赔', '退钱', '退一赔三', '补偿我', '给我个说法']).length > 0,
    discount: hits(customerText, DISCOUNT_CONTEXT).length > 0
  };

  return {
    reviewCash,
    moneyOnly,
    offsite,
    scenes,
    total: reviewCash.length + moneyOnly.length + offsite.length
  };
}

// 给提示词用的简报文本：把线索摊开写清，模型不需要自己找词。
function renderKeywordBriefing(signals) {
  if (!signals || !signals.total) {
    return '（未检出关键词线索：客服回复中未出现好评返现类、返现类或站外导流类用词）';
  }
  const lines = [];
  if (signals.reviewCash.length) {
    lines.push('【强信号 · 好评与金钱同条出现】疑似好评返现，需逐条核对是否构成"以返现换好评"：');
    for (const item of signals.reviewCash) {
      lines.push(`  · 消息#${item.messageId}：命中好评词「${item.reviewWords.join('/')}」+ 金钱词「${item.moneyWords.join('/')}」｜原文：${item.snippet}`);
    }
  }
  if (signals.moneyOnly.length) {
    lines.push('【弱信号 · 只出现金钱词】"返现/补偿/红包"未与好评绑定，可能是售后补偿或优惠答疑，不得直接判违规：');
    for (const item of signals.moneyOnly) {
      lines.push(`  · 消息#${item.messageId}：命中「${item.moneyWords.join('/')}」｜原文：${item.snippet}`);
    }
  }
  if (signals.offsite.length) {
    lines.push('【站外导流词】客服主动引导顾客离开平台沟通或支付：');
    for (const item of signals.offsite) {
      lines.push(`  · 消息#${item.messageId}：命中「${item.words.join('/')}」｜原文：${item.snippet}`);
    }
  }
  const scene = [];
  if (signals.scenes.compensation) scene.push('会话存在售后安抚/索赔语境');
  if (signals.scenes.discount) scene.push('顾客侧存在优惠/活动咨询语境');
  if (scene.length) lines.push(`【场景语境】${scene.join('；')}——此类语境下的"返现"若未与好评绑定，应判合格或不适用。`);
  return lines.join('\n');
}

module.exports = {
  REVIEW_WORDS,
  MONEY_WORDS,
  OFFSITE_WORDS,
  COMPENSATION_CONTEXT,
  DISCOUNT_CONTEXT,
  shortReplyStats,
  detectKeywordSignals,
  renderKeywordBriefing,
  stripToChinese
};
