'use strict';
/* 比价助手 —— 判价核心（纯函数：不连数据库、不发通知、不碰网络）。
 *
 * 口径（2026-11-02 用户拍板，见 docs/superpowers/specs/2026-11-02-price-landed-cost.md）：
 *   到手价 landed = (标价 − 可叠加直减券) − 国补     ← 唯一主口径，顾客真正要掏的钱
 *   标价 listed   = 页面上那个大字价格（未领券、未享国补）
 *   券后 afterPromo = 标价 − 券
 *   恒等式 listed >= afterPromo >= landed >= 0，违反即判解析异常，该链接不参与判价。
 *   标价差不单独告警（用户答⑧）：标价天天变，混在一起报会把"别人发了张券"误读成"降价"。
 *
 * 三条铁律：
 *   1. 宁可漏报不可假报：缺数据一律返回 missing，绝不拿标价冒充到手价，也不拿旧价充数。
 *   2. 判价发生在「机型」层，不是链接层：同一机型 5 家竞店都便宜只算一个命中。
 *   3. 阈值只负责"算不算便宜"，噪声靠状态机（decideAlert）压，不靠抬高阈值。
 *
 * 数据源只认京东前台（页面上的券 + 页面的国补开关），不使用联盟 API。 */

const DEFAULTS = Object.freeze({
  minGapYuan: 3, // 金额门槛：差 3 元才满足（2026-10-30 用户从 1 元上调）
  minGapRate: 0.003, // 比例门槛：0.3%，两者满足任一即命中
  bigGapYuan: 5, // 明显击穿（单独推送）的金额门槛
  bigGapRate: 0.025, // 明显击穿的比例门槛
  conflictRate: 0.05, // 我方多店价差超过 5% 视为内部价格冲突
  priceFloor: 1, // 低于 1 元必是解析错
  priceCeil: 200000, // 高于 20 万必是解析错（把销量/编号当成了价格）
  deepDropYuan: 10 // 已告警后又继续下探多少，可选再报一次
});

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 };

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* 比例留 4 位小数（0.0394 = 3.94%），别用 round2 二次缩放，会把 0.0394 算成 0.039406 */
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function worstConfidence(a, b) {
  const left = CONFIDENCE_ORDER[a] === undefined ? 0 : CONFIDENCE_ORDER[a];
  const right = CONFIDENCE_ORDER[b] === undefined ? 0 : CONFIDENCE_ORDER[b];
  return left <= right ? a || 'low' : b || 'low';
}

/* 一条链接能不能拿来判价。返回 { ok, price, listed, afterPromo, confidence, reason }
 * 注意 price 一律是**到手价**：拿不到到手价就不判，绝不用标价顶上（那正是改造前的毛病）。 */
function readLink(link, cfg) {
  if (!link || typeof link !== 'object') return { ok: false, reason: 'empty' };
  if (link.status !== 'ok') return { ok: false, reason: link.status || 'unknown' };

  const listed = isNum(link.listed) ? round2(link.listed) : null;
  const afterPromo = isNum(link.afterPromo) ? round2(link.afterPromo) : null;
  const landed = isNum(link.landed) ? round2(link.landed) : null;

  if (landed === null) return { ok: false, reason: 'no_landed' };

  // 恒等式校验：到手价不可能高于券后价，券后价不可能高于标价。
  // 违反说明页面解析串了字段（比如把划线价当成了标价），这种数据比没有更危险。
  if (listed !== null && afterPromo !== null && afterPromo > listed + 0.01) {
    return { ok: false, reason: 'identity_violation', detail: `券后价(${afterPromo}) > 标价(${listed})` };
  }
  if (afterPromo !== null && landed > afterPromo + 0.01) {
    return { ok: false, reason: 'identity_violation', detail: `到手价(${landed}) > 券后价(${afterPromo})` };
  }
  if (listed !== null && landed > listed + 0.01) {
    return { ok: false, reason: 'identity_violation', detail: `到手价(${landed}) > 标价(${listed})` };
  }

  if (landed < cfg.priceFloor || landed > cfg.priceCeil) {
    return { ok: false, reason: 'out_of_range', detail: String(landed) };
  }

  return { ok: true, price: landed, listed, afterPromo, confidence: link.confidence || 'low' };
}

function collect(list, cfg) {
  const good = [];
  const bad = [];
  for (const link of Array.isArray(list) ? list : []) {
    const r = readLink(link, cfg);
    if (r.ok) good.push({ ...link, price: r.price, listed: r.listed, afterPromo: r.afterPromo, confidence: r.confidence });
    else bad.push({ linkId: link && link.linkId, reason: r.reason, detail: r.detail });
  }
  return { good, bad };
}

function shopKey(link) {
  return String(link.shopId || link.shopName || link.linkId || '');
}

/* 我方多店价差过大 = 自己打自己，属运营问题，不能混进竞品告警 */
function detectConflict(ownGood, cfg) {
  if (ownGood.length < 2) return null;
  const sorted = [...ownGood].sort((a, b) => a.price - b.price);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const rate = (high.price - low.price) / low.price;
  if (rate <= cfg.conflictRate) return null;
  return {
    rate: round2(rate),
    lowPrice: low.price,
    lowShop: low.shopName || '',
    highPrice: high.price,
    highShop: high.shopName || ''
  };
}

