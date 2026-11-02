'use strict';
/* 比价助手 —— 到手价计算（纯函数：不连数据库、不发通知、不碰网络）。
 *
 * 口径（2026-11-02 用户拍板，见 docs/superpowers/specs/2026-11-02-price-landed-cost.md）：
 *
 *   标价 listed_price       页面 priceFloor.ext.jdPrice（未领券、未享国补的那个数）
 *     − 促销直减 promo_amount 页面上并列展示、可叠加的直减项（满减/单品券）
 *     = 券后价 after_promo_price
 *     − 国补抵扣 subsidy_amount  min(券后价 × 比例, 上限)，按「券后价」算，不是按标价
 *     = 到手价 landed_price   ← 主告警口径，顾客真正要掏的钱
 *
 * 三条铁律：
 *   1. 保守叠加（用户答①「保守」）：只加页面上明确并列、可叠加的直减项，不推断叠加规则。
 *      门槛按「前面券减完后的金额」判断，比京东实际更严 → 偶尔少减（到手价偏高）
 *      → 只会漏报、不会报一个顾客拿不到的价。
 *   2. 国补不是抓来的、是算出来的：页面只给「是否支持国补」这个开关（isGbsp），
 *      金额必须在结算环节才出现。所以「页面没标国补」≠「有国补」，
 *      一律按无补贴算并降置信度（用户答⑥）。
 *   3. 绝不拿标价冒充到手价：券解析失败时到手价按「不减」算并标 low，
 *      不猜一个减免金额，也不留空导致这条被当成「没采到」。
 */

const DEFAULTS = Object.freeze({
  subsidyRate: 0.15, // 国补比例（用户答③：所有机型统一 15%）
  subsidyCap: 1500, // 国补上限（元）
  maxPromoText: 400
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isPosNum(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/* 券去重：同一张券可能同时从文案（满1件减300元）和结构化字段（reward:300）解析出来，
 * 两者金额与门槛一致就算同一张，否则会被叠加两次，到手价凭空少 300。 */
function normalizePromos(promos) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(promos) ? promos : []) {
    if (!p || !isPosNum(Number(p.off))) continue;
    const off = round2(Number(p.off));
    const threshold = isPosNum(Number(p.threshold)) ? round2(Number(p.threshold)) : null;
    const key = `${threshold == null ? 'none' : threshold}-${off}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      off,
      threshold,
      text: String(p.text || (threshold ? `满${threshold}减${off}` : `减${off}`)).slice(0, 80),
      expiresAt: p.expiresAt ? new Date(p.expiresAt) : null
    });
  }
  // 先减金额大的：这是页面通常的展示顺序，也避免小数券先吃掉门槛
  return out.sort((a, b) => b.off - a.off);
}

/**
 * 算到手价。任何一步算不出来都降级，不抛错。
 *
 * @param {object} input
 * @param {number} input.listed        标价（必填，缺失返回 null 链）
 * @param {Array}  input.promos        直减项 [{ off, threshold, text, expiresAt }]
 * @param {string} input.subsidyFlag   'yes' | 'no' | 'unknown'
 * @param {number} [input.subsidyRate] 国补比例，默认 0.15
 * @param {number} [input.subsidyCap]  国补上限，默认 1500
 * @param {boolean} [input.promoBroken] 页面上有满减但金额没解析出来（说明是我们没读懂，不是没有券）
 * @returns {object|null} 缺失标价时返回 null
 */
function computeLanded(input) {
  const src = input || {};
  const listed = isPosNum(Number(src.listed)) ? round2(Number(src.listed)) : null;
  if (listed === null) return null;

  const rateRaw = Number(src.subsidyRate);
  const subsidyRate = Number.isFinite(rateRaw) && rateRaw >= 0 && rateRaw <= 1 ? rateRaw : DEFAULTS.subsidyRate;
  const capRaw = Number(src.subsidyCap);
  const subsidyCap = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : DEFAULTS.subsidyCap;

  const notes = [];
  const promos = normalizePromos(src.promos);

  // —— ① 直减券：逐张过门槛，累计不能把价格减成负数 ——
  let remaining = listed;
  let promoAmount = 0;
  const applied = [];
  const skipped = [];
  for (const p of promos) {
    // 门槛按「已减完的金额」判断（比京东更严，保守）
    if (p.threshold != null && remaining < p.threshold) {
      skipped.push(`${p.text}（未达门槛）`);
      continue;
    }
    if (p.off >= remaining) {
      skipped.push(`${p.text}（减免超过售价，按不可用处理）`);
      continue;
    }
    remaining = round2(remaining - p.off);
    promoAmount = round2(promoAmount + p.off);
    applied.push(p);
  }

  const afterPromo = round2(listed - promoAmount);

  // —— ② 国补：只认页面上明确写着支持国补的，其余一律不算 ——
  const flag = ['yes', 'no', 'unknown'].includes(src.subsidyFlag) ? src.subsidyFlag : 'unknown';
  let subsidyAmount = 0;
  let effectiveRate = 0;
  if (flag === 'yes') {
    effectiveRate = subsidyRate;
    subsidyAmount = round2(Math.min(round2(afterPromo * subsidyRate), subsidyCap));
  } else {
    notes.push(flag === 'no' ? '该商品不支持国家补贴，按券后价计' : '页面未标识国补资格，按无补贴计（可能偏高，只会漏报）');
  }

  const landed = round2(Math.max(0, afterPromo - subsidyAmount));

  // —— ③ 置信度：宁可标 low 让人去核，也别装成确定值 ——
  let confidence = 'high';
  if (flag !== 'yes') confidence = 'low';
  if (src.promoBroken) {
    confidence = 'low';
    notes.push('页面有满减活动但金额未解析出来，未做减免（到手价偏高，需人工核）');
  }
  if (skipped.length) notes.push(`未计入：${skipped.join('、')}`);

  const expiries = applied.map((p) => p.expiresAt).filter((d) => d instanceof Date && !Number.isNaN(d.getTime()));
  const promoExpireAt = expiries.length ? new Date(Math.min(...expiries.map((d) => d.getTime()))) : null;
  const promoText = [...applied.map((p) => p.text), ...skipped].join(' + ').slice(0, DEFAULTS.maxPromoText) || null;

  return {
    listed,
    promoAmount,
    afterPromo,
    subsidyRate: effectiveRate,
    subsidyAmount,
    landed,
    promoText,
    promoExpireAt,
    subsidyFlag: flag,
    confidence,
    applied: applied.map((p) => ({ off: p.off, threshold: p.threshold, text: p.text })),
    notes
  };
}

/** 恒等式自检：listed >= afterPromo >= landed >= 0。
 *  违反说明上游把字段串了（比如把划线价当成了标价），这种数据比没有更危险。 */
function checkChain(chain) {
  if (!chain) return { ok: false, reason: 'empty' };
  const { listed, afterPromo, landed } = chain;
  if (!isPosNum(listed) || !isPosNum(landed)) return { ok: false, reason: 'no_price' };
  if (afterPromo > listed + 0.01) return { ok: false, reason: 'identity_violation', detail: `券后价(${afterPromo}) > 标价(${listed})` };
  if (landed > afterPromo + 0.01) return { ok: false, reason: 'identity_violation', detail: `到手价(${landed}) > 券后价(${afterPromo})` };
  if (landed < 0) return { ok: false, reason: 'identity_violation', detail: `到手价(${landed}) < 0` };
  return { ok: true };
}

module.exports = { computeLanded, checkChain, normalizePromos, DEFAULTS, round2 };
