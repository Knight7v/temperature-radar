'use strict';
/* 修复历史数据：字段标签行被误判为发言人导致的「消息被拆开」
 *
 * 症状：一条客服消息被拆成「空消息」+「挂在顾客名下、时间跳到预约时间的消息」。
 * 例：「最新预约上门时间： 2026-03-25 16:00:00」里的时间被当成发言人时间戳。
 * 后果：预约时间/工程师电话那段内容看着像被删了，会话结束时间也跳到 16:00。
 *
 * 两种修法：
 *   1) 有原始 .log 时（推荐）：按 ordinal 重新解析该通会话，内容完整还原（含被当成名字的那半句）。
 *   2) 没有原始文件时：把被拆开的两条重新拼回一条（内容不会增加，只是不再断裂）。
 *
 * 两种修法都会重排 messageId、重算开始/结束时间与证据线索，并作废该会话的 AI 结论与洞察
 * （它们引用的 messageId 已失效，需重新分析）。
 *
 * 用法：
 *   node scripts/repair-quality-message-split.js                                  # 只看不改
 *   node scripts/repair-quality-message-split.js --from-log=path/to/聊天记录.log   # 按原始文件还原
 *   node scripts/repair-quality-message-split.js --from-log=... --apply            # 真正写入
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

const APPLY = process.argv.includes('--apply');
const LOG_ARG = (process.argv.find(item => item.startsWith('--from-log=')) || '').split('=').slice(1).join('=');
const ORDINALS = ((process.argv.find(item => item.startsWith('--ordinals=')) || '').split('=')[1] || '')
  .split(',').map(item => item.trim()).filter(Boolean).map(Number).filter(item => Number.isInteger(item) && item > 0);
const IMPORT_ID = (process.argv.find(item => item.startsWith('--import=')) || '').split('=').slice(1).join('=') || null;
const epoch = value => Date.parse(String(value).replace(' ', 'T') + '+08:00');
const CONTINUATION = /(工程师|姓名|电话|地址|订单|单号|型号|时间|收货|备注|金额|开户|账号)/;

function mergeSplitMessages(messages) {
  let merged = 0;
  for (let i = 1; i < messages.length; i += 1) {
    const previous = messages[i - 1];
    const current = messages[i];
    const text = String(current.text || '').trim();
    const previousText = String(previous.text || '').trim();
    if (!previousText) {                       // 上一条是空消息：把当前正文并进去
      if (!text) continue;
      previous.text = text;
      messages.splice(i, 1);
      merged += 1;
      i -= 1;
      continue;
    }
    const phantom = current.role === 'customer'   // 幽灵消息：时间倒退 + 字段续行
      && String(current.speaker || '') === '顾客'
      && epoch(current.at) < epoch(previous.at)
      && CONTINUATION.test(text);
    if (!phantom) continue;
    previous.text = `${previousText} ${text}`.trim();
    messages.splice(i, 1);
    merged += 1;
    i -= 1;
  }
  messages.forEach((message, index) => { message.id = index; });
  return merged;
}

// 重新解析原始日志：用库里已知的客服名判断角色，不靠关键词猜（猜错的后果是整通角色反过来）
function rebuildFromLog(raw, ordinal, agents) {
  const blocks = raw.includes('以下为一通会话') ? raw.split(/\/\*+以下为一通会话\*+\//).slice(1) : [raw];
  const block = blocks[ordinal - 1];
  if (!block) throw Error(`原始日志里没有第 ${ordinal} 通会话`);
  const parsed = parseChatLog(block, { isAgentName: name => agents.has(String(name)) });
  return parsed.sessions[0];
}

(async () => {
  const db = getInventoryPool();
  const rows = (await db.query(
    `SELECT id, tenant_id, import_id, ordinal, agent, ended_at, data
       FROM quality_sessions qs
      WHERE ($2::uuid IS NULL OR import_id = $2::uuid)
        AND (($1::int[] IS NOT NULL AND ordinal = ANY($1::int[]))
          OR ($1::int[] IS NULL AND (
               EXISTS (SELECT 1 FROM jsonb_array_elements(qs.data->'messages') m
                        WHERE btrim(coalesce(m->>'text',''))='')
            OR EXISTS (SELECT 1 FROM (
                         SELECT (m->>'at') AS at, lag(m->>'at') OVER (ORDER BY (m->>'id')::int) AS prev_at
                           FROM jsonb_array_elements(qs.data->'messages') m) t
                        WHERE t.prev_at IS NOT NULL AND t.at < t.prev_at))))
      ORDER BY import_id, ordinal`,
    [ORDINALS.length ? ORDINALS : null, IMPORT_ID]
  )).rows;

  if (!rows.length) {
    console.log('没有需要修复的会话。');
    await db.end();
    return;
  }

  const raw = LOG_ARG && fs.existsSync(LOG_ARG) ? fs.readFileSync(LOG_ARG, 'utf8') : null;
  if (LOG_ARG && !raw) throw Error(`原始日志不存在：${LOG_ARG}`);
  console.log(`待修复会话 ${rows.length} 通${APPLY ? '' : '（演练模式，不写入）'}${raw ? '，按原始日志还原' : '，按拆分痕迹拼接'}`);

  let changed = 0;
  for (const row of rows) {
    const data = row.data;
    const before = (data.messages || []).length;
    let messages;
    if (raw) {
      // 客服名以库里的 agent 字段为准（角色被改坏时唯一还靠得住的信息）
      const agents = new Set(String(row.agent || '').split('、').map(item => item.trim()).filter(Boolean));
      const rebuilt = rebuildFromLog(raw, row.ordinal, agents);
      messages = rebuilt.messages;
      if (rebuilt.declaredEnd) data.declaredEnd = rebuilt.declaredEnd;
      if (rebuilt.agent) data.agent = rebuilt.agent;
    } else {
      messages = JSON.parse(JSON.stringify(data.messages || []));
      if (!mergeSplitMessages(messages)) { console.log(`  #${row.ordinal} 未匹配到可合并内容，跳过`); continue; }
    }
    if (!messages.length) { console.log(`  #${row.ordinal} 还原后没有消息，跳过`); continue; }
    changed += 1;

    const times = messages.map(message => message.at).sort();
    const startedAt = times[0];
    const endedAt = times[times.length - 1];
    const anomalies = (data.anomalies || []).filter(item => !['消息时间顺序异常', '结束标记早于最后一条消息', '缺少结束标记'].includes(item));
    if (!data.declaredEnd) anomalies.push('缺少结束标记');
    else if (epoch(data.declaredEnd) < epoch(endedAt)) anomalies.push('结束标记早于最后一条消息');
    let previous = null;
    for (const message of messages) {
      if (previous != null && epoch(message.at) < previous) { anomalies.push('消息时间顺序异常'); break; }
      previous = epoch(message.at);
    }
    const evidence = findEvidence({ ...data, messages });

    console.log(`  #${row.ordinal} 消息 ${before} → ${messages.length}，结束时间 ${row.ended_at} → ${endedAt}`);
    if (!APPLY) continue;

    await db.query(
      `UPDATE quality_sessions
          SET data = jsonb_set(jsonb_set(jsonb_set(jsonb_set(data, '{messages}', $2::jsonb), '{evidence}', $3::jsonb), '{anomalies}', $4::jsonb), '{declaredEnd}', $7::jsonb),
              started_at = $5, ended_at = $6, agent = $8, revision = revision + 1
        WHERE id = $1`,
      [row.id, JSON.stringify(messages), JSON.stringify(evidence), JSON.stringify(anomalies), startedAt, endedAt,
        JSON.stringify(data.declaredEnd || null), data.agent || row.agent]
    );
    const dropped = await db.query('DELETE FROM quality_ai_results WHERE tenant_id=$1 AND session_id=$2 RETURNING id', [row.tenant_id, row.id]);
    const insight = await db.query('DELETE FROM quality_insights WHERE tenant_id=$1 AND session_id=$2 RETURNING id', [row.tenant_id, row.id]);
    console.log(`      证据 ${evidence.length} 条；作废 AI 结论 ${dropped.rowCount} 条、洞察 ${insight.rowCount} 条`);
  }
  console.log(APPLY ? `已修复 ${changed} 通` : `演练完成，可修复 ${changed} 通；加 --apply 写入`);
  await db.end();
})().catch(error => { console.error(error); process.exit(1); });
