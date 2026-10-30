/**
 * 把官方主数据表的「主数据编码」回填到知识库记录（data.masterCode）。
 *
 * 用途：详情图压缩包按「主数据编码(序号).jpg」命名，知识库记录必须带
 * masterCode 才能把图片挂到型号上。2026-10-28 之前导入的记录没有这个字段。
 *
 * 用法：
 *   node scripts/backfill-master-code.js <主数据.xlsx> [更多.xlsx ...]   # 演练
 *   ... --apply                                                          # 写库
 */

const fs = require('fs');
const ExcelJS = require('exceljs');
const { extractModel, matchKey } = require('../lib/product/gree-master');

const BASE = process.env.WORKBENCH_BASE || 'http://127.0.0.1:41873';

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

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(p => p.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    return '';
  }
  return String(value).trim();
}

/** 扫一份主数据表：主数据编码 → 型号匹配键（同编码出多型号的记冲突） */
async function scanCodes(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(file));
  const ws = wb.worksheets[0];
  const headers = {};
  ws.getRow(1).eachCell((cell, col) => { headers[col] = cellText(cell.value); });
  const codeCol = Number(Object.keys(headers).find(c => headers[c] === '主数据编码'));
  const nameCol = Number(Object.keys(headers).find(c => headers[c] === '主数据名称'));
  if (!codeCol || !nameCol) throw new Error(`${file} 缺「主数据编码/主数据名称」列`);
  const map = new Map();
  const conflicts = new Set();
  for (let r = 2; r <= ws.rowCount; r++) {
    const code = cellText(ws.getRow(r).getCell(codeCol).value).toUpperCase();
    const model = extractModel(cellText(ws.getRow(r).getCell(nameCol).value));
    if (!code || !model) continue;
    const key = matchKey(model);
    if (map.has(code) && map.get(code) !== key) conflicts.add(code);
    if (!map.has(code)) map.set(code, key);
  }
  return { map, conflicts: [...conflicts] };
}

async function main() {
  const files = process.argv.slice(2).filter(a => a !== '--apply');
  const apply = process.argv.slice(2).includes('--apply');
  if (!files.length) {
    console.error('用法: node scripts/backfill-master-code.js <主数据.xlsx> [...] [--apply]');
    process.exit(1);
  }

  const codeToKey = new Map();
  const keyToCodes = new Map(); // 一个型号（合并颜色）可能对应多个主数据编码，取第一个
  for (const file of files) {
    const { map, conflicts } = await scanCodes(file);
    for (const [code, key] of map) {
      if (conflicts.includes(code)) continue;
      codeToKey.set(code, key);
      if (!keyToCodes.has(key)) keyToCodes.set(key, code);
    }
    console.log(`扫描 ${file.split('/').pop()}：${map.size} 个编码${conflicts.length ? `，${conflicts.length} 个编码对应多型号（跳过）` : ''}`);
  }
  console.log(`合计可用编码 ${codeToKey.size} 个，覆盖型号 ${keyToCodes.size} 个`);

  const login = await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'default', identifier: 'admin', password: 'Workbench@2026' })
  })).json();
  const token = login.data.accessToken;
  const res = await fetch(`${BASE}/api/product-knowledge?action=list`, { headers: { Authorization: `Bearer ${token}` } });
  const list = await res.json();
  const kb = (list.data ? list.data.products : list.products).filter(p => (p.data.group || 'gree-ac') === 'gree-ac');

  const payload = [];
  for (const item of kb) {
    const key = matchKey(item.data.model);
    const code = keyToCodes.get(key);
    if (!code || item.data.masterCode) continue;
    payload.push({ ...item.data, masterCode: code, name: '', service: item.data.service || [] });
  }
  console.log(`知识库 ${kb.length} 条里 ${payload.length} 条需要回填（已有 masterCode 的不动）`);
  const sample = payload.slice(0, 8).map(p => `${p.model} ← ${p.masterCode}`);
  console.log('样例:\n  ' + sample.join('\n  '));
  if (!apply) {
    console.log('\n【演练模式】没有写库。加 --apply 执行。');
    return;
  }
  for (let i = 0; i < payload.length; i += 350) {
    const chunk = payload.slice(i, i + 350);
    const result = await (await fetch(`${BASE}/api/product-knowledge?action=table-save`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: chunk })
    })).json();
    if (result.error) throw new Error(result.error);
    console.log(`  写入 ${i + 1}-${i + chunk.length}: 合并 ${result.data.merged}，失败 ${(result.data.failed || []).length}`);
    if ((result.data.failed || []).length) console.log('   失败明细:', JSON.stringify(result.data.failed).slice(0, 300));
  }
  console.log('完成。');
}

main().catch(error => { console.error('FAIL:', error.message); process.exit(1); });
