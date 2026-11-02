'use strict';

/**
 * 京东前台采集器（自适应器模式的唯一实现）。
 *
 * 数据源决策（2026-10-30 用户拍板，不可回退）：
 *   只抓京东**前台**页面，不用京东联盟 API。联盟价是推广者视角，含顾客领不到的联盟专属券，
 *   拿它比价会稳定假报；而 PLUS 价、平台券、新人券联盟又不返回。
 *
 * 通道选择（2026-10-31 实测）：
 *   1. item.jd.com（PC 版）是前端渲染的空壳，且无登录态直接 302 到 passport.jd.com，无头浏览器
 *      还会被拦到 cfe.m.jd.com 的风险验证页 → 不可用。
 *   2. item.m.jd.com/product/<sku>.html（移动版）是**服务端直出**，一次 HTTP GET 就有标题、店铺、
 *      价格、促销等全部数据 → 用它。带登录态后价格才不打码。
 *
 * 到手价口径（2026-11-02）：
 *   本模块只负责「提取」，不做算术。标价、可叠加的直减券、国补开关三样原样取出，
 *   交给 lib/price/landed.js 去算 标价 → 券后 → 到手。分开的原因：
 *   算术要能被单测逐位固定，而 HTML 结构三个月一小改、半年一大改。
 *
 * 未登录时页面里的价格是 "3??8" 这种打码值，本模块一律识别为 need_login，
 * 绝不把打码值当价格写库（这是"不伪装数据完整"的底线）。
 */

const https = require('https');
const zlib = require('zlib');
const { computeLanded } = require('../landed');

const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const DEFAULT_TIMEOUT = 20000;

/** 从任意文本里取第一个捕获组 */
function pick(re, s) {
  const m = s.match(re);
  return m ? m[1] : null;
}

function toNumber(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function isMasked(v) {
  return typeof v === 'string' && v.includes('?');
}

/**
 * 抓移动版商品页。返回 { status, html, finalUrl }
 * status: ok | need_login | blocked | not_found | http_error | rate_limited
 */
function fetchItemPage(sku, opts = {}) {
  const url = `https://item.m.jd.com/product/${sku}.html`;
  const headers = {
    'User-Agent': opts.userAgent || UA_MOBILE,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    Referer: 'https://m.jd.com/'
  };
  if (opts.cookie) headers.Cookie = opts.cookie;

  return new Promise((resolve) => {
    const req = https.get(url, { headers, timeout: opts.timeout || DEFAULT_TIMEOUT }, (res) => {
      const chunks = [];
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        const loc = String(res.headers.location || '');
        let status = 'ok';
        // 京东对移动详情页有频率限制：访问过快会 302 到 trade.m.jd.com/common/limit.html。
        // 这类必须单独识别——它不是"页面改版"，也不是"登录失效"，而是"你问得太勤了"，
        // 处理方式是退避重试，不是重新登录。混成 failed 会误导运营去乱改配置。
        if (res.statusCode >= 300 && res.statusCode < 400 && /limit\.html|\/common\/limit/.test(loc)) status = 'rate_limited';
        else if (res.statusCode >= 300 && res.statusCode < 400 && /passport\.jd\.com|plogin/.test(loc)) status = 'need_login';
        else if (res.statusCode === 404) status = 'not_found';
        else if (res.statusCode >= 400) status = 'http_error';
        else if (/risk_handler|京东验证/.test(html) && html.length < 60000) status = 'blocked';
        else if (/passport\.jd\.com\/new\/login/.test(html) && !/shopName/.test(html)) status = 'need_login';
        resolve({ status, httpCode: res.statusCode, html, finalUrl: loc || url });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 'http_error', httpCode: 0, html: '', error: e.message }));
  });
}

