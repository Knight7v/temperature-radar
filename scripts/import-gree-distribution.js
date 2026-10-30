/**
 * 格力 2026 线上零售分销机型清单 → 产品知识库
 *
 * 用法：
 *   node scripts/import-gree-distribution.js <机型清单.xlsx>          # 演练：只看会做什么
 *   node scripts/import-gree-distribution.js <机型清单.xlsx> --apply  # 真正写库
 *
 * 规则：
 *  - 按成品码（= 物料编码）匹配知识库 gree-ac 记录；
 *  - 分销机型档次 / 系列名称（优先 G 列核定写法）以这份官方清单为准（适用 2026-03-01 ~ 12-31），匹配上就覆盖；
 *  - 匹配上的标记 `distribution: 分销机型`；清单外的格力空调记录统一标 `distribution: 非分销机型`；
 *  - 没匹配上的编码列出来，不建骨架（清单里的「机型」列不是 KFR 型号，没法建）。
 */

const fs = require('fs');
const { parseDistributionWorkbook } = require('../lib/product/gree-distribution');

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

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('用法: node scripts/import-gree-distribution.js <机型清单.xlsx> [--apply]');
    process.exit(1);
  }
  const apply = flags.includes('--apply');

  const { items, skipped } = await parseDistributionWorkbook(fs.readFileSync(file));
  console.log(`清单：有效 ${items.length} 行，跳过 ${skipped} 行（说明/无档位）`);

  /* 同码不同档先拦下来 */
  const byCode = new Map();
  const conflicts = [];
  for (const item of items) {
    const prev = byCode.get(item.code);
    if (prev && (prev.tier !== item.tier || prev.series !== item.series)) {
      conflicts.push(`${item.code}: ${prev.tier}/${prev.series} vs ${item.tier}/${item.series}`);
      continue;
    }
    byCode.set(item.code, item);
  }
  if (conflicts.length) console.log(`⚠ 清单内同码不同档 ${conflicts.length} 个（取先出现的）:\n  ${conflicts.join('\n  ')}`);

  const token = await login();
  const list = await api(token, 'list', null);
  const kb = list.data ? list.data.products : list.products;
  const codeIndex = new Map();
  const keyOf = model => String(model || '').toUpperCase().replace(/\s+/g, '');
  for (const item of kb) {
    const code = String(item.data.materialCode || '').trim().toUpperCase();
    if (code) {
      if (!codeIndex.has(code)) codeIndex.set(code, []);
      codeIndex.get(code).push(item);
    }
  }
  console.log(`库内现有 ${kb.length} 个型号，其中带物料编码 ${codeIndex.size} 个`);

  const payload = [];
  const touched = new Set();
  const unmatched = [];
  const tierChanged = [];
  let same = 0;

  const queue = item => {
    const old = item.data;
    if (touched.has(item.id)) return;
    touched.add(item.id);
    if (old.tier && old.tier !== item.tier) tierChanged.push(`${old.model}: ${old.tier} → ${item.tier}`);
    else if (old.tier === item.tier) same += 1;
    payload.push({
      group: 'gree-ac',
      model: old.model,
      name: '',
      brand: old.brand || '格力',
      category: old.category || '',
      materialCode: String(old.materialCode || item.code).trim().toUpperCase(),
      tier: item.tier,
      series: item.series,
      distribution: '分销机型',
      params: [], features: [], appearance: [], service: [],
      source: { type: 'file', name: '2026分销机型清单', chars: 0, aiUsed: false }
    });
  };

  for (const [code, item] of byCode) {
    const hits = codeIndex.get(code);
    if (hits && hits.length) {
      for (const hit of hits) queue({ ...item, code, data: hit.data, id: hit.id });
      continue;
    }
    unmatched.push(`${code}（${item.series}）`);
  }

  /* 清单外的格力空调记录：统一标记「非分销机型」（不改档位/系列/来源，只补标记） */
  let markedOut = 0;
  for (const item of kb) {
    if ((item.data.group || 'gree-ac') !== 'gree-ac') continue;
    if (touched.has(item.id)) continue;
    if (item.data.distribution === '非分销机型') continue;
    touched.add(item.id);
    markedOut += 1;
    payload.push({
      group: 'gree-ac',
      model: item.data.model,
      name: '',
      brand: item.data.brand || '格力',
      category: item.data.category || '',
      materialCode: String(item.data.materialCode || '').trim().toUpperCase(),
      tier: item.data.tier || '',
      series: item.data.series || '',
      distribution: '非分销机型',
      params: [], features: [], appearance: [], service: []
    });
  }

  const gree = kb.filter(item => (item.data.group || 'gree-ac') === 'gree-ac');
  console.log(`匹配：回填 ${payload.length} 条（档位不变 ${same}，档位有变 ${tierChanged.length}）`);
  console.log(`标记：分销机型 ${touched.size - markedOut} 条，非分销机型 ${markedOut} 条`);
  if (tierChanged.length) console.log('档位变化明细:\n  ' + tierChanged.join('\n  '));
  if (unmatched.length) console.log(`库里没有的编码（跳过，不建骨架）: ${unmatched.slice(0, 20).join('、')}${unmatched.length > 20 ? ` …共 ${unmatched.length}` : ''}`);

  if (!payload.length) { console.log('没有可写入的内容。'); return; }
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
