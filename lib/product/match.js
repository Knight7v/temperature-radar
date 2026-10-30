'use strict';

// 会话 ↔ 产品 的匹配。
//
// 只用两类证据，不做语义猜测：
//   1. 型号命中（最强信号）——顾客把型号贴过来、或客服报了型号；
//   2. 卖点关键词命中——顾客说"会不会直吹""费不费电"这类话。
//
// 为什么不用模型做匹配：匹配错了，后面的"修正建议"就会拿另一台机器的参数去纠正客服，
// 这比不匹配更糟。所以匹配走确定性规则，只有匹配上的会话才进 AI 建议。

const { normalizeModel } = require('./groups');

const stripPunct = value => String(value == null ? '' : value).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');

/** 型号拆成可匹配的片段：KFR35GW + NHAA1BAJ 都要能单独命中 */
function modelTokens(product) {
  const model = normalizeModel(product?.model || '');
  if (!model) return [];
  const tokens = new Set();
  tokens.add(model);
  const compactModel = stripPunct(model);
  if (compactModel.length >= 6) tokens.add(compactModel);
  /* 先按「/」切（KFR-35GW / NhAa1BAj 是两段），再去掉分隔符，
     这样顾客只说「KFR35GW」或只说「Nhaa1baj」都能对上 */
  for (const part of model.split('/')) {
    const clean = stripPunct(part);
    if (clean.length >= 5) tokens.add(clean);
    if (part.length >= 6) tokens.add(part);
  }
  for (const part of model.split(/[\/\-+]/)) {
    const clean = stripPunct(part);
    if (clean.length >= 5) tokens.add(clean);
  }
  return [...tokens];
}

/** 卖点关键词：标题 + 关键词 + 系列名（从商品标题里取「云锦」「静悦」这类 2-4 字系列词） */
function productKeywords(product) {
  const words = new Set();
  for (const item of product?.features || []) {
    if (item?.title && item.title.length >= 2) words.add(item.title);
    for (const key of Array.isArray(item?.keywords) ? item.keywords : []) {
      if (key && String(key).length >= 2) words.add(String(key));
    }
  }
  const name = String(product?.name || '');
  const series = name.match(/[\u4e00-\u9fa5]{2,4}(?=系列|空调|冰箱|柜机|挂机)/);
  if (series && series[0].length >= 2 && !/^(格力|海尔|变频|新一级|一级能效|家用|壁挂式|立式)$/.test(series[0])) {
    words.add(series[0]);
  }
  return [...words].filter(word => word.length >= 2 && word.length <= 12).slice(0, 24);
}

function sessionText(session) {
  return (Array.isArray(session?.messages) ? session.messages : [])
    .map(item => String(item?.text || ''))
    .join('\n');
}

// 只看顾客说了什么。为什么要分开：客服的标准话术里几乎每条都写着「自清洁、防直吹、变频」，
// 拿全文匹配会让每一通售前对话都命中每一台机器——那就等于没筛。
function customerText(session) {
  return (Array.isArray(session?.messages) ? session.messages : [])
    .filter(item => item?.role === 'customer')
    .map(item => String(item?.text || ''))
    .join('\n');
}

/**
 * 单个会话对单个产品的命中打分。
 * 型号：全文都算（客服也可能报型号），满分 12（拆开的片段 6）；
 * 卖点关键词：**只算顾客说的话**，每个 2 分，最多数 6 个。
 */
