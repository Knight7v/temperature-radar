/**
 * 格力官方主数据表（+可选在售产品明细）→ 产品知识库
 *
 * 用法：
 *   node scripts/import-gree-master.js <官方主数据.xlsx> [在售明细.xlsx]          # 演练：只看会做什么
 *   node scripts/import-gree-master.js <官方主数据.xlsx> [在售明细.xlsx] --apply  # 真正写库
 *
 * 规则：
 *  - 主数据表：只导「已会签」和「已淘汰」的行（未会签/需处理是草稿）；
 *  - 新建记录的系列名称按 2026-10-28 统一格式生成（series-format.js：{系列名}{三级?}{xx机}({颜色)?}）；
 *  - 与库内同型号：只补缺失参数（尺寸、装箱清单、匹数等），不覆盖已核对过的值；
 *  - 在售明细（给了第二个文件才跑）：按物料编码/型号回填 物料编码 + 机型档位 + 在售系列；库里没有的建骨架记录。
 */

const fs = require('fs');
const path = require('path');
const { parseMasterWorkbook, parseShopDetail, matchKey, extractModel } = require('../lib/product/gree-master');
const { formatSeries } = require('../lib/product/series-format');

const BASE = process.env.WORKBENCH_BASE || 'http://127.0.0.1:41873';

