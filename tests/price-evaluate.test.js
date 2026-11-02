'use strict';
/* 判价核心单测。重点是「什么时候绝对不能报」——假报一次，运营就不信这个功能了。
 * 覆盖：到手价口径、恒等式、阈值、机型层聚合与竞店去重、缺数据降级、状态机。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateModel,
  evaluateAll,
  decideAlert,
  readLink,
  DEFAULTS
} = require('../lib/price/evaluate');

function link(over) {
  return { linkId: 'L1', shopId: 's1', shopName: '店铺A', status: 'ok', confidence: 'high', ...over };
}

/** 只关心到手价时用：listed 默认等于 landed（无券无补贴的商品就该这样） */
function at(landed, listed) {
  return { listed: listed === undefined ? landed : listed, afterPromo: landed, landed };
}

function model(own, comp) {
  return { modelKey: 'gree-yj3-35', name: '云锦Ⅲ 1.5匹', brand: 'gree', ownLinks: own, competitorLinks: comp };
}

test('竞品到手价更低：算价差、比例、命中，并给出更低竞店数', () => {
  const r = evaluateModel(
    model([link(at(3299, 3399))], [link({ linkId: 'C1', shopId: 'c1', shopName: '对手A', ...at(3169, 3399) })]),
    {}
  );
  assert.equal(r.status, 'ok');
  assert.equal(r.own.price, 3299);
  assert.equal(r.competitor.price, 3169);
  assert.equal(r.gap, 130);
  assert.equal(r.gapRate, 0.0394);
  assert.equal(r.hit, true);
  assert.equal(r.big, true, '差 130 元属明显击穿，要单独推');
  assert.equal(r.competitor.otherLower, 0);
});

test('比的是到手价：标价一样但券和国补不同，照样算竞品更低', () => {
  // 这台正是改造前会漏报的情形：两边标价都是 3098，竞品多减了券和国补
  const r = evaluateModel(
    model([link(at(3098, 3098))], [link({ linkId: 'C1', shopName: '对手A', ...at(2378.3, 3098) })]),
    {}
  );
  assert.equal(r.own.listed, 3098);
  assert.equal(r.competitor.listed, 3098, '标价完全相同');
  assert.equal(r.gap, 719.7, '差别全在券和国补上');
  assert.equal(r.hit, true);
});

test('竞品更贵：不命中，也不产生任何告警', () => {
  const r = evaluateModel(model([link(at(3299))], [link({ linkId: 'C1', shopName: '对手A', ...at(3599) })]), {});
  assert.equal(r.gap, -300);
  assert.equal(r.hit, false);
  assert.equal(r.big, false);
});

test('差 3 元命中（金额门槛）；差 2.9 元既不到 3 元也不到 0.3%，不命中', () => {
  const hit = evaluateModel(model([link(at(3000))], [link({ linkId: 'C1', shopName: 'A', ...at(2997) })]), {});
  assert.equal(hit.gap, 3);
  assert.equal(hit.hit, true);

  const miss = evaluateModel(model([link(at(3000))], [link({ linkId: 'C1', shopName: 'A', ...at(2997.1) })]), {});
  assert.equal(miss.gap, 2.9);
  assert.equal(miss.hit, false, '差 2.9 元：不到 3 元，比例也只有 0.097%，两边都不满足');
});

test('比例门槛在千元以下会先触发：800 元差 2.6 元（0.325%）要报', () => {
  const r = evaluateModel(model([link(at(800))], [link({ linkId: 'C1', shopName: 'A', ...at(797.4) })]), {});
  assert.equal(r.gap, 2.6);
  assert.equal(r.gapRate >= DEFAULTS.minGapRate, true);
  assert.equal(r.hit, true, '金额不满足但比例满足，按"任一即报"命中');
});

test('对空调（几千元）通常由金额门槛先触发，比例门槛兜底低价商品', () => {
  // 3000 元的 0.3% 是 9 元，所以差 5 元时只有金额门槛起作用
  const r = evaluateModel(model([link(at(3000))], [link({ linkId: 'C1', shopName: 'A', ...at(2995) })]), {});
  assert.equal(r.gapRate < DEFAULTS.minGapRate, true);
  assert.equal(r.hit, true, '靠金额门槛命中，说明比例门槛在这个价位不起作用');
});

test('拿不到到手价（只有标价）：这条不参与判价，绝不拿标价冒充到手价', () => {
  const onlyListed = readLink(link({ listed: 3098, afterPromo: null, landed: null }), DEFAULTS);
  assert.equal(onlyListed.ok, false);
  assert.equal(onlyListed.reason, 'no_landed');

  // 竞品只有标价时不能下"竞品更贵"的结论，否则就是拿标价去比到手价，必然错
  const r = evaluateModel(
    model([link(at(3098))], [link({ linkId: 'C1', shopName: 'A', listed: 3500, afterPromo: null, landed: null })]),
    {}
  );
  assert.equal(r.status, 'no_competitor');
  assert.equal(r.hit, false);
});

test('恒等式被违反（到手价高于券后价）→ 该链接作废', () => {
  const bad = readLink(link({ listed: 3000, afterPromo: 2800, landed: 2900 }), DEFAULTS);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'identity_violation');

  const r = evaluateModel(
    model([link(at(3299))], [link({ linkId: 'C1', shopName: 'A', listed: 3000, afterPromo: 2800, landed: 2900 })]),
    {}
  );
  assert.equal(r.status, 'no_competitor', '唯一竞品链接坏了，就不能下结论');
  assert.equal(r.hit, false);
});

test('价格超出合理区间（把销量/编号当价格）直接判废', () => {
  assert.equal(readLink(link(at(0.5)), DEFAULTS).reason, 'out_of_range');
  assert.equal(readLink(link(at(999999)), DEFAULTS).reason, 'out_of_range');
});

