'use strict';

const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
const { getInventoryPool } = require('../lib/db/inventory-client');
const { ensureQualityInsightSchema } = require('../lib/quality/insight/schema');
const { analyzeSession, analyzeBatch } = require('../lib/quality/insight/analyze');
const { aggregate } = require('../lib/quality/insight/aggregate');
const { saveInsight } = require('../lib/quality/insight/store');const { generateReport, REPORT_VERSION } = require('../lib/quality/insight/report');const { VERSION, STAGES, TOPICS, GAP_TYPES, CONCERNS, OUTCOMES, MOODS, TOPIC_MAP, GAP_MAP } = require('../lib/quality/insight/taxonomy');const aiClient = require('../lib/quality/ai/client');

const fail = (message, status = 422) => {
  throw Object.assign(Error(message), { status });
};
const uuid = value => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))) fail('ID 无效');
  return value;
};
const dateText = value => {
  const text = String(value || '').trim();
  if (text && !/^20\d{2}-\d{2}-\d{2}$/.test(text)) fail('日期格式无效');
  return text;
};

// 筛选条件：日期 + 客服。洞察统计不按质检状态筛，质检做没做不影响顾客问了什么。
// offset = 调用方已经占掉的占位符个数。⚠️ 必须传对：占位符撞车会让 uuid 和 text 比大小，
// PostgreSQL 直接报「operator does not exist: text = uuid」，带日期的统计全 500。
function scopeFilter(req, offset = 1) {
  const date = dateText(req.query.date);
  const agent = String(req.query.agent || '').trim().slice(0, 60);
  const args = [];
  let where = '';
  if (date) {
    args.push(date);
    where += ` AND left(s.started_at,10)=$${offset + args.length}`;
  }
  if (agent) {
    args.push(`%${agent}%`);
    where += ` AND s.agent ILIKE $${offset + args.length}`;
  }
  return { date, agent, args, where, scope: [date ? `date=${date}` : 'date=all', agent ? `agent=${agent}` : ''].filter(Boolean).join('&') };
}

async function loadStats(db, tenant, req) {
  const filter = scopeFilter(req, 1);
  const rows = (
    await db.query(
      `SELECT s.id AS session_id,s.agent,s.started_at,i.data,i.created_at,i.version
         FROM quality_insights i
         JOIN quality_sessions s ON s.tenant_id=i.tenant_id AND s.id=i.session_id
        WHERE i.tenant_id=$1 ${filter.where}
        ORDER BY s.started_at DESC, s.ordinal DESC
        LIMIT 5000`,
      [tenant, ...filter.args]
    )
  ).rows.map(row => ({ sessionId: row.session_id, agent: row.agent, startedAt: row.started_at, data: row.data }));

  // 覆盖率查询多占了 $2（版本号），筛选条件必须从 $3 起，不能复用上面的 where
  const filterCoverage = scopeFilter(req, 2);
  const coverage = (
    await db.query(
      `SELECT count(*)::int AS total,
              count(i.session_id)::int AS analyzed
         FROM quality_sessions s
         LEFT JOIN quality_insights i ON i.tenant_id=s.tenant_id AND i.session_id=s.id AND i.version=$2
        WHERE s.tenant_id=$1 ${filterCoverage.where}`,
      [tenant, VERSION, ...filterCoverage.args]
    )
  ).rows[0] || { total: 0, analyzed: 0 };

  const stats = aggregate(rows, { limit: Math.min(500, Math.max(20, Number(req.query.limit) || 120)) });
  stats.coverage = {
    sessions: Number(coverage.total) || 0,
    analyzed: Number(coverage.analyzed) || 0,
    pending: Math.max(0, (Number(coverage.total) || 0) - (Number(coverage.analyzed) || 0))
  };

  // 缓存：同一统计签名 6 小时内、没要求强制刷新，就直接复用上次的 AI 总结，省 token。
  const cached = (
    await db.query(
      `SELECT data,created_at FROM quality_insight_reports
        WHERE tenant_id=$1 AND scope=$2 AND signature=$3 ORDER BY created_at DESC LIMIT 1`,
      [tenant, filter.scope, stats.signature]
    )
  ).rows[0];
  const fresh = cached && Date.now() - new Date(cached.created_at).getTime() < 6 * 3600 * 1000;
  stats.report = fresh ? { ...cached.data, cached: true, createdAt: cached.created_at } : null;
  stats.scope = filter.scope;
  stats.version = VERSION;
  return stats;
}

