const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractLinks,
  platformOfHost,
  shopIdsOfLink,
  judgeLink,
  detectLinkSignals,
  renderLinkBriefing,
  resetDirectoryCache
} = require('../lib/quality/ai/link-policy');

function session(messages) {
  return {
    agent: '格力旗舰店售前-01',
    startedAt: '2026-10-20 10:00:00',
    endedAt: '2026-10-20 10:10:00',
    messages: messages.map((item, index) => ({ id: index, ...item }))
  };
}

// ---------- 链接抽取 ----------

test('抽取链接：带协议、裸域名、短链都能识别', () => {
  const links = extractLinks('看这个 https://item.jd.com/100012043978.html 和 mall.jd.com/index-123456.html，还有 3.cn/abc');
  const hosts = links.map(item => item.host);
  assert.ok(hosts.includes('item.jd.com'));
  assert.ok(hosts.includes('mall.jd.com'));
  assert.ok(hosts.includes('3.cn'));
});

test('抽取链接：中文句子里的价格、小数点不误判为链接', () => {
  const links = extractLinks('活动价 3999.00 元，1.5 匹的机器，2.0 版本已上线');
  assert.equal(links.length, 0);
});

test('抽取链接：去重，同一条链接不重复计', () => {
  const links = extractLinks('jd.com/a 和 jd.com/a 还有 https://jd.com/a');
  assert.equal(links.length, 1);
});

test('店铺 ID：能从京东店铺链接里提取', () => {
  const [link] = extractLinks('https://mall.jd.com/index-1000004123.html');
  assert.deepEqual(shopIdsOfLink(link), ['1000004123']);
});

// ---------- 平台识别 ----------

test('平台识别：京东/天猫/淘宝算我司在售平台', () => {
  assert.equal(platformOfHost('item.jd.com').id, 'jd');
  assert.equal(platformOfHost('detail.tmall.com').id, 'tmall');
  assert.equal(platformOfHost('shop123.taobao.com').id, 'taobao');
  assert.equal(platformOfHost('item.jd.com').own, true);
});

test('平台识别：拼多多/抖音/闲鱼不是我司平台', () => {
  assert.equal(platformOfHost('mobile.yangkeduo.com').id, 'pdd');
  assert.equal(platformOfHost('haohuo.jinritemai.com').id, 'douyin');
  assert.equal(platformOfHost('2.taobao.com').id, 'xianyu', '闲鱼域名比淘宝更长，应优先命中');
  assert.equal(platformOfHost('2.taobao.com').own, false);
});

// ---------- 判定 ----------

test('判定：京东链接 → 同平台但店铺不明（交人工，不判违规）', () => {
  resetDirectoryCache();
  const [link] = extractLinks('https://item.jd.com/100012043978.html');
  const judged = judgeLink(link);
  assert.equal(judged.verdict, 'same_platform_undeclared');
});

test('判定：拼多多链接 → 跨平台', () => {
  resetDirectoryCache();
  const [link] = extractLinks('https://mobile.yangkeduo.com/goods.html?goods_id=1');
  assert.equal(judgeLink(link).verdict, 'cross_platform');
});

test('判定：微信链接 → 站外渠道', () => {
  resetDirectoryCache();
  const [link] = extractLinks('https://weixin.qq.com/r/abc');
  assert.equal(judgeLink(link).verdict, 'offsite_channel');
});

test('判定：未知域名 → external_unknown，不判违规', () => {
  resetDirectoryCache();
  const [link] = extractLinks('https://www.some-random-shop.com/item/1');
  assert.equal(judgeLink(link).verdict, 'external_unknown');
});

test('白名单：配置店铺 ID 后，同平台链接判为我司店铺', () => {
  process.env.QUALITY_SHOP_WHITELIST = JSON.stringify([
    { name: '格力旗舰店（京东POP）', platform: 'jd', hosts: [], shopIds: ['1000004123'], nameKeywords: ['格力旗舰店'] }
  ]);
  resetDirectoryCache();
  const [link] = extractLinks('https://mall.jd.com/index-1000004123.html');
  const judged = judgeLink(link);
  assert.equal(judged.verdict, 'own_shop');
  assert.equal(judged.shopName, '格力旗舰店（京东POP）');
  delete process.env.QUALITY_SHOP_WHITELIST;
  resetDirectoryCache();
});

