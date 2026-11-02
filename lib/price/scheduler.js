'use strict';

/**
 * 比价采集的定时调度（跑在工作台服务进程里）。
 *
 * 为什么不用 launchd / crontab：
 *   实测在这台机器上 `launchctl bootstrap` 返回 `5: Input/output error`，
 *   原因是项目在「桌面」目录、受 macOS 隐私保护（TCC）限制，后台任务读不到文件。
 *   而工作台服务是你双击 .command 从终端启动的，本来就有权限 —— 让它自己定时最省事，
 *   也不用再装任何东西。
 *
 * 幂等：同一租户、同一天、同一时点只跑一次（查 price_runs 里今天有没有这个 slot）。
 * 补采：Mac 关机错过了 10:00，开机后第一次轮询发现今天还没跑，会自动补一轮并标记 catchup。
 */

const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const { getInventoryPool } = require('../db/inventory-client');

const ROOT = path.join(__dirname, '..', '..');

function bj(now = new Date()) {
  const d = new Date(now.getTime() + 8 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), hhmm: d.toISOString().slice(11, 16) };
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

async function resolveTenant() {
  if (process.env.PRICE_TENANT_ID) return process.env.PRICE_TENANT_ID;
  const r = await getInventoryPool().query('SELECT id FROM tenants ORDER BY created_at LIMIT 1');
  return r.rows[0] ? r.rows[0].id : null;
}

// 采集进程被强杀（关终端、Ctrl+C、电脑休眠）时，price_runs 里会留下 status='running' 的孤儿行。
// 这种行如果也算「今天跑过了」，那一整天的这一轮就再也不跑了 —— 只能等明天，非常隐蔽。
// 所以：只有「正常走完（success/partial）」或「30 分钟内还在跑」的才算跑过；更老的 running 视为已死。
const STALE_RUN_MINUTES = 30;

async function ranToday(tenantId, slot) {
  const r = await getInventoryPool().query(
    `SELECT 1 FROM price_runs
      WHERE tenant_id = $1 AND slot = $2
        AND (started_at AT TIME ZONE 'Asia/Shanghai')::date = (now() AT TIME ZONE 'Asia/Shanghai')::date
        AND (status IN ('success', 'partial')
             OR (status = 'running' AND started_at > now() - ($3 || ' minutes')::interval))
      LIMIT 1`,
    [tenantId, slot, STALE_RUN_MINUTES]
  );
  return r.rowCount > 0;
}

// 把已经死掉的 running 行标成 failed（表上有 status 白名单约束，不新增枚举值），
// 避免概览页一直显示「采集中」，也避免它把今天这一轮卡死。
async function markStaleRuns(tenantId) {
  const r = await getInventoryPool().query(
    `UPDATE price_runs SET status = 'failed',
            finished_at = COALESCE(finished_at, now()),
            note = COALESCE(note, '采集进程已退出（被中断），自动标记失败')
      WHERE tenant_id = $1 AND status = 'running'
        AND started_at < now() - ($2 || ' minutes')::interval`,
    [tenantId, STALE_RUN_MINUTES]
  );
  return r.rowCount;
}

/**
 * 判断现在该不该跑，该跑就起一个独立进程（不占用服务线程，采集崩了也不影响工作台）。
 * 返回 { started, slot, catchup } 或 { skip: 原因 }
 */
async function tick(now = new Date()) {
  const tenantId = await resolveTenant();
  if (!tenantId) return { skip: '库里没有租户' };

  const settings = await store.readSettings(tenantId);
  const { hhmm, date } = bj(now);
  const nowMin = minutesOf(hhmm);
  const fullAt = settings.full || '10:00';
  const focusAt = settings.focus || '20:00';

  let slot = null;
  let at = null;
  if (nowMin >= minutesOf(focusAt)) { slot = 'focus'; at = focusAt; }
  else if (nowMin >= minutesOf(fullAt)) { slot = 'full'; at = fullAt; }
  if (!slot) return { skip: `未到采样时间（全量 ${fullAt} / 重点 ${focusAt}）`, date, hhmm };

  // 每次轮询先收尸：被中断的采集不会自己改状态，留着会让概览页一直「采集中」。
  const cleaned = await markStaleRuns(tenantId).catch(() => 0);

  if (await ranToday(tenantId, slot)) return { skip: `${date} 的 ${slot} 轮已跑过`, date, hhmm, slot, cleaned };

  const catchup = nowMin - minutesOf(at) > 90;
  const args = [path.join(ROOT, 'scripts', 'price-crawl.js'), `--slot=${slot}`];
  if (slot === 'focus') args.push('--focus');

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env }
  });
  child.unref();
  return { started: true, slot, catchup, pid: child.pid, date, hhmm, cleaned };
}

/**
 * 「立即采集」：页面上的按钮调它，不等 10:00 / 20:00。
 * 不传 --no-push 的话会往企微群发汇总——手动点多半是在调链接，发群只会骚扰，所以固定不发。
 * 同时只允许一轮在跑：两个进程抢同一个账号只会互相踩限流。
 */
async function runNow(tenantId) {
  if (!tenantId) return { skip: '库里没有租户' };
  await markStaleRuns(tenantId).catch(() => 0);
  const alive = await getInventoryPool().query(
    `SELECT id, started_at FROM price_runs
      WHERE tenant_id = $1 AND status = 'running'
        AND started_at > now() - ($2 || ' minutes')::interval
      ORDER BY started_at DESC LIMIT 1`,
    [tenantId, STALE_RUN_MINUTES]
  );
  if (alive.rowCount) return { skip: '已经有一轮在采集中，等它跑完再点（一轮几分钟）' };

  const child = spawn(process.execPath, [
    path.join(ROOT, 'scripts', 'price-crawl.js'),
    '--slot=manual',
    '--no-push'
  ], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env }
  });
  child.unref();
  return { started: true, slot: 'manual', pid: child.pid };
}

module.exports = { tick, runNow, ranToday, markStaleRuns, bj, minutesOf };
