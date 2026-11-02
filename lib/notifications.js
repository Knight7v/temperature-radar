'use strict';
/* 通知中心 + 定时任务可视化（P1，借鉴 ruoyi-vue-pro / JeecgBoot 的设计，按需裁剪）：
 *  · 通知 = 实时算出来的「当前待办」，不靠定时器写站内信表：
 *      1) 昨日销售缺数据（口径与日报同源）
 *      2) 日报企微推送失败（push_error 清掉后提醒自然消失）
 *      3) 质检待复核条数
 *    已读记录存 notification_reads（键带日期，第二天换新键重新提醒）。
 *  · 任务 = task_runs 运行史 + daily_reports 推送史，拼成任务看板。
 * 纯函数 + db 参数注入，方便 node --test 直接测。
 */
const fs = require('node:fs');
const path = require('node:path');

let ready;
function ensureNotifSchema(db) {
  if (!ready) ready = (db || getPool()).query(fs.readFileSync(path.join(__dirname, 'db/migrations/0017_notifications.sql'), 'utf8')).catch(error => { ready = null; throw error; });
  return ready;
}
/* 延迟取池子：直接 require db 客户端会把连接池提前建出来，测试（env -u DATABASE_URL）会被卡 */
let poolRef = null;
function getPool() {
  if (!poolRef) poolRef = require('./db/inventory-client').getInventoryPool();
  return poolRef;
}

/* 北京时区的今天 / 昨天（YYYY-MM-DD）。与日报口径一致 */
function beijingToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function beijingYesterday(now = new Date()) {
  const d = new Date(beijingToday(now) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* ===== 待办（通知）计算 =====
 * 返回 [{key, level, title, detail, href}]，level: error > warn > info */
async function buildAlerts(db, tenant, opts = {}) {
  const today = opts.today || beijingToday();
  const yesterday = opts.yesterday || beijingYesterday();
  const alerts = [];

  const report = (await db.query(
    'SELECT pushed_at,push_error,data FROM daily_reports WHERE tenant_id=$1 AND report_date=$2',
    [tenant, yesterday]
  )).rows[0] || null;

  /* 1) 日报推送失败：重推成功（push_error 置空）后提醒自动消失 */
  if (report && report.push_error) {
    alerts.push({
      key: 'push_error:' + yesterday,
      level: 'error',
      title: '日报推送失败',
      detail: yesterday + ' 的日报没送到企业微信群：' + report.push_error,
      href: '/workbench.html'
    });
  }

  /* 2) 昨日销售缺数据：优先用已生成的日报记录，没有就现场算一次（不落库） */
  let missing = report && report.data && report.data.sales ? report.data.sales.missing : null;
  if (missing == null) {
    try {
      const Report = require('./daily-report');
      const rep = await Report.buildDailyReport(db, tenant, yesterday);
      missing = rep.sales.missing;
    } catch { missing = null; }
  }
  if (missing && missing.length) {
    alerts.push({
      key: 'missing:' + yesterday,
      level: 'warn',
      title: '销售数据未导入（' + missing.length + ' 家店）',
      detail: yesterday + ' 缺数据：' + missing.join('、'),
      href: '/sales.html#import'
    });
  }

  /* 3) 质检待复核：抽检且已出 AI 结论、还没人工复核的会话数（与质检页待复核口径一致） */
  const pending = Number((await db.query(
    `SELECT count(*)::int AS n FROM quality_sessions s
      WHERE s.tenant_id=$1
        AND (s.data->>'sampled')='true'
        AND coalesce(s.data->>'judgeable','true') <> 'false'
        AND EXISTS(SELECT 1 FROM quality_ai_results r WHERE r.tenant_id=s.tenant_id AND r.session_id=s.id)
        AND s.status='pending'`,
    [tenant]
  )).rows[0].n);
  if (pending > 0) {
    alerts.push({
      key: 'quality-pending:' + today,
      level: 'info',
      title: '质检待复核 ' + pending + ' 通',
      detail: '抽检会话已出 AI 结论，等人工复核',
      href: '/quality.html'
    });
  }

  const order = { error: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => order[a.level] - order[b.level]);
  return alerts;
}

/* ===== 定时任务看板 ===== */
const TASK_DEFS = [
  { name: 'daily-report', title: '经营日报推送', schedule: '每天 08:30', desc: '昨日销售额 + 目标进度 + 缺数据提醒，推企业微信群' },
  { name: 'weather-push', title: '空调热销区域推送', schedule: '每天 09:30', desc: '高温集中 / 高温抬头趋势，推企业微信群' },
  { name: 'inventory-daily', title: '库存日结', schedule: '每天 10:00', desc: '缺货 / 积压规则扫描，生成补货跟进' }
];

async function listTasks(db, tenant) {
  const runs = (await db.query(
    'SELECT DISTINCT ON (task_name) task_name,ran_at,ok,detail FROM task_runs ORDER BY task_name,ran_at DESC'
  )).rows;
  const runMap = new Map(runs.map(r => [r.task_name, r]));
  /* 日报的上次执行直接看 daily_reports（比 task_runs 信息更全） */
  const drArgs = [];
  let drWhere = '';
  if (tenant) { drArgs.push(tenant); drWhere = 'WHERE tenant_id=$1'; }
  const dr = (await db.query(
    'SELECT report_date::text AS report_date,pushed_at,push_error FROM daily_reports ' + drWhere + ' ORDER BY report_date DESC LIMIT 1',
    drArgs
  )).rows[0] || null;

  return TASK_DEFS.map(def => {
    let last = null;
    if (def.name === 'daily-report') {
      last = dr ? {
        ranAt: dr.pushed_at,
        ok: !dr.push_error,
        detail: dr.push_error ? String(dr.push_error) : '已推送 ' + dr.report_date + ' 日报'
      } : null;
    } else {
      const run = runMap.get(def.name);
      last = run ? { ranAt: run.ran_at, ok: run.ok, detail: run.detail || '' } : null;
    }
    return { name: def.name, title: def.title, schedule: def.schedule, desc: def.desc, last };
  });
}

/* cron 执行完记一笔。失败不抛（记录失败不该连累任务本身的结果返回） */
async function recordTaskRun(db, name, ok, detail) {
  try {
    await ensureNotifSchema(db);
    await db.query('INSERT INTO task_runs(task_name,ok,detail) VALUES($1,$2,$3)', [
      name, ok === true, detail ? String(detail).slice(0, 500) : null
    ]);
  } catch (error) {
    console.error('task_runs 记录失败:', error.message || error);
  }
}

module.exports = {
  ensureNotifSchema, buildAlerts, listTasks, recordTaskRun,
  beijingToday, beijingYesterday, TASK_DEFS
};
