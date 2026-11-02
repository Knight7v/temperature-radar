'use strict';
/* 展示层整形单测：库里的行 → 页面 JSON 这一层最容易悄悄变形，
 * 比如把「今天没采」写成了昨天的价格、把没采过的链接算成缺失。用测试钉住。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const view = require('../lib/price/view');

function model(over) {
  return {
    id: 'm1',
    modelKey: 'gree-yj3-35',
    brand: 'gree',
    series: '云锦Ⅲ',
    code: 'KFR-35GW/NhAa1BAj',
    capacity: '1.5匹',
    status: 'active',
    links: [
      { id: 'l1', side: 'own', url: 'https://item.jd.com/1.html', shopName: '我方自营', shopId: 's1', status: 'active' },
      { id: 'l2', side: 'competitor', url: 'https://item.jd.com/2.html', shopName: '对手A', shopId: 'c1', status: 'active' }
    ],
    ...over
  };
}

/** 一条快照行（列名照抄数据库，pg 的 numeric 取回来是字符串） */
function obs(over) {
  return {
    status: 'ok',
    listed_price: '3098.00',
    after_promo_price: '2798.00',
    landed_price: '2378.30',
    subsidy_amount: '419.70',
    subsidy_flag: 'yes',
    promo_text: '满1件减300元',
    landed_confidence: 'high',
    capturedAt: new Date(),
    ...over
  };
}

test('今天没采到的链接标 not_collected，绝不拿上一次价格顶替', () => {
  const map = new Map([['l1', obs()]]);
  const out = view.toEvalModel(model(), map);
  assert.equal(out.ownLinks[0].status, 'ok');
  assert.equal(out.ownLinks[0].landed, 2378.3, 'pg 的 numeric 是字符串，必须转成数字');
  assert.equal(out.ownLinks[0].listed, 3098);
  assert.equal(out.competitorLinks[0].status, 'not_collected');
  assert.equal(out.competitorLinks[0].landed, null);
});

test('机型标题：品牌 + 系列 + 匹数，缺字段也不会出现空白标题', () => {
  assert.equal(view.modelLabel(model()), '格力 云锦Ⅲ 1.5匹');
  assert.equal(view.modelLabel({ brand: 'haier', code: 'KFR-35GW/01', modelKey: 'x' }), '海尔 KFR-35GW/01');
});

test('从未采集过的链接不算缺失（否则新导入 300 条会全部变成"缺失"）', () => {
  const missing = view.buildMissing([model()], new Map(), new Map());
  assert.deepEqual(missing, []);
});

test('采过但今天失败的链接进缺失表，并带上次成功的到手价与时间', () => {
  const map = new Map([['l2', { status: 'blocked', reason: '页面需验证码', capturedAt: new Date() }]]);
  const lastOk = new Map([['l2', { listed_price: '3399.00', landed_price: '3269.00', capturedAt: new Date('2026-10-29T12:00:00Z') }]]);
  const missing = view.buildMissing([model()], map, lastOk);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].shop, '对手A');
  assert.equal(missing[0].reason, '页面需验证码');
  assert.equal(missing[0].last, 3269, '展示上次到手价，不是标价');
  assert.match(missing[0].lastAt, /^10-29 /);
});

test('命中行：到手价、标价、更低竞店数、状态、下钻链条一次给全，并按价差从大到小排', () => {
  const map = new Map([
    ['l1', obs({ listed_price: '3399.00', after_promo_price: '3169.00', landed_price: '3169.00', subsidy_amount: '0', subsidy_flag: 'no' })],
    ['l2', obs()] // 竞品到手 2378.3
  ]);
  const row = {
    modelKey: 'gree-yj3-35',
    status: 'ok',
    hit: true,
    gap: 790.7,
    confidence: 'low',
    own: { price: 3169, listed: 3399 },
    competitor: { price: 2378.3, listed: 3098, shopName: '对手A', otherLower: 0 }
  };
  const entries = [
    { model: model(), row },
    {
      model: model({ id: 'm2', series: '京逸' }),
      row: { ...row, gap: 400, own: { price: 7999 }, competitor: { price: 7599, shopName: '对手B', otherLower: 2 } }
    }
  ];
  const hits = view.buildHits(entries, {
    alertByModel: new Map([
      [
        'm1',
        {
          id: 'a1',
          status: 'ignored',
          firstSeenAt: new Date(),
          ownPrice: '3169.00',
          competitorPrice: '2378.30',
          competitorShop: '对手A',
          otherLower: 0,
          confidence: 'low'
        }
      ]
    ]),
    obsMap: map,
    trendByModel: new Map()
  });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].id, 'm1', '差 790.7 的排前面');
  const first = hits[0];
  assert.equal(first.my, 3169, '主列展示到手价');
  assert.equal(first.myListed, 3399, '标价另存一列，供下钻对比');
  assert.equal(first.comp, 2378.3);
  assert.equal(first.status, 'ignored');
  assert.equal(first.alertId, 'a1');
  assert.equal(first.links.length, 2);

  const comp = first.links.find((l) => l.side === 'comp');
  assert.equal(comp.price, 2378.3);
  assert.equal(comp.listed, 3098);
  assert.equal(comp.afterPromo, 2798);
  assert.equal(comp.subsidy, 419.7, '国补抵扣要单独显示，否则没人知道 2798 怎么变成 2378.3 的');
  assert.equal(comp.subsidyFlag, 'yes');
});

test('下钻明细保留券文案，方便人工去京东页面对账', () => {
  const map = new Map([['l1', obs()], ['l2', obs({ promo_text: '满2000减200 + 满2件减500（未达门槛）' })]]);
  const row = {
    modelKey: 'x',
    status: 'ok',
    hit: true,
    gap: 100,
    confidence: 'high',
    own: { price: 2378.3 },
    competitor: { price: 2278.3, shopName: 'A', otherLower: 0 }
  };
  const hits = view.buildHits([{ model: model(), row }], { alertByModel: new Map(), obsMap: map, trendByModel: new Map() });
  const comp = hits[0].links.find((l) => l.side === 'comp');
  assert.ok(comp.promoText.includes('满2000减200'));
  assert.ok(comp.promoText.includes('未达门槛'));
});

test('下次采集时点：跨过 20:00 之后指向明天 10:00', () => {
  const at = (h) => new Date(`2026-10-31T${String(h).padStart(2, '0')}:30:00+08:00`);
  assert.equal(view.nextRunAt(at(9), '10:00', '20:00'), '今天 10:00');
  assert.equal(view.nextRunAt(at(14), '10:00', '20:00'), '今天 20:00');
  assert.equal(view.nextRunAt(at(21), '10:00', '20:00'), '明天 10:00');
});

test('时间统一按上海时区显示，不受服务器时区影响', () => {
  assert.equal(view.fmtDateTime('2026-10-30T14:12:00Z'), '10-30 22:12');
  assert.equal(view.fmtDateTime(null), '—');
});
