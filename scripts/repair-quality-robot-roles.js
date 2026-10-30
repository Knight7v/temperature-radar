'use strict';
/* 修复历史数据：京东 AI 机器人「京小智」被当成顾客
 *
 * 症状：jimi_vender_22950829 这类机器人账号不含「客服」关键词，整通角色反过来——
 *       机器人说的话算顾客，顾客的提问算「客服一句没说」。
 * 后果：25 通被标成「待识别客服」，其中 6 通出了 AI 结论（5 通 D 级 6 分、1 通 A+ 100 分），都是假的。
 *
 * 修法：按原始 .log 重新解析这几通，机器人发言记到「京小智」名下，重算时间/证据/机器预评分，
 *       并把京小智答复未导出（占位符）的会话标成 judgeable=false —— 内容不全不打分，但仍进列表可看原文。
 *       旧 AI 结论与洞察引用的是错位的 messageId，一并作废。
 *
 * 用法：
 *   node scripts/repair-quality-robot-roles.js                  # 只看不改
 *   node scripts/repair-quality-robot-roles.js --apply          # 真正写入
 *   node scripts/repair-quality-robot-roles.js --log-dir=/路径   # 原始日志不在 ~/Downloads 时指定
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
const { findEvidence } = require('../lib/quality/evidence');
const { parseChatLog } = require('../lib/quality/parser');
const { scoreConversation } = require('../lib/quality/machine-score');

const APPLY = process.argv.includes('--apply');
const readArg = name => (process.argv.find(item => item.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const LOG_DIR = readArg('log-dir') || '/Users/knight/Downloads';
const IMPORT_ID = readArg('import') || null;
const ORDINALS = (readArg('ordinals') || '').split(',').map(item => item.trim()).filter(Boolean)
  .map(Number).filter(item => Number.isInteger(item) && item > 0);

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const db = getInventoryPool();
  const args = [];
  let where = "s.agent='待识别'";
  if (IMPORT_ID) { args.push(IMPORT_ID); where += ` AND s.import_id=$${args.length}::uuid`; }
  if (ORDINALS.length) { args.push(ORDINALS); where += ` AND s.ordinal=ANY($${args.length}::int[])`; }

  const rows = (await db.query(
    `SELECT s.id, s.tenant_id, s.import_id, s.ordinal, s.agent, s.data, i.filename
       FROM quality_sessions s
       JOIN quality_imports i ON i.tenant_id=s.tenant_id AND i.id=s.import_id
      WHERE ${where}
      ORDER BY s.import_id, s.ordinal`, args
  )).rows;

  if (!rows.length) {
    console.log('没有需要修复的会话（已识别出客服，或筛选条件不匹配）。');
    await db.end();
    return;
  }

  const logs = new Map();
  const blocksOf = filename => {
    if (!logs.has(filename)) {
      const file = path.join(LOG_DIR, filename);
      if (!fs.existsSync(file)) throw Error(`找不到原始日志：${file}\n用 --log-dir 指定所在目录`);
      const raw = fs.readFileSync(file, 'utf8');
      logs.set(filename, raw.includes('以下为一通会话') ? raw.split(/\/\*+以下为一通会话\*+\//).slice(1) : [raw]);
    }
    return logs.get(filename);
  };

  console.log(`待修复会话 ${rows.length} 通${APPLY ? '' : '（演练模式，不写入）'}，原始日志目录 ${LOG_DIR}`);

  let changed = 0;
  for (const row of rows) {
    const blocks = blocksOf(row.filename);
    const block = blocks[row.ordinal - 1];
    if (!block) { console.log(`  #${row.ordinal} 原始日志里没有这一通，跳过`); continue; }

    const rebuilt = parseChatLog(block, { agentHint: '客服' }).sessions[0];
    if (!rebuilt || !rebuilt.messages.length) { console.log(`  #${row.ordinal} 还原后没有消息，跳过`); continue; }

    const before = row.data || {};
    if (sameJson(before.messages, rebuilt.messages) && row.agent === rebuilt.agent) {
      console.log(`  #${row.ordinal} 已是正确状态，跳过`);
      continue;
    }
    changed += 1;

    const next = {
      ...before,
      agent: rebuilt.agent,
      startedAt: rebuilt.startedAt,
      endedAt: rebuilt.endedAt,
      declaredEnd: rebuilt.declaredEnd,
      anomalies: rebuilt.anomalies,
      judgeable: rebuilt.judgeable,
      messages: rebuilt.messages,
      evidence: findEvidence({ ...before, messages: rebuilt.messages })
    };
    next.machine = scoreConversation(next);

    const agentMessages = rebuilt.messages.filter(item => item.role === 'agent').length;
    console.log(`  #${row.ordinal} 客服「${row.agent}」→「${rebuilt.agent}」，消息 ${(before.messages || []).length} 条（客服 ${agentMessages} 条）`
      + `${rebuilt.judgeable ? '' : '，回复未导出→不参与自动评分'}`);
    if (!APPLY) continue;

    await db.query(
      `UPDATE quality_sessions SET data=$2, agent=$3, started_at=$4, ended_at=$5, revision=revision+1 WHERE id=$1 AND tenant_id=$6`,
      [row.id, JSON.stringify(next), rebuilt.agent, rebuilt.startedAt, rebuilt.endedAt, row.tenant_id]
    );
    const dropped = await db.query('DELETE FROM quality_ai_results WHERE tenant_id=$1 AND session_id=$2 RETURNING id', [row.tenant_id, row.id]);
    const insight = await db.query('DELETE FROM quality_insights WHERE tenant_id=$1 AND session_id=$2 RETURNING id', [row.tenant_id, row.id]);
    console.log(`      证据 ${next.evidence.length} 条；作废 AI 结论 ${dropped.rowCount} 条、洞察 ${insight.rowCount} 条`);
  }
  console.log(APPLY ? `已修复 ${changed} 通` : `演练完成，可修复 ${changed} 通；加 --apply 写入`);
  await db.end();
})().catch(error => { console.error(error); process.exit(1); });