/**
 * 从 HTML 里抠出一段 JSON 对象字面量（含嵌套大括号）。
 * 为什么不用正则：priceFloor / promov2 都是多层嵌套且值里带转义引号，
 * 正则截到第一个 `}` 就断了。这里做一次正规的括号配对（跳过字符串内的括号）。
 */
function extractJsonBlock(s, key) {
  const at = s.indexOf(`"${key}"`);
  if (at < 0) return null;
  const start = s.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function safeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 促销项的开始/结束时间戳：京东给的是 10 位秒，也兼容 13 位毫秒 */
function toDate(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n > 1e12 ? n : n * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* 促销项 → 直减金额。只认「满件减」这类真减钱的，
 * 赠品（TAG_gift_binding）、促销标签（PROMO_TYPE_unit 就是标价本身）都不算钱。 */
function promoFromItem(item) {
  const ext = (item && item.extInfo) || {};
  const vt = String(ext.virtualType || '');
  const text = String(item['97'] || item['96'] || item['93'] || '').trim();
  const expiresAt = toDate(item.d);

  if (vt !== 'PROMO_TYPE_unitBuyMore') return null;

  // 结构化字段优先：customtag 形如 {"reward":"[{\"needNum\":1,\"reward\":300.00}]"}
  const tag = safeJson(item.customtag);
  const rawReward = tag ? tag.reward : null;
  const reward = typeof rawReward === 'string' ? safeJson(rawReward) : rawReward;
  const first = Array.isArray(reward) ? reward[0] : null;
  if (first) {
    const off = Number(first.reward);
    const needNum = Number(first.needNum) || 1;
    if (Number.isFinite(off) && off > 0) {
      return { off, needNum, threshold: null, text: text || `满${needNum}件减${off}元`, expiresAt, structured: true };
    }
  }
  // 结构化字段没读懂时退回文案；解析不出金额就把 broken 记下来（不猜金额）
  return { text, expiresAt, broken: true };
}

/** 文案兜底：「满2000减300」「满2000元减300元」→ 金额门槛。
 *  「满2件减300」是件数门槛，单买一件不满足，不走这里（由 needNum 处理）。 */
function promosFromText(s) {
  const out = [];
  const re = /满\s*(\d+(?:\.\d+)?)\s*元?\s*减\s*(\d+(?:\.\d+)?)\s*元/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push({ threshold: Number(m[1]), off: Number(m[2]), text: `满${m[1]}减${m[2]}` });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * 解析移动版商品页 HTML。
 * 只做"字段提取"，不做业务判断（到手价的算术在 lib/price/landed.js）。
 */
function parseItemPage(sku, html) {
  const s = String(html || '');
  const out = {
    sku,
    url: `https://item.jd.com/${sku}.html`,
    mobileUrl: `https://item.m.jd.com/product/${sku}.html`,
    title: null,
    shopName: null,
    listed: null, // 标价（页面 jdPrice）——到手价链条的起点
    salePrice: null, // 划线价（原价），仅用于展示"原价多少"
    promos: [], // 可叠加的直减项 [{ off, needNum, threshold, text, expiresAt }]
    promoBroken: false, // 页面有满减活动，但金额没解析出来
    subsidyFlag: 'unknown', // yes / no / unknown：页面 isGbsp 开关
    p0: null, // 兼容旧列：= 标价
    p1: null, // 兼容旧列：= 到手价（旧语义"最低可得价"已废弃）
    p2: null,
    promoPrice: null, // 分享文案里透出的补贴价（仅作参考，不参与判价）
    bybtText: null,
    coupons: [], // 券明细（含不可用的），人工对账用
    stockState: null,
    masked: false,
    confidence: 'low',
    priceKeys: {},
    notes: []
  };

  const t = pick(/<title>([^<]*)<\/title>/, s);
  if (t) out.title = t.replace(/【图片\s*价格\s*品牌\s*评论】-京东\s*$/, '').trim();
  out.shopName = pick(/"shopName"\s*:\s*"([^"]+)"/, s) || pick(/"venderName"\s*:\s*"([^"]+)"/, s);

  // —— 标价：优先从 priceFloor 结构化块取（同时能拿到划线价），取不到再退回正则 ——
  const floor = safeJson(extractJsonBlock(s, 'priceFloor')) || {};
  const floorExt = floor.ext || {};
  const orig = (floorExt.realPriceExt && floorExt.realPriceExt.ORIGINAL) || {};

  const priceCandidates = [
    ['priceFloor.ext.jdPrice', floorExt.jdPrice],
    ['jdPrice', pick(/"jdPrice"\s*:\s*"([^"]+)"/, s)],
    ['price', pick(/"price"\s*:\s*"(\d+(?:\.\d+)?)"/, s)]
  ];
  out.priceKeys = Object.fromEntries(priceCandidates.map(([k, v]) => [k, v == null ? null : String(v)]));

  const maskedHit = priceCandidates.some(([, v]) => isMasked(v));
  const loginHint = /登录查看价格/.test(s);
  const raw0 = priceCandidates.find(([, v]) => v != null && !isMasked(v));
  out.listed = raw0 ? toNumber(raw0[1]) : null;
  out.p0 = out.listed; // 兼容旧列
  out.salePrice = toNumber(orig.salePrice);
  out.masked = maskedHit || (loginHint && out.listed == null);

  // —— 促销直减：promov2.pis 里 extInfo.virtualType = PROMO_TYPE_unitBuyMore ——
  const promoObj = safeJson(extractJsonBlock(s, 'promov2'));
  const items = Array.isArray(promoObj && promoObj.pis) ? promoObj.pis : [];
  for (const item of items) {
    const p = promoFromItem(item);
    if (!p) continue;
    if (p.broken) {
      out.promoBroken = true;
      if (p.text) out.coupons.push({ text: p.text, off: null, threshold: null, usable: false });
      continue;
    }
    // 满 2 件才减的，只买一台时用不上 → 单独登记，不参与减免
    if (p.needNum > 1) {
      out.coupons.push({ text: p.text, off: p.off, threshold: null, needNum: p.needNum, usable: false });
      out.notes.push(`${p.text}（需买 ${p.needNum} 件，单台不适用）`);
      continue;
    }
    if (out.promos.some((x) => x.off === p.off && x.threshold === p.threshold)) continue;
    out.promos.push({ off: p.off, threshold: p.threshold, text: p.text, expiresAt: p.expiresAt });
    out.coupons.push({ text: p.text, off: p.off, threshold: p.threshold, usable: true });
  }

  // 没有结构化促销块时，退回全文匹配"满X元减Y"（老页面结构）
  if (!out.promos.length && !out.promoBroken) {
    for (const c of promosFromText(s)) {
      if (out.promos.some((x) => x.off === c.off && x.threshold === c.threshold)) continue;
      out.promos.push(c);
      out.coupons.push({ ...c, usable: true });
    }
  }

  // —— 国补：页面有一个明确开关 features.isGbsp（"1" 支持 / "0" 不支持）——
  // 金额不在这里：国补是支付环节按券后价算的，页面只给规则文字。算术交给 landed.js。
  const gbsp = pick(/"isGbsp"\s*:\s*"?([01])"?/, s);
  if (gbsp === '1') out.subsidyFlag = 'yes';
  else if (gbsp === '0') out.subsidyFlag = 'no';
  else out.subsidyFlag = /国家补贴[^。]{0,30}?\d+\s*%/.test(s) ? 'yes' : 'unknown';

  // 分享标题里透出的"超级补贴价￥3098"，仅作参考
  const bybt =
    pick(/"bybtTitle"\s*:\s*"([^"]+)"/, s) || pick(/"promoTitle"\s*:\s*"([^"]+)"/, s);
  if (bybt) {
    out.bybtText = bybt;
    const m = bybt.match(/￥\s?(\d+(?:\.\d+)?)/);
    if (m) out.promoPrice = toNumber(m[1]);
  }

  // 库存/上下架
  if (/该商品已下架|商品已下架/.test(s)) out.stockState = 'offline';
  else if (/"stockState"\s*:\s*"?34"?/.test(s) || /该商品已售完|无货/.test(s)) out.stockState = 'out_of_stock';
  else if (/"stockState"\s*:\s*"?33"?/.test(s)) out.stockState = 'in_stock';

  if (out.masked) out.notes.push('京东对未登录访客打码价格（形如 3??8），需带登录态');
  if (out.listed == null) out.notes.push('未取到标价字段');

  return out;
}

/**
 * 采集一个商品，并算出到手价。返回的对象可直接喂给 lib/price/store.js。
 *
 * opts.subsidyRate / opts.subsidyCap 由调用方从数据库配置传进来（默认 15% / 1500）。
 * 绝不凭空估算：券没读到就不减，国补没标识就不算，同时把置信度降到 low。
 */
async function collect(sku, opts = {}) {
  const cookie = opts.cookie !== undefined ? opts.cookie : require('./session').cookieHeader();
  const res = await fetchItemPage(sku, { ...opts, cookie });

  if (res.status === 'need_login') {
    return mkFail(sku, 'need_login', '京东要求登录才能查看价格，请重新扫码登录', res);
  }
  if (res.status === 'rate_limited') {
    return mkFail(sku, 'rate_limited', '被京东限流（访问过快），需退避几分钟再试', res);
  }
  if (res.status === 'blocked') {
    return mkFail(sku, 'blocked', '被京东风控拦截（验证页），需降低频率或换网络', res);
  }
  if (res.status === 'not_found') {
    return mkFail(sku, 'not_found', '商品不存在或已删除', res);
  }
  if (res.status === 'http_error') {
    return mkFail(sku, 'failed', res.error || '网络请求失败', res);
  }

  const item = parseItemPage(sku, res.html);
  if (item.stockState === 'offline') {
    return { ...item, status: 'offline', reason: '商品已下架', observedAt: new Date().toISOString() };
  }
  if (item.masked || item.listed == null) {
    return {
      ...item,
      status: item.masked ? 'need_login' : 'failed',
      reason: item.masked ? '价格被打码，登录态无效或已过期' : '标价字段解析失败，可能页面改版',
      observedAt: new Date().toISOString()
    };
  }

  const chain = computeLanded({
    listed: item.listed,
    promos: item.promos,
    subsidyFlag: item.subsidyFlag,
    subsidyRate: opts.subsidyRate,
    subsidyCap: opts.subsidyCap,
    promoBroken: item.promoBroken
  });

  return {
    ...item,
    ...chain,
    p1: chain.landed, // 兼容旧列：到手价
    notes: [...item.notes, ...(chain.notes || [])],
    status: 'ok',
    observedAt: new Date().toISOString()
  };
}

function mkFail(sku, status, reason, res) {
  return {
    sku,
    url: `https://item.jd.com/${sku}.html`,
    status,
    reason,
    httpCode: res && res.httpCode,
    title: null,
    shopName: null,
    listed: null,
    salePrice: null,
    promos: [],
    subsidyFlag: 'unknown',
    promoBroken: false,
    p0: null,
    p1: null,
    p2: null,
    confidence: 'low',
    observedAt: new Date().toISOString()
  };
}

/** 从任意京东链接里取出商品编号 */
function parseSku(input) {
  const s = String(input || '').trim();
  const patterns = [
    /item\.jd\.com\/(\d+)\.html/,
    /item\.m\.jd\.com\/product\/(\d+)/,
    /item\.jd\.com\/product\/(\d+)/,
    /^(\d{6,20})$/
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

module.exports = { collect, fetchItemPage, parseItemPage, parseSku, extractJsonBlock, UA_MOBILE };