test('我方全部失败：标 no_own，不判价，进待处理', () => {
  const r = evaluateModel(
    model([link({ status: 'failed' }), link({ linkId: 'L2', status: 'blocked' })], [link({ linkId: 'C1', shopName: 'A', ...at(2999) })]),
    {}
  );
  assert.equal(r.status, 'no_own');
  assert.equal(r.hit, false);
  assert.equal(r.failed.own, 2);
  assert.ok(r.notes[0].includes('不判价'));
});

test('竞品全部失败：不能因为"没看到更便宜"就说竞品更贵', () => {
  const r = evaluateModel(model([link(at(3299))], [link({ linkId: 'C1', shopName: 'A', status: 'failed' })]), {});
  assert.equal(r.status, 'no_competitor');
  assert.equal(r.hit, false);
});

test('机型层取最低：多店在售不重复报，更低竞店按店铺去重', () => {
  const r = evaluateModel(
    model(
      [
        link({ linkId: 'O1', shopName: '我方A店', ...at(3399) }),
        link({ linkId: 'O2', shopName: '我方B店', ...at(3299) })
      ],
      [
        link({ linkId: 'C1', shopId: 'c1', shopName: '对手A', ...at(3169) }),
        link({ linkId: 'C2', shopId: 'c1', shopName: '对手A', ...at(3180) }), // 同一家店第二条链接
        link({ linkId: 'C3', shopId: 'c2', shopName: '对手B', ...at(3250) })
      ]
    ),
    {}
  );
  assert.equal(r.own.price, 3299, '我方取多店最低');
  assert.equal(r.own.count, 2);
  assert.equal(r.competitor.price, 3169);
  assert.equal(r.competitor.secondPrice, 3180);
  assert.equal(r.competitor.lowerCount, 2, '低于我方 3299 的是对手A、对手B 两家店');
  assert.equal(r.competitor.otherLower, 1, '对手A 挂两条链接只算一家，所以"另有 1 家更低"');
});

test('我方多店价差 >5%：标内部冲突，但仍按最低价判价', () => {
  const r = evaluateModel(
    model(
      [
        link({ linkId: 'O1', shopName: '我方A店', ...at(3299) }),
        link({ linkId: 'O2', shopName: '我方B店', ...at(2999) })
      ],
      [link({ linkId: 'C1', shopName: '对手A', ...at(3201) })]
    ),
    {}
  );
  assert.ok(r.internalConflict, '10% 价差应当被识别');
  assert.equal(r.internalConflict.lowShop, '我方B店');
  assert.equal(r.gap, -202, '按我方最低 2999 判，不报警');
  assert.equal(r.hit, false);
  assert.ok(r.notes.some((n) => n.includes('内部')));
});

test('置信度取两边最差的：任一侧 low 就提示"可能偏高"', () => {
  const r = evaluateModel(
    model([link({ ...at(3098), confidence: 'high' })], [link({ linkId: 'C1', shopName: 'A', ...at(2999), confidence: 'low' })]),
    {}
  );
  assert.equal(r.confidence, 'low');
  assert.ok(r.notes.some((n) => n.includes('可能偏高')));
});

test('状态机：首次跌破报 open，持续便宜不重复报，回升报 recovered，再跌破再报', () => {
  const row = { status: 'ok', hit: true, gap: 130 };
  assert.equal(decideAlert(null, row), 'open');
  assert.equal(decideAlert({ status: 'open', gap: 130 }, row), 'none', '同一事件不重复打扰');
  assert.equal(decideAlert({ status: 'open', gap: 130 }, { status: 'ok', hit: false, gap: -20 }), 'recovered');
  assert.equal(decideAlert({ status: 'recovered', gap: -20 }, row), 'open', '回升后再跌破算新事件');
});

test('人工忽略/已处理：不因为还便宜就反复弹，回升后才重新开始', () => {
  const row = { status: 'ok', hit: true, gap: 130 };
  assert.equal(decideAlert({ status: 'ignored', gap: 130 }, row), 'none');
  assert.equal(decideAlert({ status: 'recovered', gap: -5 }, row), 'open');
});

test('继续下探默认不报，打开开关且再降 10 元以上才报', () => {
  const row = { status: 'ok', hit: true, gap: 100 };
  assert.equal(decideAlert({ status: 'open', gap: 130 }, row), 'none');
  assert.equal(decideAlert({ status: 'open', gap: 130 }, row, { deepTrack: true }), 'deepen');
  assert.equal(decideAlert({ status: 'open', gap: 105 }, row, { deepTrack: true }), 'none', '只降 5 元不值得打扰');
});

test('数据缺失的机型永远不触发告警', () => {
  assert.equal(decideAlert(null, { status: 'no_own', hit: false }), 'none');
  assert.equal(decideAlert({ status: 'open', gap: 130 }, { status: 'no_competitor', hit: false }), 'none');
});

test('汇总：命中数、最大价差、缺失链接数一次给全', () => {
  const { rows, summary } = evaluateAll([
    model([link(at(3299))], [link({ linkId: 'C1', shopName: 'A', ...at(3169) })]),
    { ...model([link(at(2599))], [link({ linkId: 'C2', shopName: 'B', ...at(2580) })]), modelKey: 'gree-yj3-28' },
    { ...model([link({ status: 'failed' })], [link({ linkId: 'C3', shopName: 'C', ...at(2999) })]), modelKey: 'haier-35' }
  ]);
  assert.equal(rows.length, 3);
  assert.equal(summary.hits, 2);
  assert.equal(summary.maxGap, 130);
  assert.equal(summary.missingOwn, 1);
  assert.equal(summary.failedLinks, 1);
  assert.equal(summary.evaluated, 2);
});
