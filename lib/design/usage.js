'use strict';

// 出图用量：每调用一次图像服务写一行。
//
// 目的只有一个——月底能回答"这个月花了多少钱、花在哪个模型上"。
// 这张表只增不改，即使图后来被删了，钱已经花了，账不能跟着消失。

const MONTHLY_BUDGET = Number(process.env.DESIGN_MONTHLY_BUDGET) || 300;

function monthRange(month) {
  const now = new Date();
  const key = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, mon] = key.split('-').map(Number);
  return { key, start: `${key}-01`, end: new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 10) };
}

async function record(db, tenant, entry = {}) {
  const data = {
    kind: String(entry.kind || 'background').slice(0, 20),
    model: String(entry.model || '').slice(0, 80),
    images: Math.max(0, Number(entry.images) || 0),
    cost: Math.max(0, Math.round((Number(entry.cost) || 0) * 100) / 100),
    ok: entry.ok !== false,
    scene: String(entry.scene || '').slice(0, 40),
    error: String(entry.error || '').slice(0, 200)
  };
  try {
    await db.query('INSERT INTO design_usage(tenant_id,data) VALUES($1,$2)', [tenant, data]);
  } catch {
    // 记账失败绝不能影响出图
  }
  return data;
}

async function summary(db, tenant, month) {
  const range = monthRange(month);
  const row = (
    await db.query(
      `SELECT count(*)::int AS calls,
              coalesce(sum((data->>'images')::int) FILTER (WHERE data->>'ok'='true'),0)::int AS images,
              coalesce(sum((data->>'cost')::numeric),0) AS cost,
              count(*) FILTER (WHERE data->>'ok'<>'true')::int AS failed
         FROM design_usage
        WHERE tenant_id=$1 AND created_at >= $2::date AND created_at < $3::date`,
      [tenant, range.start, range.end]
    )
  ).rows[0] || {};
  const byModel = (
    await db.query(
      `SELECT coalesce(nullif(data->>'model',''),'未记录') AS model,
              count(*)::int AS calls,
              coalesce(sum((data->>'cost')::numeric),0) AS cost
         FROM design_usage
        WHERE tenant_id=$1 AND created_at >= $2::date AND created_at < $3::date
        GROUP BY 1 ORDER BY cost DESC`,
      [tenant, range.start, range.end]
    )
  ).rows;
  const cost = Number(row.cost || 0);
  return {
    month: range.key,
    calls: row.calls || 0,
    images: row.images || 0,
    failed: row.failed || 0,
    cost: Math.round(cost * 100) / 100,
    budget: MONTHLY_BUDGET,
    used: MONTHLY_BUDGET > 0 ? Math.min(1, cost / MONTHLY_BUDGET) : 0,
    byModel: byModel.map(item => ({ model: item.model, calls: item.calls, cost: Math.round(Number(item.cost || 0) * 100) / 100 }))
  };
}

module.exports = { record, summary, monthRange, MONTHLY_BUDGET };
