'use strict';

// 产品知识库列表的排序口径（2026-10-28 用户拍板：按累计销量、零销量排最后、不折叠）。
//
// 这套测试守四件事：
//   1. 默认按累计销量排，且「有销量的永远在零销量之前」这条不许被删掉；
//   2. 换排序口径时销量列还在（否则一换「按系列」整列变「—」，像数据丢了）；
//   3. 没有销量表的环境不能挂（不能生成引用了 s.units 却没有 join 的 SQL）；
//   4. 销量数字的映射：0 台和「没有销量表」是两件事，不能都变成 0。

const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeSort,
  buildListQuery,
  mapProductRow,
  mapSalesTotals
} = require('../lib/product/list-query');

const TENANT = '11111111-1111-1111-1111-111111111111';

function orderByOf(sql) {
  const index = sql.indexOf('ORDER BY');
  assert.ok(index > 0, 'SQL 里应该有 ORDER BY');
  return sql.slice(index);
}

test('默认排序：按累计销量，且零销量排在最后', () => {
  const { sql, order, args } = buildListQuery({ tenant: TENANT, hasSales: true });
  assert.equal(order, 'sales');
  assert.deepEqual(args, [TENANT]);
  const orderBy = orderByOf(sql);
  /* 这条 CASE 是「零销量排最后」的唯一实现，删掉就会让 0 台混进主销机型中间 */
  assert.ok(orderBy.includes('CASE WHEN coalesce(s.units,0)>0 THEN 0 ELSE 1 END'), '缺少「有销量优先」的 CASE');
  assert.ok(/coalesce\(s\.units,0\) DESC/.test(orderBy), '缺少按台数降序');
  assert.ok(orderBy.includes("p.data->>'distribution'"), '同台数应按分销机型收口');
  assert.ok(orderBy.includes("p.data->>'model'"), '最后要按型号收口，保证顺序稳定');
});

test('排序口径写错时回落「按销量」，不把列表排成随机顺序', () => {
  assert.equal(normalizeSort(''), 'sales');
  assert.equal(normalizeSort(undefined), 'sales');
  assert.equal(normalizeSort('price'), 'sales');
  assert.equal(normalizeSort('series'), 'series');
  assert.equal(normalizeSort('updated'), 'updated');
});

test('按系列 / 按最近更新：仍然带销量列', () => {
  for (const sort of ['series', 'updated']) {
    const { sql, order } = buildListQuery({ tenant: TENANT, sort, hasSales: true });
    assert.equal(order, sort);
    assert.ok(sql.includes('coalesce(s.units,0)::bigint AS units'), `${sort}：销量列不能丢`);
    assert.ok(sql.includes('LEFT JOIN'), `${sort}：既然要销量列就必须 join`);
    if (sort === 'series') assert.ok(orderByOf(sql).includes("p.data->>'series'"));
    if (sort === 'updated') assert.ok(orderByOf(sql).includes('p.updated_at DESC'));
  }
});

test('没有销量表的环境：降级排序，且绝不引用 s.units', () => {
  const { sql, order } = buildListQuery({ tenant: TENANT, sort: 'sales', hasSales: false });
  assert.equal(order, 'sales');
  assert.ok(!sql.includes('sales_structure_settlement_items'), '没销量表就不该查它');
  assert.ok(!sql.includes('s.units'), '没有 join 却引用 s.units，数据库会直接报错');
  assert.ok(orderByOf(sql).includes("p.data->>'distribution'"), '降级后仍按分销 + 更新时间排');
});

test('分组与搜索：占位符编号和参数顺序必须对得上', () => {
  const { sql, args } = buildListQuery({
    tenant: TENANT,
    group: 'gree-ac',
    q: 'KFR-35',
    hasSales: true
  });
  assert.equal(args[0], TENANT);
  assert.equal(args[1], 'gree-ac');
  assert.equal(args[2], '%KFR-35%');
  assert.ok(sql.includes("p.data->>'group'=$2"), 'group 用 $2');
  assert.ok(sql.includes('ILIKE $3'), '搜索用 $3');
  assert.ok(sql.includes('WHERE p.tenant_id=$1'), '租户永远是 $1');
  /* 搜索要能按物料编码找，否则主管拿编码查不到型号 */
  assert.ok(sql.includes("p.data->>'materialCode' ILIKE $3"));
});

test('销量映射：0 台 ≠ 没有销量表', () => {
  const zero = mapProductRow({ id: 'a', data: {}, units: '0' });
  assert.equal(zero.units, 0);
  const none = mapProductRow({ id: 'b', data: {} });
  assert.equal(none.units, null, '没有销量表时应为 null，不能假装卖了 0 台');
  const some = mapProductRow({ id: 'c', data: {}, units: '2687', last_date: '2026-07-29' });
  assert.equal(some.units, 2687);
  assert.equal(some.lastSaleDate, '2026-07-29');
});

test('销量口径汇总：字段齐全、空表不炸', () => {
  const totals = mapSalesTotals({ units: '8002', from_date: '2025-04-11', to_date: '2026-07-29', skus: '58', shops: '3' });
  assert.deepEqual(totals, { units: 8002, from: '2025-04-11', to: '2026-07-29', skus: 58, shops: 3 });
  const empty = mapSalesTotals(undefined);
  assert.deepEqual(empty, { units: 0, from: '', to: '', skus: 0, shops: 0 });
});