function scoreSession(session, product) {
  const full = session.__text != null ? session.__text : sessionText(session);
  if (!full) return { score: 0, hits: [] };
  const customer = session.__customer != null ? session.__customer : customerText(session);
  const flat = normalizeModel(full);
  const compacted = stripPunct(flat);
  const hits = [];
  let score = 0;
  let modelHit = false;

  for (const token of modelTokens(product)) {
    const needle = stripPunct(token);
    if (needle.length < 5) continue;
    const matched = token.includes('-') ? flat.includes(token) : compacted.includes(needle);
    if (!matched) continue;
    modelHit = true;
    score += token.includes('-') ? 12 : 6;
    hits.push({ kind: 'model', word: token });
    if (score >= 12) break;
  }

  let keywordHits = 0;
  for (const word of productKeywords(product)) {
    if (keywordHits >= 6) break;
    if (!customer.includes(word)) continue;
    keywordHits += 1;
    score += 2;
    hits.push({ kind: 'keyword', word });
  }

  return { score, hits, modelHit };
}

/** 会话里最能说明「在问这台机器」的那句顾客话，用于列表和抽屉里做摘要 */
function customerExcerpt(session, hits = []) {
  const customers = (Array.isArray(session?.messages) ? session.messages : []).filter(
    item => item?.role === 'customer' && String(item?.text || '').trim()
  );
  if (!customers.length) return '';
  const usable = customers.filter(item => !/^https?:\/\//i.test(String(item.text).trim()));
  const pool = usable.length ? usable : customers;
  const words = hits.map(hit => hit.word).filter(Boolean);
  const matched = pool.find(item => words.some(word => String(item.text).includes(word)));
  const picked = matched || pool[0];
  return String(picked.text).replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * 批量匹配前调一次：把会话全文缓存到 __text，后面打分不再重复拼接。
 * 返回值仍是同一批会话对象（浅拷贝），不影响调用方的数据结构。
 */
function withSessionText(sessions) {
  return (Array.isArray(sessions) ? sessions : []).map(session => ({
    ...session,
    __text: sessionText(session),
    __customer: customerText(session)
  }));
}

/**
 * 批量匹配：每个会话取分数最高的那个产品，低于门槛的不算关联。
 * minScore=4 意味着「至少两个卖点关键词」或「型号片段命中」，单个关键词不算。
 */
function matchSessions(sessions, products, { minScore = 4, limit = 200 } = {}) {
  const out = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    let best = null;
    for (const product of Array.isArray(products) ? products : []) {
      const scored = scoreSession(session, product);
      if (!scored.score) continue;
      if (!best || scored.score > best.score) {
        best = { ...scored, product };
      }
    }
    if (!best || best.score < minScore) continue;
    out.push({
      sessionId: session.id,
      agent: session.agent || '',
      startedAt: session.startedAt || session.started_at || '',
      ordinal: session.ordinal ?? null,
      customerId: session.customerId || '',
      productId: best.product.id,
      model: best.product.model || '',
      score: best.score,
      modelHit: Boolean(best.modelHit),
      hits: best.hits.slice(0, 6),
      excerpt: customerExcerpt(session, best.hits)
    });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.score - a.score || String(b.startedAt).localeCompare(String(a.startedAt)));
}

/** 一个产品关联了哪些会话（同一批会话、只保留这个产品的命中） */
function matchProduct(sessions, product, { minScore = 4, limit = 200 } = {}) {
  const out = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const scored = scoreSession(session, product);
    if (scored.score < minScore) continue;
    out.push({
      sessionId: session.id,
      agent: session.agent || '',
      startedAt: session.startedAt || session.started_at || '',
      ordinal: session.ordinal ?? null,
      customerId: session.customerId || '',
      productId: product.id,
      model: product.model || '',
      score: scored.score,
      modelHit: Boolean(scored.modelHit),
      hits: scored.hits.slice(0, 6),
      excerpt: customerExcerpt(session, scored.hits)
    });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.score - a.score || String(b.startedAt).localeCompare(String(a.startedAt)));
}

module.exports = {
  modelTokens,
  productKeywords,
  sessionText,
  customerText,
  scoreSession,
  matchSessions,
  matchProduct,
  customerExcerpt,
  /* 批量匹配前先算一次会话全文，避免「会话数 × 产品数」次重复拼接 */
  withSessionText
};
