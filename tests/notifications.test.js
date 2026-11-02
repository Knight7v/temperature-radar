'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Notif = require('../lib/notifications');

/* ===== 假数据库：按 SQL 特征分发 ===== */
function fakeDb(handlers = {}) {
  return {
    query: async (sql, args) => {
      for (const [needle, rows] of Object.entries(handlers)) {
        if (sql.includes(needle)) return { rows: typeof rows === 'function' ? rows(args) : rows };
      }
      return { rows: [] };
    }
  };
}

test('北京今天/昨天换算', () => {
  // UTC 2026-10-30 17:00 = 北京 10-31 凌晨 1 点
  const now = new Date('2026-10-30T17:00:00Z');
  assert.equal(Notif.beijingToday(now), '2026-10-31');
  assert.equal(Notif.beijingYesterday(now), '2026-10-30');
});

test('buildAlerts：推送失败 → error；缺数据 → warn；待复核 → info，按严重度排序', async () => {
  const db = fakeDb({
    'FROM daily_reports': [{
      pushed_at: null,
      push_error: '企业微信推送失败: HTTP 502',
      data: { sales: { missing: ['格力旗舰店', '喵速达'], zero: [] } }
    }],
    "s.data->>'sampled'": [{ n: 7 }]
  });
  const alerts = await Notif.buildAlerts(db, 'T1', { today: '2026-10-30', yesterday: '2026-10-29' });
  assert.deepEqual(alerts.map(a => a.level), ['error', 'warn', 'info']);
  const push = alerts[0];
  assert.equal(push.key, 'push_error:2026-10-29');
  assert.ok(push.detail.includes('502'));
  const missing = alerts[1];
  assert.equal(missing.key, 'missing:2026-10-29');
  assert.ok(missing.title.includes('2 家'));
  assert.ok(missing.detail.includes('格力旗舰店') && missing.detail.includes('喵速达'));
  const pending = alerts[2];
  assert.equal(pending.title, '质检待复核 7 通');
  assert.ok(pending.key.startsWith('quality-pending:2026-10-30'));
});

test('buildAlerts：一切正常 → 空列表', async () => {
  const db = fakeDb({
    'FROM daily_reports': [{ pushed_at: new Date().toISOString(), push_error: null, data: { sales: { missing: [], zero: [] } } }],
    "s.data->>'sampled'": [{ n: 0 }]
  });
  const alerts = await Notif.buildAlerts(db, 'T1', { today: '2026-10-30', yesterday: '2026-10-29' });
  assert.deepEqual(alerts, []);
});

test('buildAlerts：日报没生成过 → 现场补算缺数据（fallback）', async () => {
  const shopRow = { id: 's1', data: { name: '格力换新旗舰店' } };
  const db = fakeDb({
    'FROM daily_reports': [], // 没有日报记录
    'FROM sales_shops': [shopRow],
    'MIN(date)::text': [{ shop_id: 's1', from_date: '2026-10-01', to_date: '2026-10-28' }],
    'FROM sales_targets': [],
    'count(*)::int AS n': [{ n: 0 }]
    // sales_daily 查不到昨天的行（窗口只到 10-28）→ 缺数据
  });
  const alerts = await Notif.buildAlerts(db, 'T1', { today: '2026-10-30', yesterday: '2026-10-29' });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, 'warn');
  assert.ok(alerts[0].detail.includes('格力换新旗舰店'));
});

test('buildAlerts：窗口内没销量 → 记零销售，不算缺数据', async () => {
  const db = fakeDb({
    'FROM daily_reports': [],
    'FROM sales_shops': [{ id: 's1', data: { name: '喵速达' } }],
    'MIN(date)::text': [{ shop_id: 's1', from_date: '2026-10-01', to_date: '2026-10-30' }],
    'FROM sales_targets': [],
    'count(*)::int AS n': [{ n: 0 }]
  });
  const alerts = await Notif.buildAlerts(db, 'T1', { today: '2026-10-30', yesterday: '2026-10-29' });
  assert.deepEqual(alerts, []);
});

test('listTasks：日报看 daily_reports，其余看 task_runs，没跑过的显示 null', async () => {
  const db = fakeDb({
    'FROM task_runs': [
      { task_name: 'weather-push', ran_at: '2026-10-30T02:00:00Z', ok: true, detail: '气温推送完成（38 城）' }
    ],
    'FROM daily_reports': [{ report_date: '2026-10-29', pushed_at: '2026-10-30T00:31:00Z', push_error: null }]
  });
  const tasks = await Notif.listTasks(db, 'T1');
  assert.equal(tasks.length, Notif.TASK_DEFS.length);
  const daily = tasks.find(t => t.name === 'daily-report');
  assert.ok(daily.last && daily.last.ok && daily.last.detail.includes('2026-10-29'));
  const weather = tasks.find(t => t.name === 'weather-push');
  assert.ok(weather.last && weather.last.ok && weather.last.detail.includes('38 城'));
  const inv = tasks.find(t => t.name === 'inventory-daily');
  assert.equal(inv.last, null);
});

test('listTasks：日报推送失败 → last.ok=false，detail 带错误', async () => {
  const db = fakeDb({
    'FROM task_runs': [],
    'FROM daily_reports': [{ report_date: '2026-10-29', pushed_at: null, push_error: 'HTTP 502' }]
  });
  const tasks = await Notif.listTasks(db, 'T1');
  const daily = tasks.find(t => t.name === 'daily-report');
  assert.equal(daily.last.ok, false);
  assert.ok(daily.last.detail.includes('502'));
});

test('recordTaskRun：写库失败也只吞掉，不往上报', async () => {
  let threw = false;
  try {
    await Notif.recordTaskRun({ query: async () => { throw Error('db down'); } }, 'weather-push', true, 'ok');
  } catch { threw = true; }
  assert.equal(threw, false);
});
