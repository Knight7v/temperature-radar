'use strict';
/* 链接导入的纯函数层：从任意京东链接里取出商品编号、归一成标准地址、判断「新增 / 已存在 / 无效」。
 *
 * 为什么不塞进 handler 里顺手写：列错位、分享链接带参数、同一批里同一条链接写两遍，
 * 这些坑每一条都会把链接挂到错的机型上，比价结果就整个错了（2026-11-02 踩过一次）。
 * 所以规则单独放这里，用单测钉住，改代码必须先让测试过。
 *
 * 这一层不读数据库、不发网络请求。
 */

const BRAND_LABEL = { gree: '格力', haier: '海尔', midea: '美的', hualing: '华凌', tcl: 'TCL' };

// 品牌列里用户会写中文，也可能写拼音；统一翻译成内部 code
const BRAND_ALIAS = {
  gree: 'gree', 格力: 'gree',
  haier: 'haier', 海尔: 'haier',
  midea: 'midea', 美的: 'midea',
  hualing: 'hualing', 华凌: 'hualing',
  tcl: 'tcl'
};

function brandOf(value) {
  return BRAND_ALIAS[String(value || '').trim().toLowerCase()] || null;
}

/** 从任意京东链接（PC / 移动 / 分享 / 纯编号）里取出商品编号 */
function parseSku(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const patterns = [
    /item\.jd\.com\/(\d+)\.html/,
    /item\.m\.jd\.com\/product\/(\d+)/,
    /item\.jd\.com\/product\/(\d+)/,
    /[?&](?:sku|skuId|wareId)=(\d+)/i,
    /^(\d{6,20})$/
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

/** 标准地址：只有这种形式才写库，带一堆参数和追踪码的分享链接会在这里被洗掉 */
function normalizeUrl(input) {
  const sku = parseSku(input);
  return sku ? `https://item.jd.com/${sku}.html` : null;
}

/** 粘贴框里的文本 → 一条条链接。空格 / 换行 / 逗号 / 顿号都当分隔符 */
function splitUrls(text) {
  return String(text || '')
    .split(/[\s,;，；、]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 解析一批粘贴内容。
 * 返回值里的 invalid 要原样报给用户看——静默丢链接是最让人恼火的，
 * 用户会以为导进去了，结果那条链接根本没人采。
 */
function parseText(text) {
  const items = [];
  const invalid = [];
  const seen = new Set();
  let dup = 0;

  for (const raw of splitUrls(text)) {
    const sku = parseSku(raw);
    if (!sku) {
      invalid.push(raw.slice(0, 120));
      continue;
    }
    const url = normalizeUrl(raw);
    if (seen.has(url)) {
      dup += 1;
      continue;
    }
    seen.add(url);
    items.push({ raw: raw.slice(0, 200), sku, url });
  }

  return { items, invalid, dup };
}

/**
 * 给每条链接打状态：
 *   create         库里没有 → 会新增
 *   exists         库里已有，且就挂在当前机型下 → 跳过（不重复写）
 *   exists-other   库里已有，但挂在别的机型下 → 默认不挪，报给用户看
 * @param {Array} items parseText 的 items
 * @param {Map<string,{model_id:string,model_key:string}>} existing url → 已有链接
 */
function classify(items, existing) {
  const rows = items.map((item) => {
    const hit = existing && typeof existing.get === 'function' ? existing.get(item.url) : null;
    if (!hit) return { ...item, state: 'create', modelKey: null };
    return {
      ...item,
      state: 'exists',
      modelKey: hit.model_key || null,
      modelId: hit.model_id || null,
      otherModel: hit.model_key || null
    };
  });

  const counts = {
    total: rows.length,
    create: rows.filter((r) => r.state === 'create').length,
    exists: rows.filter((r) => r.state === 'exists').length
  };
  return { rows, counts };
}

/** 机型唯一键：品牌-系列-匹数，小写去空格。匹数留空时不留尾巴横杠 */
function modelKeyOf({ brand, series, capacity }) {
  const b = String(brand || 'gree').trim().toLowerCase();
  const s = String(series || '').trim();
  const c = String(capacity || '').trim();
  return `${b}-${s}-${c}`
    .replace(/\s+/g, '')
    .replace(/-+$/, '')
    .toLowerCase();
}

function modelNameOf({ brand, series, capacity }) {
  const b = BRAND_LABEL[String(brand || '').toLowerCase()] || brand || '';
  return `${b} ${String(series || '').trim()} ${String(capacity || '').trim()}`.replace(/\s+/g, ' ').trim();
}

module.exports = {
  BRAND_LABEL,
  brandOf,
  parseSku,
  normalizeUrl,
  splitUrls,
  parseText,
  classify,
  modelKeyOf,
  modelNameOf
};
