'use strict';

/**
 * 采集器解析 + 推送文案的单元测试。
 * 用真实京东移动版页面的**结构片段**做夹具（不打网络），验证：
 *   - 价格打码（3??8）必须识别为"要登录"，绝不能当数字用
 *   - 能从句嵌套的 priceFloor / promov2 里取出标价、直减券、国补开关
 *   - 满 N 件才减的券不能当单台的减免
 *   - 各种京东链接格式都能取到商品编号
 *   - 汇总文案按阈值区分"明显击穿"与"小幅低于"
 *
 * 夹具构造方式：用 JSON.stringify 生成，避免手写多层转义出错
 * （customtag 本身就是「字符串里套字符串」，手写必错）。
 */

const test = require('node:test');
const assert = require('node:assert');
const { parseItemPage, parseSku } = require('../lib/price/sources/jd');
const wecom = require('../lib/price/wecom');
const scheduler = require('../lib/price/scheduler');

function page(config) {
  return `<html><head><title>格力空调 1.5匹 云佳pro【图片 价格 品牌 评论】-京东</title></head>
<body><script>var pageConfig = ${JSON.stringify(config)};</script></body></html>`;
}

function promov2(pis) {
  return { id: '10175592455372', pis };
}

const ITEM_UNIT = {
  customtag: JSON.stringify({ p: '3098.00' }),
  pid: '480371338130_1',
  extInfo: { virtualType: 'PROMO_TYPE_unit' },
  promoType: 1,
  d: '1795967999'
};

/** 满 1 件减 300：结构与真实页面一致（reward 是「字符串里套 JSON 数组」） */
const ITEM_BUY_MORE = {
  customtag: JSON.stringify({ reward: JSON.stringify([{ needNum: 1, reward: 300 }]) }),
  pid: '456926639971_26',
  extInfo: { virtualType: 'PROMO_TYPE_unitBuyMore' },
  97: '满1件减300元',
  promoType: 26,
  d: '1798732799'
};

/* ---------- 打码：未登录 ---------- */

const PAGE_MASKED = page({
  shopName: '格力旗舰店',
  priceFloor: { demoteEnable: false, price: '3??8', ext: { jdPrice: '3??8' } },
  bybtTitle: '【超级补贴价￥3098】格力空调1.5匹一级能效国家补贴',
  priceLoginText: '登录查看价格'
});

test('未登录：价格打码必须识别为需要登录，不能把 3??8 当价格', () => {
  const r = parseItemPage('10175592455372', PAGE_MASKED);
  assert.equal(r.masked, true);
  assert.equal(r.listed, null, '打码时标价必须为空');
  assert.equal(r.p0, null, '兼容列 p0 也要为空');
  assert.equal(r.shopName, '格力旗舰店');
  assert.ok(r.title.startsWith('格力空调 1.5匹'), '标题要能从 <title> 里取出来');
  assert.equal(r.promoPrice, 3098, '分享文案里的补贴价可作为参考');
});

/* ---------- 正常：带登录态 ---------- */

const PAGE_OK = page({
  shopName: '格力官方旗舰店',
  priceFloor: {
    price: '.',
    ext: { jdPrice: '3098.00', realPriceExt: { ORIGINAL: { salePrice: '3999.00' } } }
  },
  features: { isGbsp: '1', shortTitle: '格力空调1.5匹一级能效国家补贴' },
  promov2: promov2([ITEM_UNIT, ITEM_BUY_MORE]),
  stockState: '33'
});

test('带登录态：从嵌套结构里取到标价、划线价、直减券、国补开关', () => {
  const r = parseItemPage('10175592455372', PAGE_OK);
  assert.equal(r.masked, false);
  assert.equal(r.listed, 3098, '标价取 priceFloor.ext.jdPrice');
  assert.equal(r.salePrice, 3999, '划线价单独留一份，页面上可以显示"原价 3999"');
  assert.equal(r.subsidyFlag, 'yes', 'features.isGbsp=1 表示支持国补');
  assert.equal(r.promoBroken, false);
  assert.equal(r.promos.length, 1, 'PROMO_TYPE_unit 是标价本身，不是券，不能算成一笔减免');
  assert.deepEqual(
    r.promos.map((p) => ({ off: p.off, text: p.text })),
    [{ off: 300, text: '满1件减300元' }]
  );
  assert.equal(r.stockState, 'in_stock');
});

test('满 2 件才减的券：只买一台时不算减免，但要登记下来', () => {
  const item = { ...ITEM_BUY_MORE, customtag: JSON.stringify({ reward: JSON.stringify([{ needNum: 2, reward: 500 }]) }), 97: '满2件减500元' };
  const r = parseItemPage('1', page({ shopName: 'S', priceFloor: { ext: { jdPrice: '3098' } }, promov2: promov2([item]) }));
  assert.equal(r.promos.length, 0, '单台不满足件数门槛');
  assert.equal(r.coupons.length, 1);
  assert.equal(r.coupons[0].usable, false);
  assert.ok(r.notes.some((n) => n.includes('需买 2 件')));
});

