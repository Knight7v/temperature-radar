/**
 * 数据清洗：删除知识库里「官方主数据表已判死」的型号。
 *
 * 判死依据（2026-10-28 用户拍板）：所有主数据表中，主数据名称带
 *   【已淘汰】/【老国标-待处理】/【需处理】
 * 的型号（同名型号在任何一份表里出现过「已会签」则仍保留）。
 *
 * 用法：
 *   node scripts/purge-dead-models.js <主数据.xlsx> [更多.xlsx ...]   # 演练
 *   ... --apply                                                       # 备份后删除
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { extractModel, matchKey, statusOf } = require('../lib/product/gree-master');

const BASE = process.env.WORKBENCH_BASE || 'http://127.0.0.1:41873';
const DEAD = /已淘汰|老国标-待处理|需处理/;
const ALIVE = /已会签/;

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

/** 扫一份主数据表：型号匹配键 → 状态集合 */
async function scanMaster(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(file));
  const ws = wb.worksheets[0];
  const headers = {};
  ws.getRow(1).eachCell((cell, col) => { headers[col] = cellText(cell.value); });
  const nameCol = Number(Object.keys(headers).find(c => headers[c] === '主数据名称'));
  if (!nameCol) throw new Error(`${path.basename(file)} 里没有「主数据名称」列`);

  const byKey = new Map(); // key -> { statuses:Set, files:Set, names:Set }
  for (let r = 2; r <= ws.rowCount; r++) {
    const name = cellText(ws.getRow(r).getCell(nameCol).value);
    if (!name) continue;
    const model = extractModel(name);
    if (!model) continue;
    const key = matchKey(model);
    const status = statusOf(name);
    if (!byKey.has(key)) byKey.set(key, { statuses: new Set(), files: new Set(), names: new Set() });
    const entry = byKey.get(key);
    if (status) entry.statuses.add(status);
    entry.files.add(path.basename(file));
    entry.names.add(name.replace(/^【[^】]*】\s*/, '').trim());
  }
  return byKey;
}

async function main() {
  const files = process.argv.slice(2).filter(a => a !== '--apply');
  const apply = process.argv.slice(2).includes('--apply');
  if (!files.length) {
    console.error('用法: node scripts/purge-dead-models.js <主数据.xlsx> [更多.xlsx ...] [--apply]');
    process.exit(1);
  }

  /* 1. 扫全部主数据表 */
  const master = new Map();
  for (const file of files) {
    const part = await scanMaster(file);
    for (const [key, entry] of part) {
      if (!master.has(key)) master.set(key, { statuses: new Set(), files: new Set(), names: new Set() });
      const all = master.get(key);
      for (const s of entry.statuses) all.statuses.add(s);
      for (const f of entry.files) all.files.add(f);
      for (const n of entry.names) all.names.add(n);
    }
    console.log(`扫描 ${path.basename(file)}：${part.size} 个型号`);
  }

  /* 2. 找出判死型号：出过死状态、且从没出过已会签 */
  const dead = new Map(); // key -> 描述
  for (const [key, entry] of master) {
    const statuses = [...entry.statuses];
    if (statuses.some(s => DEAD.test(s)) && !statuses.some(s => ALIVE.test(s))) {
      dead.set(key, statuses.filter(s => DEAD.test(s)).join('、'));
    }
  }
  console.log(`\n主数据判死型号：${dead.size} 个（另 ${(master.size - dead.size)} 个存活/健康）`);

  /* 3. 对照知识库 */
  const token = await login();
  const list = await api(token, 'list', null);
  const kb = (list.data ? list.data.products : list.products).filter(p => (p.data.group || 'gree-ac') === 'gree-ac');
  const hits = [];
  for (const item of kb) {
    const key = matchKey(item.data.model);
    if (dead.has(key)) hits.push({ id: item.id, model: item.data.model, series: item.data.series || '', status: dead.get(key), source: item.data.source?.name || '' });
  }
  const byStatus = {};
  for (const h of hits) for (const s of h.status.split('、')) byStatus[s] = (byStatus[s] || 0) + 1;
  console.log(`知识库 ${kb.length} 个格力型号中命中 ${hits.length} 个：`, JSON.stringify(byStatus));
  const keptDist = kb.filter(item => item.data.distribution === '分销机型' && dead.has(matchKey(item.data.model)));
  if (keptDist.length) console.log(`⚠ 其中 ${keptDist.length} 个是分销机型（在 2026 分销清单里），已自动保护不删：` + keptDist.map(i => i.data.model).join('、'));
  const toDelete = hits.filter(h => !keptDist.some(k => k.id === h.id));
  console.log(`将删除 ${toDelete.length} 个，样例:`);
  toDelete.slice(0, 15).forEach(h => console.log(`  ${h.model} | ${h.series} | ${h.status} | 来源:${h.source}`));

  if (!apply) {
    console.log('\n【演练模式】没有删除。确认无误后加 --apply 执行。');
    return;
  }

  /* 4. 备份到 backups/，再逐个删 */
  const backupDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const backupFile = path.join(backupDir, `product-knowledge-清洗前-${stamp}.json`);
  const full = await api(token, 'list', null);
  const victims = (full.data ? full.data.products : full.products).filter(p => toDelete.some(d => d.id === p.id));
  fs.writeFileSync(backupFile, JSON.stringify(victims, null, 2));
  console.log(`已备份 ${victims.length} 条完整数据 → ${backupFile}`);

  let ok = 0, bad = 0;
  for (const v of victims) {
    try {
      await api(token, 'delete', { id: v.id });
      ok += 1;
    } catch (e) {
      bad += 1;
      console.error(`  删除失败 ${v.data.model}: ${e.message}`);
    }
  }
  console.log(`\n完成：删除 ${ok} 个，失败 ${bad} 个。`);
}

main().catch(error => { console.error('FAIL:', error.message); process.exit(1); });
