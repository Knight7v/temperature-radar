'use strict';

// 店铺链接判定（2026-10-22 客服主管新增要求 3）。
//
// 主管口径：
//   ① 引导到我司【同一平台的其他店铺】→ 不违规（白名单放行）
//   ② 跨平台引导 → 违规
//   ③ 引导至非我司店铺 → 违规
//
// 落地难点：光看域名只能判断"哪个平台"，判断不了"哪家店"。
//   京东 item.jd.com/100xxx.html 里只有商品 ID，没有店铺 ID；
//   天猫 detail.tmall.com/item.htm?id= 同理。
// 因此本模块分两段：
//   第一段（代码确定）：抽出链接 → 识别平台 → 命中白名单的直接判 own_shop。
//   第二段（交模型+人工）：平台对但是店铺无法确定时，标 same_platform_undetermined，
//   不在代码层判违规，交模型结合上下文 + 主管复核。宁可漏判，不可误杀。
//
// 白名单维护：编辑 config/quality-shops.json（结构见 quality-shops.example.json），
// 或用环境变量 QUALITY_SHOP_WHITELIST 传入同结构 JSON 覆盖。

const fs = require('fs');
const path = require('path');

// ---------- 平台表（我司在售平台标记 own=true） ----------
const PLATFORMS = Object.freeze({
  jd: { label: '京东', own: true, hosts: ['jd.com', 'jd.hk', '3.cn', 'jd.cn', 'jdmall.com'] },
  tmall: { label: '天猫', own: true, hosts: ['tmall.com', 'tmall.hk'] },
  taobao: { label: '淘宝', own: true, hosts: ['taobao.com', 'tb.cn', 'm.tb.cn'] },
  pdd: { label: '拼多多', own: false, hosts: ['pinduoduo.com', 'yangkeduo.com'] },
  douyin: { label: '抖音', own: false, hosts: ['douyin.com', 'jinritemai.com', 'iesdouyin.com'] },
  kuaishou: { label: '快手', own: false, hosts: ['kuaishou.com', 'gifshow.com'] },
  vip: { label: '唯品会', own: false, hosts: ['vip.com'] },
  suning: { label: '苏宁', own: false, hosts: ['suning.com'] },
  xiaohongshu: { label: '小红书', own: false, hosts: ['xiaohongshu.com', 'xhslink.com'] },
  wechat: { label: '微信', own: false, hosts: ['weixin.qq.com', 'wechat.com', 'weixin.com'] },
  alipay: { label: '支付宝', own: false, hosts: ['alipay.com'] },
  xianyu: { label: '闲鱼', own: false, hosts: ['2.taobao.com', 'goofish.com'] }
});

// 图片 / 静态资源 / 视频托管域名：客服发商品图、安装视频是正常服务，不是导流。
// 实测历史数据里 dd-static.jd.com 出现 273 次，占了全部"链接"的一半以上，
// 若按导流处理会造成大面积误报，所以单独归为 asset，直接不参与判定。
const ASSET_HOST_PATTERNS = Object.freeze([
  /^dd-static\./, /(^|\.)360buyimg\.com$/, /(^|\.)jdimg\.com$/,
  /(^|\.)300hu\.com$/, /(^|\.)aliyuncs\.com$/, /(^|\.)qcloud\.com$/,
  /^img\d*\./, /^pic\d*\./, /^static\./, /^cdn\./, /^vod\./, /^video\./, /^res\./
]);

// 平台官方功能页：领券、直播间、帮助中心、售后政策页，属平台内正常引导。
const OFFICIAL_HOST_PATTERNS = Object.freeze([
  /^coupon\./, /^coupon\.m\./, /^help\./, /^service\./, /^m\.jd\.com$/,
  /^lives\./, /^live\./, /^kf\./, /^chat\./
]);

function isAssetHost(host) {
  return ASSET_HOST_PATTERNS.some(pattern => pattern.test(host));
}

function isOfficialHost(host) {
  return OFFICIAL_HOST_PATTERNS.some(pattern => pattern.test(host));
}