test('国补标识为 0：明确不支持，按无补贴算（置信度在 landed 层降级）', () => {
  const r = parseItemPage('1', page({ shopName: 'S', priceFloor: { ext: { jdPrice: '2599' } }, features: { isGbsp: '0' } }));
  assert.equal(r.subsidyFlag, 'no');
});

test('页面没有 isGbsp 时退回看国补规则文案，都没有就是 unknown', () => {
  const withText = parseItemPage('1', page({ priceFloor: { ext: { jdPrice: '2599' } }, note: '国家补贴京东支付享15%，最高可减1500元' }));
  assert.equal(withText.subsidyFlag, 'yes', '有规则文案说明参与国补');

  const nothing = parseItemPage('1', page({ priceFloor: { ext: { jdPrice: '2599' } } }));
  assert.equal(nothing.subsidyFlag, 'unknown', '看不出来就是 unknown，绝不默认有补贴');
});

test('促销块里金额读不出来：记 broken，不猜金额', () => {
  const broken = { ...ITEM_BUY_MORE, customtag: '{"reward":"坏数据"}' };
  const r = parseItemPage('1', page({ priceFloor: { ext: { jdPrice: '3098' } }, promov2: promov2([broken]) }));
  assert.equal(r.promoBroken, true);
  assert.equal(r.promos.length, 0);
});

test('各种京东链接格式都能取出商品编号', () => {
  assert.equal(parseSku('https://item.jd.com/10175592455372.html'), '10175592455372');
  assert.equal(parseSku('https://item.jd.com/100212513162.html?cu=true&utm=x'), '100212513162');
  assert.equal(parseSku('https://item.m.jd.com/product/10149212746799.html'), '10149212746799');
  assert.equal(parseSku('10152461753009'), '10152461753009');
  assert.equal(parseSku('https://item.jd.com/abc.html'), null);
  assert.equal(parseSku(''), null);
});

/* ---------- 推送文案 ---------- */

test('推送文案：明显击穿单列，小幅低于归到"其余"，超过 10 条要收口', () => {
  const hits = [];
  for (let i = 0; i < 14; i += 1) {
    hits.push({ brand: 'gree', series: `云佳Pro${i}`, cap: '1.5匹', my: 3299, comp: 3299 - (i === 0 ? 130 : 4), shop: '格力官方旗舰店', lowerCount: 1, status: 'open', confidence: 'high' });
  }
  const text = wecom.formatDigest({ day: '2026-10-31', hits, summary: {}, status: {} });
  assert.ok(text.includes('命中 14 个机型'));
  assert.ok(text.includes('到手价 = 标价 − 券 − 国补'), '群里要写清口径，避免被理解成标价对比');
  assert.ok(text.includes('低 ¥130'), '130 元必须单列成高亮行');
  assert.ok(text.includes('其余 13 个机型'), '4 元的小幅差价归到其余（5 元及以上算明显击穿）');
  assert.ok(text.includes('还有 3 个'), '其余超过 10 条要提示看页面');
});

test('推送文案：竞品没国补时明确说"可能更低"，不让读者以为已算全', () => {
  const hits = [{ brand: 'gree', series: '云佳Pro', cap: '1.5匹', my: 3098, comp: 2999, shop: 'A', lowerCount: 0, status: 'open', confidence: 'low' }];
  const text = wecom.formatDigest({ day: '2026-10-31', hits, summary: {}, status: {} });
  assert.ok(text.includes('无国补或优惠券未取全'));
});

test('推送文案：没有命中时明确说没有，不输出空表', () => {
  const text = wecom.formatDigest({ day: '2026-10-31', hits: [], summary: {}, status: {} });
  assert.ok(text.includes('今日未发现竞品到手价低于我方'));
});

test('价差与比例计算：我方价为准，除零不炸', () => {
  assert.deepEqual(wecom.gapOf({ my: 3299, comp: 3169 }), { gap: 130, rate: 3.94 });
  assert.deepEqual(wecom.gapOf({ my: null, comp: 3169 }), { gap: 0, rate: 0 });
  assert.equal(wecom.isBigGap({ my: 3299, comp: 3169 }), true, '130 元算明显击穿');
  assert.equal(wecom.isBigGap({ my: 3299, comp: 3296 }), false, '3 元算小幅');
});

/* ---------- 调度 ---------- */

test('调度：北京时间与时刻比较（跨时区不能算错）', () => {
  // UTC 02:00 = 北京 10:00
  assert.deepEqual(scheduler.bj(new Date('2026-10-31T02:00:00Z')), { date: '2026-10-31', hhmm: '10:00' });
  assert.equal(scheduler.minutesOf('10:00'), 600);
  assert.equal(scheduler.minutesOf('20:00'), 1200);
  assert.equal(scheduler.minutesOf('09:05'), 545);
});
