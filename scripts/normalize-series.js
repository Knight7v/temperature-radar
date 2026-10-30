/**
 * 系列名称统一格式 → 产品知识库（格力空调全量）
 *
 * 用法：
 *   node scripts/normalize-series.js          # 演练：只看会改成什么
 *   node scripts/normalize-series.js --apply  # 真正写库
 *
 * 规则：
 *  - 格式 = {产品系列名}{三级?}{xx机}({颜色)?}，规则见 lib/product/series-format.js；
 *  - 分销机型（160 条）的系列名是主管在清单 G 列核定的，已符合格式，**不动**；
 *  - 其余格力空调记录由「商品标题 + 型号」重新生成系列名；提不出来的列出来人工看。
 */

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

async function main() {
  const apply = process.argv.includes('--apply');
  const token = await login();
  const list = await api(token, 'list', null);
  const kb = list.data ? list.data.products : list.products;
  const gree = kb.filter(item => (item.data.group || 'gree-ac') === 'gree-ac');
  console.log(`格力空调 ${gree.length} 个型号（分销机型不动，其余重新生成系列名）\n`);

  const payload = [];
  const failed = [];
  let unchanged = 0;
  for (const item of gree) {
    const d = item.data;
    if (d.distribution === '分销机型') continue;
    const { series, matched } = formatSeries(d.name, d.model);
    if (!matched) { failed.push(`${d.model}（标题：${d.name}）`); continue; }
    if (series === d.series) { unchanged += 1; continue; }
    payload.push({
      group: 'gree-ac',
      model: d.model,
      name: '',
      brand: d.brand || '格力',
      category: d.category || '',
      materialCode: String(d.materialCode || '').trim().toUpperCase(),
      tier: d.tier || '',
      series,
      distribution: d.distribution || '',
      params: [], features: [], appearance: [], service: []
    });
  }

  console.log(`将更新 ${payload.length} 条（已符合格式 ${unchanged} 条，提不出来 ${failed.length} 条）`);
  for (const p of payload.slice(0, 30)) {
    const old = gree.find(item => item.data.model === p.model)?.data;
    console.log(`  ${old.name}  →  ${p.series}`);
  }
  if (payload.length > 30) console.log(`  …共 ${payload.length} 条`);
  if (failed.length) console.log(`提不出来（人工看）:\n  ${failed.join('\n  ')}`);

  if (!payload.length) { console.log('没有需要写入的内容。'); return; }
  if (!apply) { console.log('\n【演练模式】没有写库。确认无误后加 --apply 执行。'); return; }

  for (let i = 0; i < payload.length; i += 350) {
    const chunk = payload.slice(i, i + 350);
    const result = await api(token, 'table-save', { products: chunk });
    console.log(`  写入 ${i + 1}-${i + chunk.length}: 合并 ${result.merged}，失败 ${(result.failed || []).length}`);
    if (result.failed && result.failed.length) console.log('    失败明细:', JSON.stringify(result.failed).slice(0, 400));
  }
  console.log('\n完成。');
}

main().catch(error => { console.error('FAIL:', error.message); process.exit(1); });