async function api(token, action, body) {
  const res = await fetch(`${BASE}/api/product-knowledge?action=${action}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`${action}: ${json.error || res.status}`);
  return json.data;
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'default', identifier: 'admin', password: 'Workbench@2026' })
  });
  const json = await res.json();
  if (!json.data?.accessToken) throw new Error('登录失败');
  return json.data.accessToken;
}

/** 全量行的 物料编码 → 型号 映射（含被跳过的状态行：编码↔型号对应关系是事实，跟状态无关） */
async function codeMapFromMaster(file) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(file));
  const ws = wb.worksheets[0];
  const get = (row, col) => {
    let v = ws.getRow(row).getCell(col).value;
    if (v && typeof v === 'object') {
      if (v.richText) v = v.richText.map(part => part.text).join('');
      else if (v.text !== undefined) v = v.text;
      else if (v.result !== undefined) v = v.result;
      else v = '';
    }
    return String(v === null || v === undefined ? '' : v).trim();
  };
  const headers = {};
  ws.getRow(1).eachCell((cell, col) => { headers[col] = get(1, col); });
  const codeCol = Object.keys(headers).find(c => headers[c] === '物料编码');
  const nameCol = Object.keys(headers).find(c => headers[c] === '主数据名称');
  const map = new Map();
  for (let r = 2; r <= ws.rowCount; r++) {
    const code = get(r, Number(codeCol));
    const model = extractModel(get(r, Number(nameCol)));
    if (code && model && !map.has(code)) map.set(code, model);
  }
  return map;
}

async function main() {
  const [masterFile, shopFile, ...flags] = process.argv.slice(2).filter(a => a !== '--apply');
  const apply = process.argv.slice(2).includes('--apply');
  if (!masterFile) {
    console.error('用法: node scripts/import-gree-master.js <主数据.xlsx> [在售明细.xlsx] [--apply]');
    process.exit(1);
  }

  const token = await login();
  const list = await api(token, 'list', null);
  const kb = list.data ? list.data.products : list.products;
  const kbByKey = new Map();
  const codeIndex = new Map();
  for (const item of kb) {
    const key = matchKey(item.data.model);
    if (key && !kbByKey.has(key)) kbByKey.set(key, item);
    const code = item.data.materialCode;
    if (code && !codeIndex.has(code)) codeIndex.set(code, item);
  }
  console.log(`库内现有 ${kb.length} 个型号`);

  /* ---------- 第一步：官方主数据 ---------- */
  const master = await parseMasterWorkbook(fs.readFileSync(masterFile));
  console.log(`主数据：${master.stats.rows} 行，可导 ${master.stats.importedRows} 行 → ${master.products.length} 个型号` +
    `（无型号 ${master.stats.noModel}，草稿跳过 ${Object.entries(master.stats.skippedStatus).map(([k, v]) => `${k}${v}`).join('、')}）`);

  const masterPayload = [];
  let fillOnly = 0;
  for (const product of master.products) {
    const hit = kbByKey.get(matchKey(product.model));
    if (hit) {
      /* 已在库：只补缺，不覆盖 —— 参数按名字过滤，官方广告语没出现过才加 */
      const existingNames = new Set((hit.data.params || []).map(p => String(p.name).toUpperCase()));
      const params = product.params.filter(p => !existingNames.has(p.name.toUpperCase()));
      const existingTitles = new Set((hit.data.features || []).map(f => String(f.title).toUpperCase()));
      const features = product.features.filter(f => !existingTitles.has(f.title.toUpperCase()));
      const hasColor = (hit.data.appearance || []).some(a => a.label === '颜色');
      fillOnly += 1;
      masterPayload.push({
        group: 'gree-ac',
        model: hit.data.model,
        name: '',
        brand: product.brand,
        category: hit.data.category,
        materialCode: hit.data.materialCode || product.materialCode,
        masterCode: hit.data.masterCode || product.masterCode,
        params,
        features,
        appearance: hasColor ? [] : product.appearance,
        service: [],
        source: { type: 'file', name: product.draft ? '格力官方主数据（未会签）' : '格力官方主数据', chars: 0, aiUsed: false }
      });
    } else {
      /* 新建记录：系列名称按统一格式生成（{系列名}{三级?}{xx机}({颜色)?}），商品标题保留原文 */
      masterPayload.push({ ...product, service: [], series: formatSeries(product.name, product.model).series });
    }
  }
  const newCount = masterPayload.length - fillOnly;
  console.log(`  其中已存在 ${fillOnly} 个（只补缺），全新 ${newCount} 个`);
  const newParams = masterPayload.slice().reduce((sum, p) => sum + p.params.length, 0);
  console.log(`  本次写入参数 ${newParams} 条`);

  /* ---------- 第二步：在售明细回填（给了第二个文件才跑） ---------- */
  const backfills = new Map();
  const skeletons = [];
  const unresolved = [];
  let shopConflicts = [];
  if (shopFile) {
  const shop = await parseShopDetail(fs.readFileSync(shopFile));
  console.log(`\n在售明细：${shop.rowCount} 行 → ${shop.items.length} 个型号，冲突 ${shop.conflicts.length} 个`);
  const masterCodeMap = await codeMapFromMaster(masterFile);

  for (const item of shop.items) {
    /* 云恬26机X 这类非 KFR 写法：先用物料编码换回真型号 */
    let model = item.model;
    if (!/^KFR/i.test(model) && item.code && masterCodeMap.has(item.code)) {
      model = masterCodeMap.get(item.code);
    }
    let target = (item.code && codeIndex.get(item.code)) || kbByKey.get(matchKey(model));
    if (target) {
      if (backfills.has(target.id)) continue;
      backfills.set(target.id, {
        group: 'gree-ac',
        model: target.data.model,
        name: '',
        brand: target.data.brand,
        category: target.data.category,
        materialCode: item.code || target.data.materialCode || '',
        tier: item.tier,
        shopSeries: item.series,
        params: [],
        features: [],
        appearance: [],
        service: [],
        source: { type: 'file', name: '在售产品明细', chars: 0, aiUsed: false }
      });
      continue;
    }
    /* 库里没有：若是非 KFR 写法且官方表能换回型号，再试一次 */
    if (model !== item.model) {
      const key = matchKey(model);
      const hit = kbByKey.get(key);
      if (hit) {
        if (!backfills.has(hit.id)) {
          backfills.set(hit.id, {
            group: 'gree-ac',
            model: hit.data.model,
            name: '',
            brand: hit.data.brand,
            category: hit.data.category,
            materialCode: item.code,
            tier: item.tier,
            shopSeries: item.series,
            params: [], features: [], appearance: [], service: [],
            source: { type: 'file', name: '在售产品明细', chars: 0, aiUsed: false }
          });
        }
        continue;
      }
      skeletons.push({
        group: 'gree-ac',
        model,
        name: item.series,
        brand: '格力',
        category: '',
        materialCode: item.code,
        tier: item.tier,
        shopSeries: item.series,
        params: [], features: [], appearance: [], service: [],
        source: { type: 'file', name: '在售产品明细', chars: 0, aiUsed: false }
      });
      continue;
    }
    unresolved.push(`${item.model}（${item.series}）`);
    skeletons.push({
      group: 'gree-ac',
      model: item.model,
      name: item.series,
      brand: '格力',
      category: '',
      materialCode: item.code,
      tier: item.tier,
      shopSeries: item.series,
      params: [], features: [], appearance: [], service: [],
      source: { type: 'file', name: '在售产品明细', chars: 0, aiUsed: false }
    });
  }
  console.log(`  回填已有型号 ${backfills.size} 个，新建骨架 ${skeletons.length} 个`);
  if (unresolved.length) console.log('  ⚠ 编码和型号都没对上（按原样建骨架）: ' + unresolved.join('、'));
  shopConflicts = shop.conflicts;
  } else {
    console.log('\n（未提供在售明细，只导主数据）');
  }

  /* ---------- 执行 ---------- */
  const payload = [...masterPayload, ...backfills.values(), ...skeletons];
  console.log(`\n合计写入 ${payload.length} 条记录`);
  if (shopConflicts.length) console.log('明细冲突（同型号两个编码，取先出现的）: ' + shopConflicts.map(c => `${c.model} 保留${c.kept} 丢弃${c.dropped}`).join('；'));

  if (!apply) {
    console.log('\n【演练模式】没有写库。确认无误后加 --apply 执行。');
    return;
  }

  for (let i = 0; i < payload.length; i += 350) {
    const chunk = payload.slice(i, i + 350);
    const result = await api(token, 'table-save', { products: chunk });
    console.log(`  写入 ${i + 1}-${i + chunk.length}: 新建 ${result.created}，合并 ${result.merged}，失败 ${(result.failed || []).length}`);
    if (result.failed && result.failed.length) console.log('    失败明细:', JSON.stringify(result.failed).slice(0, 400));
  }
  console.log('\n完成。');
}

main().catch(error => { console.error('FAIL:', error.message); process.exit(1); });
