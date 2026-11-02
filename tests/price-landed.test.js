'use strict';
/* 到手价算术单测。
 *
 * 这一层是整个比价功能的地基：算错 1 元，群里就会天天报「竞品低 1 元」，
 * 运营三天就不看了。所以每个用例都对着「京东 App 上顾客实际付的钱」逐位比。
 *
 * 基准算例（2026-11-02 用户提供的 App 截图）：
 *   标价 3098 − 单品满1件减300 = 2798
 *   2798 × 15% = 419.7（国补，上限 1500）
 *   2798 − 419.7 = 2378.3   ← App 显示「国补领后价」
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeLanded, checkChain, normalizePromos } = require('../lib/price/landed');

const SUBSIDY = { subsidyRate: 0.15, subsidyCap: 1500 };

test('算例复盘：标价 3098 + 满1件减300 + 国补15% = 到手 2378.3（与 App 一致）', () => {
  const r = computeLanded({
    listed: 3098,
    promos: [{ off: 300, needNum: 1, text: '满1件减300元' }],
    subsidyFlag: 'yes',
    ...SUBSIDY
  });
  assert.equal(r.listed, 3098);
  assert.equal(r.promoAmount, 300);
  assert.equal(r.afterPromo, 2798);
  assert.equal(r.subsidyRate, 0.15);
  assert.equal(r.subsidyAmount, 419.7, '国补按券后价算 2798×15%，不是按标价 3098 算');
  assert.equal(r.landed, 2378.3);
  assert.equal(r.confidence, 'high');
  assert.equal(checkChain(r).ok, true);
});

test('国补按券后价算而不是标价：先减券再打 85 折', () => {
  const r = computeLanded({ listed: 4000, promos: [{ off: 500 }], subsidyFlag: 'yes', ...SUBSIDY });
  assert.equal(r.afterPromo, 3500);
  assert.equal(r.subsidyAmount, 525, '3500×15%，不是 4000×15%（600）');
  assert.equal(r.landed, 2975);
});

test('国补有上限：高价商品只减 1500', () => {
  const r = computeLanded({ listed: 20000, promos: [], subsidyFlag: 'yes', ...SUBSIDY });
  assert.equal(r.subsidyAmount, 1500, '20000×15%=3000 超过上限，只减 1500');
  assert.equal(r.landed, 18500);
});

test('页面没标国补：按无补贴算 + 降为 low（宁可用偏高，也不虚构补贴）', () => {
  const no = computeLanded({ listed: 3098, promos: [], subsidyFlag: 'no' });
  assert.equal(no.subsidyAmount, 0);
  assert.equal(no.landed, 3098);
  assert.equal(no.confidence, 'low');
  assert.ok(no.notes.some((n) => n.includes('不支持')));

  const unknown = computeLanded({ listed: 3098, promos: [], subsidyFlag: 'unknown' });
  assert.equal(unknown.subsidyAmount, 0);
  assert.equal(unknown.confidence, 'low');
  assert.ok(unknown.notes.some((n) => n.includes('未标识')));
});

test('满减有金额门槛：券后价不到门槛就不能减', () => {
  const r = computeLanded({ listed: 1500, promos: [{ off: 300, threshold: 2000, text: '满2000减300' }] });
  assert.equal(r.promoAmount, 0, '1500 元达不到 2000 门槛');
  assert.equal(r.landed, 1500);
  assert.ok(r.promoText && r.promoText.includes('未达门槛'), '未生效的券要留在原文里，人能对账');
});

test('多张券叠加：页面并列展示的直减项相加', () => {
  const r = computeLanded({
    listed: 5000,
    promos: [
      { off: 300, threshold: 2000, text: '店铺券满2000减300' },
      { off: 200, threshold: 1000, text: '平台券满1000减200' }
    ]
  });
  assert.equal(r.promoAmount, 500);
  assert.equal(r.landed, 4500);
  assert.equal(r.applied.length, 2);
});

test('保守叠加：第一张券减完就不够第二张门槛时，第二张不算（宁可少减）', () => {
  // 用户 2026-11-02 明确选「保守」：宁可到手价算高一点（漏报），也不虚构一个顾客拿不到的价
  const r = computeLanded({
    listed: 2500,
    promos: [
      { off: 800, threshold: 2000, text: '满2000减800' },
      { off: 500, threshold: 2000, text: '满2000减500' }
    ]
  });
  assert.equal(r.promoAmount, 800, '减完 800 只剩 1700，第二张 2000 门槛不满足');
  assert.equal(r.afterPromo, 1700);
});

test('同一张券被文案和结构化字段各解析一次时不能减两遍', () => {
  const list = normalizePromos([
    { off: 300, threshold: 2000, text: '满2000减300' },
    { off: 300, threshold: 2000, text: '满2000减300元' }
  ]);
  assert.equal(list.length, 1);
  const r = computeLanded({ listed: 3098, promos: list });
  assert.equal(r.promoAmount, 300);
});

test('减免金额不可能超过售价：超过就整张不计', () => {
  const r = computeLanded({ listed: 100, promos: [{ off: 300, text: '满1件减300' }] });
  assert.equal(r.promoAmount, 0);
  assert.equal(r.landed, 100);
  assert.ok(r.promoText.includes('超过售价'));
});

test('券金额没解析出来：不猜，记 broken 并降为 low', () => {
  const r = computeLanded({ listed: 3098, promos: [], subsidyFlag: 'yes', promoBroken: true, ...SUBSIDY });
  assert.equal(r.promoAmount, 0);
  assert.equal(r.confidence, 'low');
  assert.ok(r.notes.some((n) => n.includes('未解析')));
});

test('限时券：有效期取最早的那张，一起存下来', () => {
  const a = new Date('2026-11-02T22:00:00+08:00');
  const b = new Date('2026-11-02T18:00:00+08:00');
  const r = computeLanded({
    listed: 3098,
    promos: [
      { off: 300, text: '券A', expiresAt: a },
      { off: 100, text: '券B', expiresAt: b }
    ]
  });
  assert.equal(r.promoExpireAt.toISOString(), b.toISOString(), '存最早过期的，页面能提示"券快到期"');
});

test('标价缺失：整条返回 null，绝不拿别的数顶上', () => {
  assert.equal(computeLanded({ listed: null, promos: [{ off: 300 }] }), null);
  assert.equal(computeLanded({}), null);
  assert.equal(computeLanded({ listed: 0 }), null);
});

test('恒等式自检：到手价高于券后价 / 券后价高于标价都要判废', () => {
  assert.equal(checkChain({ listed: 3000, afterPromo: 3100, landed: 2900 }).reason, 'identity_violation');
  assert.equal(checkChain({ listed: 3000, afterPromo: 2800, landed: 2900 }).reason, 'identity_violation');
  assert.equal(checkChain({ listed: 3000, afterPromo: 2800, landed: 2600 }).ok, true);
  assert.equal(checkChain(null).ok, false);
});

test('金额都保留两位小数，不产生 0.30000000000000004 这种尾巴', () => {
  const r = computeLanded({ listed: 3099, promos: [{ off: 199 }], subsidyFlag: 'yes', ...SUBSIDY });
  assert.equal(r.afterPromo, 2900);
  assert.equal(r.subsidyAmount, 435);
  assert.equal(r.landed, 2465);
});

test('国补比例可配：换成 20% 时同一台机器算出来的到手价跟着变', () => {
  const r = computeLanded({ listed: 3098, promos: [{ off: 300 }], subsidyFlag: 'yes', subsidyRate: 0.2, subsidyCap: 2000 });
  assert.equal(r.subsidyAmount, 559.6, '2798×20%');
  assert.equal(r.landed, 2238.4);
});