module.exports = apiHandler(async (req, res) => {
  const action = String(req.query.action || 'meta');
  const write = req.method === 'POST';
  const user = await requireInventoryUser(req, write ? ['admin', 'operator'] : ['admin', 'operator', 'viewer']);
  await ensureQualityInsightSchema();
  const db = getInventoryPool();
  const tenant = user.tenantId;
  const body = req.body || {};

  if (!write) {
    if (action === 'meta') {
      return res.json({
        data: {
          version: VERSION,
          reportVersion: REPORT_VERSION,
          stages: STAGES,
          topics: TOPICS,
          gapTypes: GAP_TYPES,
          concerns: CONCERNS,
          outcomes: OUTCOMES,
          moods: MOODS,
          configured: aiClient.configured(),
          model: aiClient.config().model,
          role: user.role
        }
      });
    }

    if (action === 'stats') return res.json({ data: await loadStats(db, tenant, req) });

    if (action === 'export') {
      const filter = scopeFilter(req);
      const rows = (
        await db.query(
          `SELECT s.agent,s.started_at,i.data
             FROM quality_insights i
             JOIN quality_sessions s ON s.tenant_id=i.tenant_id AND s.id=i.session_id
            WHERE i.tenant_id=$1 ${filter.where}
            ORDER BY s.started_at DESC`,
          [tenant, ...filter.args]
        )
      ).rows;
      const head = ['客服', '开始时间', '顾客问题', '主题', '顾客问题是否答清', '解答不足', '不足说明', '顾客顾虑', '会话结论'];
      const cell = value => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
      const lines = [head];
      for (const row of rows) {
        const data = row.data || {};
        for (const question of Array.isArray(data.questions) ? data.questions : []) {
          lines.push([
            row.agent,
            row.started_at,
            question.text,
            TOPIC_MAP.get(question.topic)?.label || '其他',
            { yes: '已答清', partial: '答了一半', no: '没答', unknown: '看不出' }[question.answered] || '看不出',
            (question.gapTypes || []).map(id => GAP_MAP.get(id)?.label || '未说明不足').join('+'),
            question.gapDetail || '',
            (data.concerns || []).map(id => CONCERNS.find(item => item.id === id)?.label).filter(Boolean).join('+'),
            { resolved: '已解决', pending: '待跟进', unresolved: '未解决', unknown: '不确定' }[data.outcome] || ''
          ]);
        }
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="consumer-insight.csv"');
      return res.end('\uFEFF' + lines.map(line => line.map(cell).join(',')).join('\r\n'));
    }

    fail('操作不存在', 404);
  }

  // 批量洞察：每次最多 25 条，避免单个请求跑太久；前端循环调用直到 pending 归零。
  if (action === 'batch') {
    if (!aiClient.configured()) fail('未配置 DeepSeek API Key，请先在 .env.local 填写 DEEPSEEK_API_KEY', 503);
    const limit = Math.max(1, Math.min(25, Number(body.limit) || 10));
    const date = dateText(body.date);
    const agent = String(body.agent || '').trim().slice(0, 60);
    const args = [tenant, VERSION];
    let where = 's.tenant_id=$1';
    if (date) {
      args.push(date);
      where += ` AND left(s.started_at,10)=$${args.length}`;
    }
    if (agent) {
      args.push(`%${agent}%`);
      where += ` AND s.agent ILIKE $${args.length}`;
    }
    if (body.force !== true) {
      where += ` AND NOT EXISTS (SELECT 1 FROM quality_insights i
                 WHERE i.tenant_id=s.tenant_id AND i.session_id=s.id AND i.version=$2)`;
    }
    if (Array.isArray(body.sessionIds) && body.sessionIds.length) {
      const ids = body.sessionIds.slice(0, limit).map(uuid);
      args.push(ids);
      where += ` AND s.id = ANY($${args.length}::uuid[])`;
    }
    const rows = (
      await db.query(
        `SELECT s.id,s.ordinal,s.agent,s.started_at,s.ended_at,s.data
           FROM quality_sessions s WHERE ${where}
          ORDER BY s.started_at DESC, s.ordinal DESC LIMIT ${limit}`,
        args
      )
    ).rows;
    if (!rows.length) return res.json({ data: { total: 0, ok: 0, failed: 0, skipped: 0, results: [] } });

    const sessions = rows.map(row => ({
      ordinal: row.ordinal,
      agent: row.agent,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      messages: (row.data && row.data.messages) || []
    }));

    let outcomes;
    if (rows.length === 1) {
      try {
        outcomes = [{ ok: true, analysis: await analyzeSession(sessions[0]) }];
      } catch (error) {
        outcomes = [{ ok: false, error: { message: error.message } }];
      }
    } else {
      outcomes = await analyzeBatch(sessions, { concurrency: Math.max(1, Math.min(4, Number(body.concurrency) || 3)) });
    }

    const results = [];
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const outcome = outcomes[index];
      if (!outcome || !outcome.ok) {
        failed += 1;
        results.push({ sessionId: rows[index].id, ok: false, error: outcome?.error?.message || '分析失败' });
        continue;
      }
      const analysis = outcome.analysis;
      if (analysis.skipped) skipped += 1;
      await saveInsight(db, tenant, rows[index].id, analysis, user.userId);
      ok += 1;
      results.push({
        sessionId: rows[index].id,
        ok: true,
        questions: analysis.stats?.questionCount || 0,
        unresolved: analysis.stats?.unresolvedCount || 0
      });
    }
    return res.json({ data: { total: rows.length, ok, failed, skipped, results } });
  }

  if (action === 'report') {
    if (!aiClient.configured()) fail('未配置 DeepSeek API Key，请先在 .env.local 填写 DEEPSEEK_API_KEY', 503);
    const stats = await loadStats(db, tenant, req);
    if (!stats.sessions) fail('这批范围内还没有洞察分析结果，先点「开始分析」。');
    if (stats.report && body.force !== true) return res.json({ data: stats.report });
    const report = await generateReport(stats, { scope: stats.scope });
    await db.query(
      'INSERT INTO quality_insight_reports(tenant_id,scope,signature,data,usage,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [tenant, stats.scope, stats.signature, JSON.stringify(report), JSON.stringify(report.usage || {}), user.userId]
    );
    return res.json({ data: { ...report, cached: false, createdAt: new Date().toISOString() } });
  }

  if (action === 'delete') {
    await db.query('DELETE FROM quality_insights WHERE tenant_id=$1 AND session_id=$2', [tenant, uuid(body.sessionId)]);
    return res.json({ data: { deleted: true } });
  }

  fail('操作不存在', 404);
});