/* 机型级判价。返回的行就是页面「今日命中」表格的一行。 */
function evaluateModel(model, options) {
  const cfg = { ...DEFAULTS, ...(options || {}) };
  const base = {
    modelKey: model.modelKey,
    name: model.name || '',
    brand: model.brand || '',
    priority: !!model.priority
  };

  const own = collect(model.ownLinks, cfg);
  const comp = collect(model.competitorLinks, cfg);
  const failed = {
    own: own.bad.length,
    competitor: comp.bad.length,
    ownReasons: own.bad,
    competitorReasons: comp.bad
  };

  if (!own.good.length) {
    return { ...base, status: 'no_own', hit: false, failed, notes: ['我方链接本次没有可用的到手价，不判价'] };
  }
  if (!comp.good.length) {
    return { ...base, status: 'no_competitor', hit: false, failed, notes: ['竞品链接本次全部失败，不能下"竞品更贵"的结论'] };
  }

  const ownBest = own.good.reduce((a, b) => (b.price < a.price ? b : a));
  const compSorted = [...comp.good].sort((a, b) => a.price - b.price);
  const compBest = compSorted[0];

  // 「另有 N 家竞店更低」要按店铺去重：同一家店挂两条链接不能算两家
  const lowerShops = new Set(
    compSorted.filter((l) => l.price < ownBest.price).map(shopKey)
  );
  const lowerCount = lowerShops.size;
  const otherLower = Math.max(0, lowerCount - 1);

  const gap = round2(ownBest.price - compBest.price);
  const gapRate = ownBest.price > 0 ? gap / ownBest.price : 0;

  const hit = gap > 0 && (gap >= cfg.minGapYuan || gapRate >= cfg.minGapRate);
  const big = hit && (gap >= cfg.bigGapYuan || gapRate >= cfg.bigGapRate);

  const notes = [];
  const confidence = worstConfidence(ownBest.confidence, compBest.confidence);
  if (confidence === 'low') notes.push('券或国补未取全，到手价可能偏高（只会漏报，不会假报）');

  const conflict = detectConflict(own.good, cfg);
  if (conflict) notes.push('我方多店内部价格冲突，需运营处理，不属于竞品问题');

  return {
    ...base,
    status: 'ok',
    own: {
      price: ownBest.price,
      listed: ownBest.listed,
      afterPromo: ownBest.afterPromo,
      linkId: ownBest.linkId,
      shopName: ownBest.shopName || '',
      count: own.good.length
    },
    competitor: {
      price: compBest.price,
      listed: compBest.listed,
      afterPromo: compBest.afterPromo,
      linkId: compBest.linkId,
      shopName: compBest.shopName || '',
      secondPrice: compSorted[1] ? compSorted[1].price : null,
      secondShopName: compSorted[1] ? compSorted[1].shopName || '' : '',
      lowerCount,
      otherLower,
      count: comp.good.length
    },
    gap,
    gapRate: round4(gapRate),
    hit,
    big,
    confidence,
    internalConflict: conflict,
    failed,
    notes
  };
}

/* 一次跑完所有机型，顺便给出本轮汇总（企微汇总那条消息就用这个数） */
function evaluateAll(models, options) {
  const cfg = { ...DEFAULTS, ...(options || {}) };
  const list = Array.isArray(models) ? models : [];
  const rows = list.map((m) => evaluateModel(m, cfg));
  const hits = rows.filter((r) => r.hit);
  const maxHit = hits.reduce((a, b) => (!a || b.gap > a.gap ? b : a), null);

  return {
    rows,
    summary: {
      models: rows.length,
      evaluated: rows.filter((r) => r.status === 'ok').length,
      hits: hits.length,
      bigHits: hits.filter((r) => r.big).length,
      maxGap: maxHit ? maxHit.gap : 0,
      maxGapModel: maxHit ? maxHit.name || maxHit.modelKey : '',
      missingOwn: rows.filter((r) => r.status === 'no_own').length,
      missingCompetitor: rows.filter((r) => r.status === 'no_competitor').length,
      failedLinks: rows.reduce((n, r) => n + (r.failed ? r.failed.own + r.failed.competitor : 0), 0),
      conflicts: rows.filter((r) => r.internalConflict).length
    }
  };
}

/* 告警状态机：决定这一条「要不要发消息」，以及发哪一种。
 *   prev 为该机型上一条告警记录（可为 null）
 *   返回 'open' 首次跌破 / 'recovered' 已回升 / 'deepen' 继续下探 / 'none' 不打扰
 * 为什么需要它：3000 元的机型差 1 元就命中，一天两轮、200-300 条链接，
 * 没有状态机会把群刷爆，运营三天就静音。 */
function decideAlert(prev, row, options) {
  const cfg = { ...DEFAULTS, ...(options || {}) };
  if (!row || row.status !== 'ok') return 'none';

  const prevOpen = prev && (prev.status === 'open' || prev.status === 'ignored' || prev.status === 'handled');

  if (!row.hit) {
    // 已经报过、现在不再便宜了 → 发一条"已回升"，让运营知道结束了
    return prev && prev.status === 'open' ? 'recovered' : 'none';
  }

  if (!prev) return 'open';
  if (prev.status === 'recovered') return 'open'; // 回升后又跌破 = 新事件
  if (prevOpen) {
    // 已告警过：默认不再重复；只有明显继续下探且开关打开时才再报
    const dropped = isNum(prev.gap) ? prev.gap - row.gap : 0;
    if (cfg.deepTrack && dropped >= cfg.deepDropYuan) return 'deepen';
    return 'none';
  }
  return 'open';
}

module.exports = {
  DEFAULTS,
  round2,
  readLink,
  evaluateModel,
  evaluateAll,
  decideAlert,
  worstConfidence
};
