'use strict';

// 消费者洞察批量分析（命令行版）。
// 用途：一次把几百条会话跑完，不受浏览器页面停留时间限制。
//
//   node scripts/quality-insight-run.js --limit 40 --dry
//   node scripts/quality-insight-run.js                 # 跑完所有还没分析的
//   node scripts/quality-insight-run.js --date 2026-03-25 --concurrency 4
//   node scripts/quality-insight-run.js --tenant <uuid> --limit 100
//
// --dry 只分析不入库，用来先看模型输出质量。

const fs = require('node:fs');
const path = require('node:path');

function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

function args() {
  const out = { concurrency: 4, dry: false, limit: 0 };
  const list = process.argv.slice(2);
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (item === '--dry') out.dry = true;
    else if (item === '--limit') out.limit = Number(list[++index]) || 0;
    else if (item === '--concurrency') out.concurrency = Number(list[++index]) || 4;
    else if (item === '--date') out.date = list[++index];
    else if (item === '--tenant') out.tenant = list[++index];
    else if (item === '--agent') out.agent = list[++index];
  }
  return out;
}

async function main() {
  loadEnv();
  const options = args();
  const { getInventoryPool } = require('../lib/db/inventory-client');
  const { ensureQualityInsightSchema } = require('../lib/quality/insight/schema');
  const { analyzeBatch } = require('../lib/quality/insight/analyze');
  const { saveInsight } = require('../lib/quality/insight/store');
  const { VERSION, TOPIC_MAP, GAP_MAP } = require('../lib/quality/insight/taxonomy');

  if (!String(process.env.DEEPSEEK_API_KEY || '').trim()) {
    console.error('缺少 DEEPSEEK_API_KEY（.env.local）');
    process.exit(1);
  }

  await ensureQualityInsightSchema();
  const db = getInventoryPool();

  let tenant = options.tenant;
  if (!tenant) {
    const row = (await db.query('SELECT id FROM tenants ORDER BY created_at LIMIT 1')).rows[0];
    if (!row) throw Error('找不到租户');
    tenant = row.id;
  }

  const where = ['s.tenant_id=$1'];
  const params = [tenant];
  if (options.date) {
    params.push(options.date);
    where.push(`left(s.started_at,10)=$${params.length}`);
  }
  if (options.agent) {
    params.push(`%${options.agent}%`);
    where.push(`s.agent ILIKE $${params.length}`);
  }
  if (!options.dry) {
    params.push(VERSION);
    where.push(`NOT EXISTS (SELECT 1 FROM quality_insights i WHERE i.tenant_id=s.tenant_id AND i.session_id=s.id AND i.version=$${params.length})`);
  }

  const rows = (
    await db.query(
      `SELECT s.id,s.ordinal,s.agent,s.started_at,s.ended_at,s.data
         FROM quality_sessions s WHERE ${where.join(' AND ')}
        ORDER BY s.started_at DESC, s.ordinal DESC ${options.limit ? `LIMIT ${Number(options.limit)}` : ''}`,
      params
    )
  ).rows;

  console.log(`待分析 ${rows.length} 条会话${options.dry ? '（试跑，不入库）' : ''}，并发 ${options.concurrency}`);
  if (!rows.length) return;

  const sessions = rows.map(row => ({
    ordinal: row.ordinal,
    agent: row.agent,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    messages: (row.data && row.data.messages) || []
  }));

  let done = 0;
  const started = Date.now();
  const outcomes = await analyzeBatch(sessions, {
    concurrency: options.concurrency,
    onProgress: progress => {
      done = progress.done;
      if (done % 10 === 0 || done === progress.total) {
        const seconds = Math.round((Date.now() - started) / 1000);
        process.stdout.write(`  已处理 ${done}/${progress.total}，用时 ${seconds}s\n`);
      }
    }
  });

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const samples = [];

  for (let index = 0; index < rows.length; index += 1) {
    const outcome = outcomes[index];
    if (!outcome || !outcome.ok) {
      failed += 1;
      console.log(`  失败：${outcome?.error?.message || '未知错误'}`);
      continue;
    }
    const analysis = outcome.analysis;
    ok += 1;
    if (analysis.skipped) skipped += 1;
    promptTokens += Number(analysis.usage?.promptTokens) || 0;
    completionTokens += Number(analysis.usage?.completionTokens) || 0;
    if (samples.length < 6 && analysis.questions.length) samples.push({ row: rows[index], analysis });
    if (!options.dry) await saveInsight(db, tenant, rows[index].id, analysis, null);
  }

  console.log(`\n完成：成功 ${ok}，失败 ${failed}，其中无顾客发言跳过 ${skipped}`);
  console.log(`token：输入 ${promptTokens}，输出 ${completionTokens}，合计 ${promptTokens + completionTokens}`);

  for (const item of samples) {
    const { row, analysis } = item;
    console.log(`\n—— ${row.agent} · ${row.started_at} · ${analysis.stage} · ${analysis.outcome}`);
    console.log(`   小结：${analysis.summary}`);
    for (const question of analysis.questions) {
      const gaps = (question.gapTypes || []).map(id => GAP_MAP.get(id)?.label || id).join('+') || '—';
      console.log(`   · [${TOPIC_MAP.get(question.topic)?.label || '其他'}] ${question.text} → ${question.answered} / ${gaps}${question.gapDetail ? '：' + question.gapDetail : ''}`);
    }
    if (analysis.coaching) console.log(`   建议：${analysis.coaching}`);
  }
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