// ---------- 我司店铺白名单（默认值，可被 config 覆盖） ----------
// hosts：店铺专属域名，如 gelijianqi.tmall.com 这种一眼能认出来的
// shopIds：平台店铺 ID，京东 mall.jd.com/index-<id>.html、天猫 shopId 参数
// nameKeywords：中文店铺名关键词，用于识别"文字提及店铺名 + 链接"的情况
const DEFAULT_SHOPS = Object.freeze([
  { name: '格力旗舰店（京东POP）', platform: 'jd', hosts: [], shopIds: [], nameKeywords: ['格力旗舰店'] },
  { name: '格力空调换新', platform: 'jd', hosts: [], shopIds: [], nameKeywords: ['格力空调换新', '空调换新'] },
  { name: '格力空调正品专卖', platform: 'jd', hosts: [], shopIds: [], nameKeywords: ['格力空调正品专卖', '正品专卖店'] },
  { name: '格力直营旗舰店', platform: 'jd', hosts: [], shopIds: [], nameKeywords: ['格力直营旗舰', '直营旗舰店'] },
  { name: '董明珠健康家2号店', platform: 'jd', hosts: [], shopIds: [], nameKeywords: ['董明珠健康家'] },
  { name: '喵速达（天猫）', platform: 'tmall', hosts: [], shopIds: [], nameKeywords: ['喵速达'] },
  { name: '喵住（天猫）', platform: 'tmall', hosts: [], shopIds: [], nameKeywords: ['喵住'] },
  { name: '海尔星河', platform: 'tmall', hosts: [], shopIds: [], nameKeywords: ['海尔星河', '星河旗舰店'] },
  { name: '海尔优选', platform: 'tmall', hosts: [], shopIds: [], nameKeywords: ['海尔优选'] },
  { name: '长缨星河', platform: 'tmall', hosts: [], shopIds: [], nameKeywords: ['长缨星河'] }
]);

// ---------- 配置加载 ----------
let cachedDirectory = null;

function configPath() {
  return path.join(__dirname, '..', '..', '..', 'config', 'quality-shops.json');
}

function loadDirectory() {
  if (cachedDirectory) return cachedDirectory;
  let shops = DEFAULT_SHOPS;
  let source = 'default';

  try {
    const raw = process.env.QUALITY_SHOP_WHITELIST;
    if (raw && String(raw).trim()) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        shops = parsed;
        source = 'env';
      }
    }
  } catch (error) {
    // 环境变量格式错误不影响主流程，退回默认白名单
  }

  if (source === 'default') {
    try {
      const file = configPath();
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        const list = Array.isArray(parsed) ? parsed : parsed?.shops;
        if (Array.isArray(list) && list.length) {
          shops = list;
          source = 'file';
        }
      }
    } catch (error) {
      // 配置文件损坏时退回默认值，不让质检整体失败
    }
  }

  cachedDirectory = {
    source,
    shops: shops.map(item => ({
      name: String(item?.name || ''),
      platform: String(item?.platform || ''),
      hosts: (Array.isArray(item?.hosts) ? item.hosts : []).map(host => String(host).toLowerCase()),
      shopIds: (Array.isArray(item?.shopIds) ? item.shopIds : []).map(String),
      nameKeywords: (Array.isArray(item?.nameKeywords) ? item.nameKeywords : []).map(String)
    }))
  };
  return cachedDirectory;
}

// 测试用：重置缓存
function resetDirectoryCache() {
  cachedDirectory = null;
}

// ---------- 链接抽取 ----------

// 同时支持带协议、带 www.、裸域名；中文标点作为边界。
const URL_PATTERN = /(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|cn|net|hk|co|top|xyz|vip|shop|link|cc|io)(?::\d{2,5})?(?:\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*)?/gi;

function extractLinks(text) {
  const source = String(text ?? '');
  const found = [];
  let match;
  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(source)) !== null) {
    const raw = match[0].replace(/[.,;:!?)\]]+$/, '');
    if (!raw) continue;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    let parsed;
    try {
      parsed = new URL(withScheme);
    } catch (error) {
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('.')) continue;
    // 按"域名+路径+参数"去重：同一条链接写成 jd.com/a 和 https://jd.com/a 视为同一条
    const key = `${host}${parsed.pathname || ''}${parsed.search || ''}`.toLowerCase();
    if (!found.some(item => item.key === key)) {
      found.push({ raw, host, pathname: parsed.pathname || '', search: parsed.search || '', key });
    }
  }
  return found;
}

function platformOfHost(host) {
  const target = String(host || '').toLowerCase();
  if (!target) return null;
  // 从最具体到最宽泛匹配，避免 2.taobao.com 被 taobao.com 抢先命中
  let best = null;
  let bestLength = -1;
  for (const [key, meta] of Object.entries(PLATFORMS)) {
    for (const candidate of meta.hosts) {
      if (target === candidate || target.endsWith(`.${candidate}`)) {
        if (candidate.length > bestLength) {
          best = key;
          bestLength = candidate.length;
        }
      }
    }
  }
  return best ? { id: best, ...PLATFORMS[best] } : null;
}