test('白名单：配置店铺域名后，子域也命中', () => {
  process.env.QUALITY_SHOP_WHITELIST = JSON.stringify([
    { name: '喵速达（天猫）', platform: 'tmall', hosts: ['miaosuda.tmall.com'], shopIds: [], nameKeywords: ['喵速达'] }
  ]);
  resetDirectoryCache();
  const [link] = extractLinks('https://miaosuda.tmall.com/category.htm');
  assert.equal(judgeLink(link).verdict, 'own_shop');
  delete process.env.QUALITY_SHOP_WHITELIST;
  resetDirectoryCache();
});

// ---------- 会话扫描 ----------

test('会话扫描：只统计客服消息里的链接，顾客发的不算', () => {
  resetDirectoryCache();
  const signals = detectLinkSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '这个链接对吗 jd.com/a' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '对的，就是这款' }
  ]));
  assert.equal(signals.links.length, 0);
});

test('会话扫描：统计各判定结果的数量', () => {
  resetDirectoryCache();
  const signals = detectLinkSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '有别的店吗' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '拼多多这家更便宜 mobile.yangkeduo.com/goods.html' },
    { role: 'agent', at: '2026-10-20 10:00:20', text: '我们京东店 item.jd.com/100.html' }
  ]));
  assert.equal(signals.summary.total, 2);
  assert.equal(signals.summary.crossPlatform, 1);
  assert.equal(signals.summary.undetermined, 1);
});

test('会话扫描：白名单未录入具体 ID 时，标记为未配置', () => {
  resetDirectoryCache();
  const signals = detectLinkSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '发个链接' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: 'item.jd.com/100.html' }
  ]));
  assert.equal(signals.summary.whitelistConfigured, false);
  assert.match(renderLinkBriefing(signals), /白名单尚未录入/);
});

test('简报：无链接时明确告知，避免模型臆造', () => {
  resetDirectoryCache();
  const signals = detectLinkSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '什么时候发货' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '今天下午安排发出' }
  ]));
  assert.match(renderLinkBriefing(signals), /未发现任何链接/);
});

// ---------- 资源域名与官方页 ----------

test('资源域名：京东商品图片地址不参与导流判定', () => {
  resetDirectoryCache();
  const [link] = extractLinks('https://dd-static.jd.com/abc123.jpg');
  const judged = judgeLink(link);
  assert.equal(judged.verdict, 'platform_asset');
});

test('资源域名：视频托管地址不算导流', () => {
  resetDirectoryCache();
  const [link] = extractLinks('https://vod.300hu.com/abc/video.mp4');
  assert.equal(judgeLink(link).verdict, 'platform_asset');
});

test('官方页：优惠券与直播间算平台内正常引导', () => {
  resetDirectoryCache();
  assert.equal(judgeLink(extractLinks('https://coupon.m.jd.com/coupons/show.action')[0]).verdict, 'platform_official');
  assert.equal(judgeLink(extractLinks('https://lives.jd.com/#/123')[0]).verdict, 'platform_official');
});

// ---------- 导流话术 ----------

test('导流话术：识别"别家更便宜""换一家"这类表述', () => {
  resetDirectoryCache();
  const signals = detectLinkSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '你们这太贵了' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '别家更便宜的话您可以换一家看看' }
  ]));
  assert.equal(signals.diversionHints.length, 1);
  assert.match(renderLinkBriefing(signals), /导流话术/);
});

test('导流话术：顾客说的话不算，只看客服', () => {
  resetDirectoryCache();
  const signals = detectLinkSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '拼多多上更便宜' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '我们这边是官方授权，价格和售后都有保障' }
  ]));
  assert.equal(signals.diversionHints.length, 0);
});

test('简报：无导流话术时明确说明同平台链接按合规处理', () => {
  resetDirectoryCache();
  const signals = detectLinkSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '发我看下' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '这是这款的链接 item.jd.com/100.html' }
  ]));
  assert.match(renderLinkBriefing(signals), /按合规处理/);
});
