'use strict';
/* 每日经营日报接口：
 *   GET  ?action=get&date=YYYY-MM-DD  → 生成（不落库不推送），前端预览用
 *   POST ?action=push                 → 生成昨天 + 推企微 + 落库记录
 *   GET  ?action=cron                 → 定时入口（本机轮询 / Vercel cron）：
 *                                        当天没推过才推，推失败记 push_error 下轮重试
 * webhook 取 DAILY_REPORT_WEBHOOK（日报专用）或 WECOM_BOT_WEBHOOK（与气温推送共用）。
 */
const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
const { getInventoryPool } = require('../lib/db/inventory-client');
const Report = require('../lib/daily-report');

const fail = (message, status = 422) => { throw Object.assign(Error(message), { status }); };
const webhookUrl = () => process.env.DAILY_REPORT_WEBHOOK || process.env.WECOM_BOT_WEBHOOK || '';

/* 定时入口鉴权：Vercel cron 带官方头；本机轮询带 CRON_SECRET；没设 SECRET 时只允许本机显式标记 */
function cronAuthorized(req) {
  if (process.env.CRON_SECRET) return req.headers?.authorization === `Bearer ${process.env.CRON_SECRET}`;
  return !!(req.headers && (req.headers['x-vercel-cron'] === '1' || req.headers['x-cron-local'] === '1'));
}

/* 取「默认租户」：本机/单租户部署下定时任务没有登录用户 */
async function defaultTenant(db) {
  const row = (await db.query('SELECT id FROM tenants ORDER BY slug LIMIT 1')).rows[0];
  if (!row) fail('没有可用租户', 500);
  return row.id;
}

async function runCron(res) {
  const db = getInventoryPool();
  await Report.ensureDailyReportSchema();
  const tenant = await defaultTenant(db);
  const date = Report.reportDateFor();
  const existing = (await db.query('SELECT data,pushed_at,push_error FROM daily_reports WHERE tenant_id=$1 AND report_date=$2', [tenant, date])).rows[0];
  if (existing && existing.pushed_at) {
    return res.json({ data: { ok: true, skipped: true, date, pushedAt: existing.pushed_at } });
  }
  const webhook = webhookUrl();
  if (!webhook) {
    // 没配 webhook：生成并落库（可回看），不算失败，等配置好当天还能补推
    const report = await Report.buildDailyReport(db, tenant, date);
    if (!existing) {
      await db.query('INSERT INTO daily_reports(tenant_id,report_date,data) VALUES($1,$2,$3) ON CONFLICT(tenant_id,report_date) DO UPDATE SET data=EXCLUDED.data,updated_at=now()', [tenant, date, JSON.stringify(report)]);
    }
    return res.json({ data: { ok: true, date, pushed: false, reason: '未配置企业微信机器人(WECOM_BOT_WEBHOOK)' } });
  }
  const report = existing && existing.data ? existing.data : await Report.buildDailyReport(db, tenant, date);
  const content = Report.buildWecomMarkdown(report);
  try {
    await Report.pushToWecom(webhook, content);
    await db.query('INSERT INTO daily_reports(tenant_id,report_date,data,pushed_at) VALUES($1,$2,$3,now()) ON CONFLICT(tenant_id,report_date) DO UPDATE SET data=EXCLUDED.data,pushed_at=now(),push_error=NULL,updated_at=now()', [tenant, date, JSON.stringify(report)]);
    return res.json({ data: { ok: true, date, pushed: true } });
  } catch (error) {
    await db.query('INSERT INTO daily_reports(tenant_id,report_date,data,push_error) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,report_date) DO UPDATE SET data=EXCLUDED.data,push_error=EXCLUDED.push_error,updated_at=now()', [tenant, date, JSON.stringify(report), String(error.message || error)]);
    fail('日报推送失败：' + (error.message || error), 502);
  }
}

module.exports = apiHandler(async (req, res) => {
  const action = String(req.query.action || 'get');
  const write = req.method === 'POST';
  const db = getInventoryPool();

  if (action === 'cron') {
    if (!cronAuthorized(req)) fail('未授权', 401);
    return runCron(res);
  }

  const user = await requireInventoryUser(req, write ? ['admin', 'operator'] : ['admin', 'operator', 'viewer']);
  await Report.ensureDailyReportSchema();
  const tenant = user.tenantId;

  if (action === 'get') {
    const date = String(req.query.date || '').trim() || Report.reportDateFor();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('日期格式应为 YYYY-MM-DD');
    const report = await Report.buildDailyReport(db, tenant, date);
    const record = (await db.query('SELECT pushed_at,push_error FROM daily_reports WHERE tenant_id=$1 AND report_date=$2', [tenant, date])).rows[0] || null;
    return res.json({ data: { report, markdown: Report.buildWecomMarkdown(report), pushedAt: record ? record.pushed_at : null, pushError: record ? record.push_error : null, webhookConfigured: !!webhookUrl() } });
  }

  if (req.method !== 'POST') fail('不支持此请求', 405);
  if (action === 'push') {
    const date = String((req.body || {}).date || '').trim() || Report.reportDateFor();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('日期格式应为 YYYY-MM-DD');
    const webhook = webhookUrl();
    if (!webhook) fail('未配置企业微信机器人：请在 .env.local 填 WECOM_BOT_WEBHOOK（或 DAILY_REPORT_WEBHOOK）后重启服务', 503);
    const report = await Report.buildDailyReport(db, tenant, date);
    await Report.pushToWecom(webhook, Report.buildWecomMarkdown(report));
    await db.query('INSERT INTO daily_reports(tenant_id,report_date,data,pushed_at) VALUES($1,$2,$3,now()) ON CONFLICT(tenant_id,report_date) DO UPDATE SET data=EXCLUDED.data,pushed_at=now(),push_error=NULL,updated_at=now()', [tenant, date, JSON.stringify(report)]);
    return res.json({ data: { ok: true, date } });
  }
  fail('操作不存在', 404);
});