// 从链接里尽力抽取店铺 ID（京东 index-<id>.html、shopId=、天猫 shopId）
function shopIdsOfLink(link) {
  const ids = [];
  const text = `${link.pathname}${link.search}`;
  const patterns = [
    /index-(\d+)\.html/i,
    /[?&]shopId=(\d+)/i,
    /[?&]shop_id=(\d+)/i,
    /mall\.jd\.com\/(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

function matchesShop(link, shop) {
  const host = link.host;
  for (const allowed of shop.hosts) {
    if (!allowed) continue;
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  const ids = shopIdsOfLink(link);
  if (ids.length && shop.shopIds.some(id => ids.includes(String(id)))) return true;
  return false;
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (error) {
    return String(value || '');
  }
}

/**
 * 判定单条链接。
 * verdict 取值：
 *   own_shop                 → 我司店铺，合规
 *   platform_asset           → 商品图/视频等静态资源，不是导流，不参与判定
 *   platform_official        → 平台官方功能页（领券/直播/帮助），合规
 *   same_platform_undeclared → 同平台商品页但无法确定哪家店，与导流话术结合看
 *   cross_platform           → 跨平台引导（疑似违规）
 *   offsite_channel          → 微信/支付宝等站外渠道（疑似违规）
 *   external_unknown         → 无法识别的域名，交人工
 */
function judgeLink(link) {
  const directory = loadDirectory();
  const platform = platformOfHost(link.host);

  for (const shop of directory.shops) {
    if (platform && shop.platform && shop.platform !== platform.id) continue;
    if (matchesShop(link, shop)) {
      return {
        verdict: 'own_shop',
        platformId: platform?.id || '',
        platformLabel: platform?.label || '',
        shopName: shop.name,
        reason: `命中白名单店铺「${shop.name}」`
      };
    }
  }

  if (isAssetHost(link.host)) {
    return {
      verdict: 'platform_asset',
      platformId: platform?.id || '',
      platformLabel: platform?.label || '',
      shopName: '',
      reason: '图片或视频资源地址，用于展示商品与安装说明，不构成店铺导流'
    };
  }

  if (!platform) {
    return {
      verdict: 'external_unknown',
      platformId: '',
      platformLabel: '',
      shopName: '',
      reason: '域名不在已知电商平台清单内，无法判断归属'
    };
  }

  if (platform.id === 'wechat' || platform.id === 'alipay') {
    return {
      verdict: 'offsite_channel',
      platformId: platform.id,
      platformLabel: platform.label,
      shopName: '',
      reason: `链向${platform.label}，属站外沟通/支付渠道`
    };
  }

  if (isOfficialHost(link.host)) {
    return {
      verdict: 'platform_official',
      platformId: platform.id,
      platformLabel: platform.label,
      shopName: '',
      reason: `${platform.label}官方功能页（领券/直播/帮助），属平台内正常引导`
    };
  }

  if (platform.own) {
    return {
      verdict: 'same_platform_undeclared',
      platformId: platform.id,
      platformLabel: platform.label,
      shopName: '',
      reason: `属${platform.label}（我司在售平台），但链接中无店铺标识，无法确认是否我司店铺`
    };
  }

  return {
    verdict: 'cross_platform',
    platformId: platform.id,
    platformLabel: platform.label,
    shopName: '',
    reason: `属${platform.label}，不是我司在售平台`
  };
}

// 导流话术：客服口头把顾客推向其他店铺/平台，即使没发链接也算导流。
// 只作线索，不直接定性——"我们还有别的店铺，都是格力的"属于合规的自家店铺引导。
//
// ⚠️ 用词组而非单词：实测"其他平台""其他店铺"这类裸词会误命中
//   "您有在其他平台购买过空调类产品吗"（需求探询）
//   "不清楚其他店铺亲"（否认知情）
// 两者都不是导流。所以只匹配带动作指向的短语。
const DIVERSION_HINTS = Object.freeze([
  '去别家', '别家买', '别家更便宜', '别家看看', '换一家', '换家买',
  '去其他店', '其他店买', '别的店买', '去别的店',
  '去其他平台', '其他平台买', '其他平台下单', '别的平台买',
  '去拼多多', '拼多多上买', '抖音上买', '闲鱼上', '去抖音', '去闲鱼',
  '去京东买', '去天猫买', '官网买', '外面上买', '别买这家', '这家不划算'
]);

function detectDiversionHints(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const agents = messages.filter(item => item && item.role === 'agent' && String(item.text || '').trim());
  const found = [];
  for (const item of agents) {
    const text = String(item.text || '');
    const words = DIVERSION_HINTS.filter(word => text.includes(word));
    if (words.length) found.push({ messageId: item.id, words, snippet: text.slice(0, 60) });
  }
  return found;
}

/**
 * 扫描整个会话里的链接，并检测"文字提及非我司店铺"的情况。
 */
function detectLinkSignals(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const agents = messages.filter(item => item && item.role === 'agent' && String(item.text || '').trim());
  const links = [];
  for (const item of agents) {
    for (const link of extractLinks(item.text)) {
      const judged = judgeLink(link);
      links.push({
        messageId: item.id,
        url: link.raw.slice(0, 160),
        host: link.host,
        ...judged
      });
    }
  }

  const diversionHints = detectDiversionHints(session);
  const directory = loadDirectory();
  const ownNames = directory.shops.flatMap(shop => shop.nameKeywords).filter(Boolean);
  const summary = {
    total: links.length,
    own: links.filter(item => item.verdict === 'own_shop').length,
    asset: links.filter(item => item.verdict === 'platform_asset').length,
    official: links.filter(item => item.verdict === 'platform_official').length,
    crossPlatform: links.filter(item => item.verdict === 'cross_platform').length,
    offsite: links.filter(item => item.verdict === 'offsite_channel').length,
    undetermined: links.filter(item => item.verdict === 'same_platform_undeclared' || item.verdict === 'external_unknown').length,
    diversionHints: diversionHints.length,
    whitelistSource: directory.source,
    whitelistConfigured: directory.shops.some(shop => shop.hosts.length || shop.shopIds.length)
  };

  return { links, summary, ownNames, diversionHints };
}

// 给提示词用的简报
function renderLinkBriefing(signals) {
  if (!signals) return '';
  const { links, summary, diversionHints } = signals;
  const label = {
    own_shop: '✅ 我司店铺白名单命中 → 合规',
    platform_asset: '✅ 图片/视频资源 → 不参与导流判定',
    platform_official: '✅ 平台官方功能页 → 合规',
    same_platform_undeclared: '⚠️ 同平台商品页，店铺归属不明 → 无导流话术则判合规',
    cross_platform: '❌ 跨平台 → 疑似违规',
    offsite_channel: '❌ 站外渠道 → 疑似违规',
    external_unknown: '⚠️ 未知域名 → 不判违规，交人工'
  };

  const lines = [];
  if (!links.length) {
    lines.push('（客服消息中未发现任何链接或网址）');
  } else {
    // 资源类与官方页逐条列出价值不大，聚合计数；其余逐条列
    const notable = links.filter(item => !['platform_asset', 'platform_official'].includes(item.verdict));
    for (const item of notable) {
      lines.push(`  · 消息#${item.messageId}｜${item.host}｜${label[item.verdict] || item.verdict}｜${item.reason}｜原链接：${item.url}`);
    }
    const asset = links.filter(item => item.verdict === 'platform_asset');
    const official = links.filter(item => item.verdict === 'platform_official');
    if (asset.length) lines.push(`  · 另有 ${asset.length} 条图片/视频资源链接（${[...new Set(asset.map(i => i.host))].join('、')}）→ 合规，不影响判定`);
    if (official.length) lines.push(`  · 另有 ${official.length} 条平台官方功能页链接（${[...new Set(official.map(i => i.host))].join('、')}）→ 合规`);
    lines.push(`  合计：合规 ${summary.own} 条／资源与官方页 ${summary.asset + summary.official} 条／跨平台 ${summary.crossPlatform} 条／站外 ${summary.offsite} 条／待核 ${summary.undetermined} 条`);
  }

  if (diversionHints.length) {
    lines.push('【导流话术】客服消息中出现把顾客推向他处的表述，需结合上下文判断是否指向非我司店铺：');
    for (const item of diversionHints.slice(0, 5)) {
      lines.push(`  · 消息#${item.messageId}：命中「${item.words.join('/')}」｜原文：${item.snippet}`);
    }
  } else if (summary.undetermined) {
    lines.push('（客服消息中未出现"别家/其他店/换一家/更便宜"等导流话术，同平台链接按合规处理）');
  }

  if (!summary.whitelistConfigured && summary.total) {
    lines.push('  注意：店铺白名单尚未录入具体域名或店铺 ID，无法确认某条同平台链接是否我司店铺；没有导流话术时一律判合规。');
  }
  return lines.join('\n');
}

module.exports = {
  PLATFORMS,
  DEFAULT_SHOPS,
  DIVERSION_HINTS,
  loadDirectory,
  resetDirectoryCache,
  extractLinks,
  platformOfHost,
  shopIdsOfLink,
  isAssetHost,
  isOfficialHost,
  judgeLink,
  detectDiversionHints,
  detectLinkSignals,
  renderLinkBriefing
};
