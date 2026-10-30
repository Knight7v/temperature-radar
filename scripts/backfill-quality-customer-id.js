'use strict';
/* 历史质检会话补完整顾客ID
 *
 * 背景：客服质检拿到的 .log 是脱敏的（m****dm），复核时想在京东后台把这通对话调出来核对
 * 根本没有 ID 可搜。京麦另有一个「咨询会话查询」导出（xlsx）里有完整顾客ID，
 * 但它只能按天导出，跟 log 不是一个文件——所以两者的对应关系只能靠数据本身去核。
 *
 * 判定口径（与导入时同一套 lib/quality/session-list.js）：
 *   有掩码ID → 掩码（首位+末两位）+ 咨询时间（≤5 秒）为主，客服名不一致会单独标出；
 *   没有掩码ID（老数据）→ 咨询时间（≤5 秒）唯一 + 客服名；不唯一就不写。
 * 宁可不写，也不硬套一个 ID：写错 ID 比没有 ID 更危险，复核会查到别人头上。
 *
 * 用法：
 *   node scripts/backfill-quality-customer-id.js --xlsx=/path/京麦会话记录_xxx.xlsx          # 演练（只看不改）
 *   node scripts/backfill-quality-customer-id.js --xlsx=/path/a.xlsx --xlsx=/path/b.xlsx      # 多天一起
 *   node scripts/backfill-quality-customer-id.js --xlsx=... --apply                           # 真正写入
 * 写入前自动把「将要改动的字段」备份到 backups/，路径会打印出来。
 */
const fs = require('node:fs');
const path = require('node:path');

function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
loadEnv();

const { getInventoryPool } = require('../lib/db/inventory-client');
const { parseSessionList, reconcileSessions } = require('../lib/quality/session-list');

const APPLY = process.argv.includes('--apply');
const FILES = process.argv.filter(item => item.startsWith('--xlsx=')).map(item => item.slice(7)).filter(Boolean);

const pad = number => String(number).padStart(2, '0');

(async () => {
  if (!FILES.length) {
    console.log('用法：node scripts/backfill-quality-customer-id.js --xlsx=<会话记录.xlsx> [--xlsx=...] [--apply]');
    process.exit(1);
  }
  const db = getInventoryPool();
  const tenant = (await db.query('SELECT id FROM tenants ORDER BY created_at LIMIT 1')).rows[0].id;
  const backup = [];
  const totals = { sessions: 0, exact: 0, agentMismatch: 0, weak: 0, unmatched: 0, gaps: 0, written: 0 };

  for (const file of FILES) {
    if (!fs.existsSync(file)) { console.log(`❌ 找不到文件：${file}`); continue; }
    const parsed = await parseSessionList(fs.readFileSync(file));
    const { from, to } = parsed.range;
    const rows = (await db.query(
      `SELECT id,ordinal,agent,started_at,data FROM quality_sessions
        WHERE tenant_id=$1 AND left(started_at,10) BETWEEN $2 AND $3 ORDER BY started_at`,
      [tenant, from, to]
    )).rows;
    console.log(`\n=== ${path.basename(file)} ===`);
    console.log(`会话记录范围 ${from} ~ ${to}｜列表 ${parsed.rows.length} 行｜库里命中 ${rows.length} 通`);
    if (!rows.length) { console.log('库里这个日期没有会话，跳过。'); continue; }

    const sessions = rows.map(row => ({
      id: row.id,
      ordinal: row.ordinal,
      agent: row.agent,
      startedAt: row.started_at,
      customerMasked: (row.data && row.data.customerMasked) || '',
      messages: (row.data && row.data.messages) || [],
      data: row.data
    }));
    const report = reconcileSessions(sessions, parsed.rows);
    console.log(`还原 ${report.exact + report.agentMismatch + report.weak} 通：完全吻合 ${report.exact}、客服名不一致 ${report.agentMismatch}、时间差较大 ${report.weak}`);
    console.log(`没对上 ${report.unmatched} 通${report.unmatchedRows ? `｜列表剩余 ${report.unmatchedRows} 行` : ''}`);
    if (report.gapWarnings) console.log(`⚠️ ${report.gapWarnings} 通 log 条数少于后台统计（可能没导全）`);
    totals.sessions += report.sessions;
    totals.exact += report.exact;
    totals.agentMismatch += report.agentMismatch;
    totals.weak += report.weak;
    totals.unmatched += report.unmatched;
    totals.gaps += report.gapWarnings;

    const changed = sessions.filter(session => session.customerId);
    const sample = changed.slice(0, 3).map(session => `  #${session.ordinal} ${session.startedAt} ${session.customerMasked || '(无掩码)'} → ${session.customerId}（${session.sessionList.confidence}）`);
    if (sample.length) console.log('样例：\n' + sample.join('\n'));

    if (!APPLY) continue;
    for (const session of changed) {
      backup.push({
        id: session.id,
        before: {
          customerId: session.data.customerId || null,
          customerMasked: session.data.customerMasked || null,
          sessionList: session.data.sessionList || null
        }
      });
      const patch = {
        customerId: session.customerId,
        customerMasked: session.customerMasked,
        sessionList: session.sessionList
      };
      await db.query(
        `UPDATE quality_sessions SET data = data || $2::jsonb, revision = revision + 1
          WHERE tenant_id=$1 AND id=$3`,
        [tenant, JSON.stringify(patch), session.id]
      );
      totals.written += 1;
    }
  }

  console.log('\n=== 合计 ===');
  console.log(`会话 ${totals.sessions}｜完全吻合 ${totals.exact}｜客服名不一致 ${totals.agentMismatch}｜时间差较大 ${totals.weak}｜未匹配 ${totals.unmatched}｜条数偏少 ${totals.gaps}`);
  if (!APPLY) {
    console.log('\n以上为演练，没有写入任何数据。确认无误后加 --apply 执行。');
  } else {
    const dir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date();
    const name = `quality-customer-id-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.json`;
    const target = path.join(dir, name);
    fs.writeFileSync(target, JSON.stringify(backup, null, 2));
    console.log(`\n已写入 ${totals.written} 通会话。回滚备份：${target}`);
  }
  await db.end();
})().catch(error => {
  console.error('失败：', error && error.message ? error.message : error);
  process.exit(1);
});
