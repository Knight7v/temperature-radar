'use strict';

/**
 * 把京东链接挂到机型下（我方 / 竞品）
 *
 * 单机型用法：
 *   node scripts/price-import.js --series 云佳Pro --cap 1.5匹 --brand gree \
 *     --own https://item.jd.com/10175592455372.html \
 *     --comp https://item.jd.com/10149212746799.html,https://item.jd.com/100212513162.html
 *
 * 批量用法（推荐，一次几十条）：
 *   node scripts/price-import.js --file 我的比价链接.tsv
 *
 * 批量文件格式：制表符或逗号分隔，一行一个机型，四~五列，可有表头：
 *   品牌 系列 匹数 我方链接 竞品链接
 *   格力  云佳Pro  1.5匹  https://item.jd.com/1017...  https://item.jd.com/1002...,https://item.jd.com/1015...
 *   - 品牌可省略（默认 gree）
 *   - 竞品链接一格里可以放多条，用逗号 / 空格 / 顿号隔开
 *   - 链接可以带参数、可以是移动版或分享链接，只认里面的商品编号
 *
 * 只做两件事：解析商品编号 → 写机型/链接。**不采集价格**（那是 price-crawl.js 的事）。
 * 批量导入默认**不去读标题**：几十条链接挨个读一遍必然吃京东频控，标题留给第一次采集补上。
 * 重复导入不会产生重复链接（靠 url 唯一索引）。
 */

require('../lib/price/env').loadEnv();

const fs = require('fs');
const path = require('path');
const store = require('../lib/price/store');
const linkHelper = require('../lib/price/links');
const session = require('../lib/price/session');
const jd = require('../lib/price/sources/jd');
const { getInventoryPool } = require('../lib/db/inventory-client');

function args() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i += 1) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].replace(/^--/, '');
    if (a[i].includes('=')) out[k] = a[i].split('=').slice(1).join('=');
    else if (a[i + 1] && !a[i + 1].startsWith('--')) { out[k] = a[i + 1]; i += 1; }
    else out[k] = true;
  }
  return out;
}

// 链接里可能出现逗号以外的分隔符，统一拆开；注意不能把 URL 本身拆坏
const splitUrls = (v) => String(v || '').split(/[\s,，、]+/).map((s) => s.trim()).filter(Boolean);

const BRAND_LABEL = { gree: '格力', haier: '海尔', midea: '美的', hualing: '华凌', tcl: 'TCL' };

// 品牌列中英文都认（用户从京东复制过来的清单多半写中文）
const BRAND_ALIAS = {
  gree: 'gree', 格力: 'gree',
  haier: 'haier', 海尔: 'haier',
  midea: 'midea', 美的: 'midea',
  hualing: 'hualing', 华凌: 'hualing',
  tcl: 'tcl'
};
const brandOf = (v) => BRAND_ALIAS[String(v || '').trim().toLowerCase()] || null;

/**
 * 切列。制表符优先；CSV 且带引号时按引号切 ——
 * 「竞品链接」那格常常一口气放 3~5 条链接，里面的逗号如果当成分隔符，整行就错位了。
 */
function splitCells(line) {
  if (line.includes('\t')) return line.split('\t');
  if (!line.includes('"')) return line.split(/[,，]/);
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === '，')) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** 解析批量文件：支持 tab / 逗号分隔，允许有表头 */
function parseBatchFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const groups = [];
  let lineNo = 1;
  for (const line of lines) {
    lineNo += 1;
    const parts = splitCells(line).map((c) => c.trim());

    // 表头：不管写成「品牌 系列 匹数…」还是只有「系列 匹数…」，只要某格里出现这些词就整行跳过。
    // 以前只认第 1 格是「系列」，写成「品牌,系列,匹数…」时会拿表头当数据，凭空造出一个机型。
    if (parts.some((c) => /^(品牌|系列|匹数|型号|我方链接|竞品链接|series|brand)$/i.test(c))) continue;

    // 品牌列可省略，中英文都认。
    let brand = 'gree';
    let rest = parts;
    const named = brandOf(parts[0]);
    if (named && parts.length >= 4) {
      brand = named;
      rest = parts.slice(1);
    }

    let series;
    let cap;
    let own;
    let comp;
    if (rest.length >= 4) {
      [series, cap, own, comp] = rest;
    } else if (rest.length === 3) {
      [series, cap, own] = rest;
      comp = '';
    } else {
      continue;
    }
    if (!series) continue;

    // 列对不齐（比如「竞品链接」那格没加引号，里面的逗号把一行切成好几段）时，
    // 匹数或系列会变成一条链接。这种情况宁可整行跳过并报出来，也不能硬写进库 —— 写错了比没写更麻烦。
    const looksUrl = (s) => /https?:\/\/|item\.(m\.)?jd\.com/i.test(String(s || ''));
    if (looksUrl(series) || looksUrl(cap) || (!series && !cap)) {
      console.log(`  ⚠️ 第 ${lineNo} 行列数对不上，已跳过：${line.slice(0, 60)}`);
      continue;
    }

    groups.push({ brand, series: String(series).trim(), cap: String(cap || '').trim(), own: splitUrls(own), comp: splitUrls(comp) });
  }
  return groups;
}

