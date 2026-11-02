'use strict';
/* 链接导入与「查看链接」清单的单测。
 *
 * 钉两件事：
 *   ① 各种京东链接写法都要能取出商品编号，且归一成同一个地址（否则同一条链接会重复入库）；
 *   ② 清单必须把「已停用」「还没采过」的链接也列出来 —— 用户看不到自己导进去的链接，
 *      就是这个页面最初被要求做的原因（2026-11-02）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const links = require('../lib/price/links');
const view = require('../lib/price/view');

test('商品编号：PC 页、移动页、分享参数、纯编号都能认', () => {
  assert.equal(links.parseSku('https://item.jd.com/10175592455372.html'), '10175592455372');
  assert.equal(links.parseSku('https://item.m.jd.com/product/10175592455372.html'), '10175592455372');
  assert.equal(links.parseSku('https://item.jd.com/product/10175592455372.html'), '10175592455372');
  assert.equal(links.parseSku('https://u.jd.com/abc?skuId=10175592455372'), '10175592455372');
  assert.equal(links.parseSku('10175592455372'), '10175592455372');
  assert.equal(links.parseSku('https://www.jd.com'), null);
  assert.equal(links.parseSku(''), null);
});

test('归一地址：同一条商品的不同写法算同一条，避免重复入库', () => {
  const a = links.normalizeUrl('https://item.jd.com/10175592455372.html?extension_id=xx&cu=true');
  const b = links.normalizeUrl('https://item.m.jd.com/product/10175592455372.html?utm_source=ios');
  assert.equal(a, 'https://item.jd.com/10175592455372.html');
  assert.equal(a, b);
  assert.equal(links.normalizeUrl('https://www.jd.com'), null);
});

test('粘贴文本解析：跳过无效行、批内去重，但无效的必须报出来', () => {
  const r = links.parseText(`
    https://item.jd.com/100012043978.html
    https://item.m.jd.com/product/100012043978.html
    https://item.jd.com/100021234567.html，100045678901
    这不是链接
  `);
  assert.equal(r.items.length, 3, '两条重复的合成一条');
  assert.equal(r.dup, 1);
  assert.equal(r.invalid.length, 1);
  assert.ok(r.invalid[0].includes('这不是链接'), '无效内容要原样带回给用户看');
});

test('导入判定：库里有 = exists，库里没有 = create，带上已挂的机型', () => {
  const { items } = links.parseText('https://item.jd.com/1.html https://item.jd.com/22.html');
  const existing = new Map([['https://item.jd.com/1.html', { model_id: 'm1', model_key: 'gree-云佳pro-1.5匹' }]]);
  const { rows, counts } = links.classify(items, existing);
  assert.deepEqual(counts, { total: 2, create: 1, exists: 1 });
  const hit = rows.find((r) => r.sku === '1');
  assert.equal(hit.state, 'exists');
  assert.equal(hit.modelKey, 'gree-云佳pro-1.5匹');
  assert.equal(rows.find((r) => r.sku === '22').state, 'create');
});

test('机型键与显示名：和 scripts/price-import.js 的口径一致', () => {
  assert.equal(links.modelKeyOf({ brand: 'gree', series: '云佳Pro', capacity: '1.5匹' }), 'gree-云佳pro-1.5匹');
  assert.equal(links.modelKeyOf({ brand: 'Gree', series: ' 云佳 Pro ', capacity: '' }), 'gree-云佳pro');
  assert.equal(links.modelNameOf({ brand: 'gree', series: '云佳Pro', capacity: '1.5匹' }), '格力 云佳Pro 1.5匹');
  assert.equal(links.brandOf('格力'), 'gree');
  assert.equal(links.brandOf('海尔'), 'haier');
  assert.equal(links.brandOf('瞎写'), null);
});

/* ---------------- 查看链接清单 ---------------- */

function models() {
  return [
    {
      id: 'm1',
      brand: 'gree',
      series: '云佳Pro',
      code: 'KFR-35GW/NhAa1BAj',
      capacity: '1.5匹',
      priority: true,
      status: 'active',
      links: [
        { id: 'l1', side: 'own', url: 'https://item.jd.com/10175592455372.html', sku: '10175592455372', shopName: '格力旗舰店', title: '格力云佳Pro 1.5匹', status: 'active' },
        { id: 'l2', side: 'competitor', url: 'https://item.jd.com/100212513162.html', sku: '100212513162', shopName: '格力京东自营旗舰店', title: null, status: 'active' },
        { id: 'l3', side: 'competitor', url: 'https://item.jd.com/10149212746799.html', sku: '10149212746799', shopName: '格力官方旗舰店', title: '', status: 'paused' }
      ]
    },
    {
      id: 'm2',
      brand: 'haier',
      series: '静悦',
      capacity: '1.5匹',
      status: 'active',
      links: []
    }
  ];
}

test('查看链接：按商品分组，已停用和从未采集的链接也列出来', () => {
  const latest = new Map([
    ['l1', { last_status: 'ok', last_reason: null, last_at: '2026-11-02T02:00:00Z', ok_landed: '2378.30', ok_listed: '3098.00', ok_at: '2026-11-02T02:00:00Z' }],
    ['l2', { last_status: 'blocked', last_reason: '被风控/验证码拦截', last_at: '2026-11-02T02:05:00Z', ok_landed: '2549.15', ok_listed: '2549.15', ok_at: '2026-11-01T02:00:00Z' }]
    // l3 没有任何快照
  ]);
  const { groups, summary } = view.buildLinkGroups(models(), latest);

  assert.equal(groups.length, 2, '没有链接的商品也要出现，只是 links 为空');
  assert.equal(groups[0].id, 'm1', '重点机型排最前');
  assert.equal(summary.links, 3);
  assert.equal(summary.own, 1);
  assert.equal(summary.comp, 2);
  assert.equal(summary.paused, 1);

  const g = groups[0];
  assert.equal(g.ownCount, 1);
  assert.equal(g.compCount, 2);
  assert.equal(g.pausedCount, 1);

  const own = g.links.find((l) => l.id === 'l1');
  assert.equal(own.price, 2378.3);
  assert.equal(own.listed, 3098);
  assert.equal(own.obsStatus, 'ok');
  assert.equal(own.shop, '格力旗舰店');

  const blocked = g.links.find((l) => l.id === 'l2');
  assert.equal(blocked.obsStatus, 'blocked');
  assert.equal(blocked.price, 2549.15, '今天失败了也要显示最近一次成功的价，方便对账');
  assert.equal(blocked.title, '', '没有标题就留空，由页面兜底成店铺名');

  const paused = g.links.find((l) => l.id === 'l3');
  assert.equal(paused.status, 'paused');
  assert.equal(paused.price, null, '从没采过就是空，不能编一个 0');
  assert.equal(paused.at, '—');
});

test('查看链接：缺 sku 时从链接里兜底取，点开才不会变成坏链', () => {
  const m = models();
  m[0].links[1].sku = null;
  const { groups } = view.buildLinkGroups(m, new Map());
  assert.equal(groups[0].links.find((l) => l.id === 'l2').sku, '100212513162');
});