async function importGroup(tenantId, group, { fetchMeta, cookie }) {
  const brand = String(group.brand || 'gree').toLowerCase();
  const series = String(group.series || '').trim();
  const cap = String(group.cap || '').trim();
  if (!series) throw new Error('有一行缺少系列名（第 2 列）');

  const modelKey = linkHelper.modelKeyOf({ brand, series, capacity: cap });
  const modelId = await store.upsertModel(tenantId, {
    modelKey,
    brand,
    series,
    capacity: cap || null,
    name: `${BRAND_LABEL[brand] || brand} ${series} ${cap}`.trim(),
    priority: !!group.priority
  });
  console.log(`\n机型：${series} ${cap}（${modelKey}）`);

  const rows = [
    ...group.own.map((url) => ({ url, side: 'own' })),
    ...group.comp.map((url) => ({ url, side: 'competitor' }))
  ];

  let n = 0;
  for (const row of rows) {
    const sku = jd.parseSku(row.url);
    if (!sku) {
      console.log(`  ⚠️ 跳过无法解析的商品编号：${row.url}`);
      continue;
    }
    const url = `https://item.jd.com/${sku}.html`;

    // 这条链接已经挂在别的机型下 → 不动它，只提示。避免列错位把链接从 A 机型挪到 B 机型。
    const existing = await store.linkByUrl(tenantId, url);
    if (existing && existing.model_id !== modelId) {
      console.log(`  ⏭  ${sku} 已挂在「${existing.model_key}」下，本次不移动`);
      continue;
    }

    let meta = {};
    if (fetchMeta) {
      try {
        const r = await jd.collect(sku, { cookie });
        meta = { title: r.title, shopName: r.shopName };
      } catch (e) {
        /* 读不到标题不影响挂链接 */
      }
      await new Promise((r) => setTimeout(r, 900 + Math.random() * 700));
    }
    await store.upsertLink(tenantId, modelId, {
      side: row.side,
      url,
      sku,
      title: meta.title || null,
      shopName: meta.shopName || null,
      shopId: null,
      verifyState: 'confirmed'
    });
    n += 1;
    console.log(`  ${row.side === 'own' ? '我方  ' : '竞品  '} ${sku}  ${meta.shopName || ''}  ${(meta.title || '').slice(0, 36)}`);
  }
  return n;
}

(async () => {
  const opt = args();
  const db = getInventoryPool();
  const tenantId = process.env.PRICE_TENANT_ID
    || (await db.query('SELECT id FROM tenants ORDER BY created_at LIMIT 1')).rows[0].id;

  if (opt.file) {
    const file = path.resolve(String(opt.file));
    if (!fs.existsSync(file)) throw new Error(`文件不存在：${file}`);
    const groups = parseBatchFile(file);
    if (!groups.length) throw new Error('文件里没解析出任何机型行，检查一下是不是四~五列（系列/匹数/我方/竞品）');
    console.log(`批量导入：${path.basename(file)}，共 ${groups.length} 个机型`);
    let total = 0;
    for (const g of groups) {
      total += await importGroup(tenantId, g, { fetchMeta: !!opt.meta, cookie: session.cookieHeader() });
    }
    console.log(`\n完成：${groups.length} 个机型，写入 ${total} 条链接（重复导入自动合并）`);
    if (!opt.meta) console.log('提示：标题和店铺名留给第一次采集补齐，这里不逐条读页面，避免吃京东频控。');
    process.exit(0);
  }

  const own = splitUrls(opt.own);
  const comp = splitUrls(opt.comp);
  if (!opt.series) throw new Error('缺少 --series（系列名，如 云佳Pro）');
  if (!own.length && !comp.length) throw new Error('至少要给一条 --own 或 --comp 链接');
  const n = await importGroup(tenantId, {
    brand: opt.brand || 'gree',
    series: opt.series,
    cap: opt.cap,
    own,
    comp,
    priority: !!opt.priority
  }, { fetchMeta: true, cookie: session.cookieHeader() });
  console.log(`\n完成：写入 ${n} 条链接（重复导入会自动合并）`);
  process.exit(0);
})().catch((e) => {
  console.error('导入失败：', e.message);
  process.exit(1);
});
