'use strict';

const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
const { getInventoryPool } = require('../lib/db/inventory-client');
const { ensureQualityAiSchema } = require('../lib/quality/ai/schema');
const { analyzeSession, analyzeBatch } = require('../lib/quality/ai/analyze');
const { CRITERIA, CATEGORIES, RUBRIC_VERSION, CRITICAL_WEIGHT, STANDARD_WEIGHT } = require('../lib/quality/ai/rubric');
const client = require('../lib/quality/ai/client');
const { computeScore } = require('../lib/quality/ai/score');

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

async function loadSession(db, tenant, id) {
  const row = (await db.query('SELECT id,ordinal,agent,started_at,ended_at,data,status,review FROM quality_sessions WHERE tenant_id=$1 AND id=$2', [tenant, uuid(id)])).rows[0];
  if (!row) fail('会话不存在', 404);
  return row;
}

function toSession(row) {
  return {
    ordinal: row.ordinal,
    agent: row.agent,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    messages: (row.data && row.data.messages) || []
  };
}

async function persist(db, tenant, sessionId, analysis, userId) {
  const inserted = (
    await db.query(
      `INSERT INTO quality_ai_results(tenant_id,session_id,rubric_version,model,score,grade,provisional,needs_review,data,usage,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,created_at`,
      [
        tenant,
        sessionId,
        analysis.rubricVersion,
        String(analysis.model || '').slice(0, 80),
        analysis.score.score,
        analysis.score.grade,
        Boolean(analysis.score.provisional),
        Boolean(analysis.score.needsReview),
        JSON.stringify(analysis),
        JSON.stringify(analysis.usage || {}),
        userId
      ]
    )
  ).rows[0];
  return inserted;
}

module.exports = apiHandler(async (req, res) => {
  const action = String(req.query.action || 'meta');
  const write = req.method === 'POST';
  const user = await requireInventoryUser(req, write ? ['admin', 'operator'] : ['admin', 'operator', 'viewer']);
  await ensureQualityAiSchema();
  const db = getInventoryPool();
  const tenant = user.tenantId;
  const body = req.body || {};

  if (!write) {
    if (action === 'meta') {
      return res.json({
        data: {
          rubricVersion: RUBRIC_VERSION,
          criticalWeight: CRITICAL_WEIGHT,
          standardWeight: STANDARD_WEIGHT,
          criteria: CRITERIA,
          categories: CATEGORIES,
          configured: client.configured(),
          model: client.config().model,
          role: user.role
        }
      });
    }
    if (action === 'export') {
      const date = dateText(req.query.date);
      const args = [tenant];
      let where = 'r.tenant_id=$1';
      if (date) {
        args.push(date);
        where += ` AND left(s.started_at,10)=$${args.length}`;
      }
      const rows = (
        await db.query(
          `SELECT DISTINCT ON (r.session_id) s.agent,s.started_at,r.score,r.grade,s.review,s.status,
                  (SELECT string_agg(c->>'label','、') FROM jsonb_array_elements(coalesce(r.data->'criteria','[]'::jsonb)) c WHERE c->>'status'='fail') AS fails
             FROM quality_ai_results r JOIN quality_sessions s ON s.tenant_id=r.tenant_id AND s.id=r.session_id
            WHERE ${where}
            ORDER BY r.session_id, r.created_at DESC`,
          args
        )
      ).rows.slice().sort((a, b) => Number(a.score) - Number(b.score));
      const head = ['开始时间', '客服', 'AI 分', 'AI 等级', '主管分', '主管等级', '改判项', '主要失分项', '复核备注'];
      const cell = value => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
      const lines = [head, ...rows.map(row => {
        const review = row.review || {};
        const overrides = Array.isArray(review.overrides) ? review.overrides.map(item => `${item.label}:${item.from}→${item.to}`).join('；') : '';
        return [
          row.started_at, row.agent, row.score, row.grade,
          row.status === 'reviewed' ? review.score : '', row.status === 'reviewed' ? review.grade : '',
          overrides, row.fails || '', review.note || ''
        ];
      })];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="quality-ai.csv"');
      return res.end('\uFEFF' + lines.map(line => line.map(cell).join(',')).join('\r\n'));
    }
    if (action === 'verify') {
      try {
        const info = await client.verify();
        return res.json({ data: { configured: true, model: client.config().model, ...info } });
      } catch (error) {
        return res.json({ data: { configured: client.configured(), model: client.config().model, ok: false, error: error.message, code: error.code || 'AI_ERROR' } });
      }
    }
    if (action === 'result') {
      const row = (
        await db.query(
          'SELECT id,score,grade,provisional,needs_review,data,usage,model,created_at FROM quality_ai_results WHERE tenant_id=$1 AND session_id=$2 ORDER BY created_at DESC LIMIT 1',
          [tenant, uuid(req.query.sessionId)]
        )
      ).rows[0];
      return res.json({ data: row || null });
    }
    if (action === 'list') {
      const date = dateText(req.query.date);
      const page = Math.max(1, Number(req.query.page) || 1);
      const args = [tenant];
      let where = 's.tenant_id=$1';
      if (date) {
        args.push(date);
        where += ` AND left(s.started_at,10)=$${args.length}`;
      }
      // analyzed=1：只看已出 AI 结果的会话，并按分数升序（最差的排前面）
      const analyzedOnly = String(req.query.analyzed || '') === '1';
      const level = String(req.query.level || '').toLowerCase();
      const reviewStatus = String(req.query.status || '');
      if (level && !['a', 'b', 'c', 'd'].includes(level)) fail('等级筛选无效');
      if (reviewStatus && !['pending', 'reviewed', 'draft'].includes(reviewStatus)) fail('状态筛选无效');
      if (reviewStatus) {
        args.push(reviewStatus);
        where += ` AND s.status=$${args.length}`;
      }
      const agent = String(req.query.agent || '').trim();
      if (agent) {
        args.push(`%${agent}%`);
        where += ` AND s.agent ILIKE $${args.length}`;
      }
      if (level === 'd') where += ' AND a.score < 40';
      else if (level === 'c') where += ' AND a.score >= 40 AND a.score < 70';
      else if (level === 'b') where += ' AND a.score >= 70 AND a.score < 85';
      else if (level === 'a') where += ' AND a.score >= 85';
      const rows = (
        await db.query(
          `SELECT s.id AS session_id,s.agent,s.started_at,s.status AS review_status,a.score,a.grade,a.provisional,a.needs_review,a.created_at,
                  s.review->>'score' AS review_score,
                  (SELECT count(*) FROM quality_ai_results r WHERE r.tenant_id=s.tenant_id AND r.session_id=s.id) AS runs,
                  (SELECT coalesce(jsonb_agg(jsonb_build_object('label',c->>'label','status',c->>'status') ORDER BY c->>'label'),'[]'::jsonb)
                     FROM jsonb_array_elements(coalesce(a.data->'criteria','[]'::jsonb)) c
                    WHERE c->>'status' IN ('fail','pending')) AS marks,
                  a.data->>'summary' AS summary
             FROM quality_sessions s
             LEFT JOIN LATERAL (SELECT score,grade,provisional,needs_review,created_at,data FROM quality_ai_results x
                                 WHERE x.tenant_id=s.tenant_id AND x.session_id=s.id ORDER BY created_at DESC LIMIT 1) a ON true
            WHERE ${where}${analyzedOnly ? ' AND a.score IS NOT NULL' : ''}
            ORDER BY ${analyzedOnly ? 'a.score ASC, s.started_at DESC' : 's.started_at DESC, s.ordinal DESC'}
            LIMIT 50 OFFSET $${args.length + 1}`,
          [...args, (page - 1) * 50]
        )
      ).rows;
      const total = analyzedOnly
        ? Number(
            (
              await db.query(
                `SELECT count(*)::int AS total FROM quality_sessions s
                   LEFT JOIN LATERAL (SELECT score FROM quality_ai_results x
                                       WHERE x.tenant_id=s.tenant_id AND x.session_id=s.id ORDER BY created_at DESC LIMIT 1) a ON true
                  WHERE ${where} AND a.score IS NOT NULL`,
                args
              )
            ).rows[0].total
          )
        : Number((await db.query(`SELECT count(*)::int AS total FROM quality_sessions s WHERE ${where}`, args)).rows[0].total);
      return res.json({ data: { rows, total, page } });
    }
    if (action === 'stats') {
      const date = dateText(req.query.date);
      const args = [tenant];
      let dateFilter = '';
      if (date) {
        args.push(date);
        dateFilter = ` AND left(s.started_at,10)=$${args.length}`;
      }
      const summary = (
        await db.query(
          `WITH latest AS (
             SELECT DISTINCT ON (r.session_id) r.session_id,r.score,r.grade,r.provisional,r.needs_review,s.status AS session_status
               FROM quality_ai_results r JOIN quality_sessions s ON s.tenant_id=r.tenant_id AND s.id=r.session_id
              WHERE r.tenant_id=$1 ${dateFilter}
              ORDER BY r.session_id, r.created_at DESC)
           SELECT count(*)::int AS analyzed,
                  count(*) FILTER (WHERE score < 40)::int AS grade_d,
                  count(*) FILTER (WHERE score >= 40 AND score < 70)::int AS grade_c,
                  count(*) FILTER (WHERE score >= 70 AND score < 85)::int AS grade_b,
                  count(*) FILTER (WHERE score >= 85 AND score < 95)::int AS grade_a,
                  count(*) FILTER (WHERE score >= 95)::int AS grade_ap,
                  count(*) FILTER (WHERE needs_review)::int AS needs_review,
                  count(*) FILTER (WHERE session_status='reviewed')::int AS reviewed,
                  round(avg(score),2) AS average
             FROM latest`,
          args
        )
      ).rows[0];
      const agents = (
        await db.query(
          `WITH latest AS (
             SELECT DISTINCT ON (r.session_id) s.agent,r.score,r.needs_review
               FROM quality_ai_results r JOIN quality_sessions s ON s.tenant_id=r.tenant_id AND s.id=r.session_id
              WHERE r.tenant_id=$1 ${dateFilter}
              ORDER BY r.session_id, r.created_at DESC)
           SELECT agent,count(*)::int AS sessions,count(*) FILTER (WHERE needs_review)::int AS needs_review,
                  count(*) FILTER (WHERE score<40)::int AS grade_d,
                  round(avg(score),2) AS average,min(score) AS min_score
             FROM latest GROUP BY agent ORDER BY average DESC`,
          args
        )
      ).rows;
      const topIssues = (
        await db.query(
          `WITH latest AS (
             SELECT DISTINCT ON (r.session_id) r.session_id,r.data
               FROM quality_ai_results r JOIN quality_sessions s ON s.tenant_id=r.tenant_id AND s.id=r.session_id
              WHERE r.tenant_id=$1 ${dateFilter}
              ORDER BY r.session_id, r.created_at DESC)
           SELECT c->>'label' AS label, count(*)::int AS times
             FROM latest, jsonb_array_elements(coalesce(latest.data->'criteria','[]'::jsonb)) c
            WHERE c->>'status'='fail'
            GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`,
          args
        )
      ).rows;
      const poolArgs = [tenant];
      let poolWhere = "tenant_id=$1 AND data->>'sampled'='true'";
      if (date) {
        poolArgs.push(date);
        poolWhere += ` AND left(started_at,10)=$${poolArgs.length}`;
      }
      const pool = (
        await db.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE status='reviewed')::int AS reviewed,
                  count(*) FILTER (WHERE status='pending')::int AS pending
             FROM quality_sessions WHERE ${poolWhere}`,
          poolArgs
        )
      ).rows[0];
      const agentIssues = (
        await db.query(
          `WITH latest AS (
             SELECT DISTINCT ON (r.session_id) s.agent,r.data
               FROM quality_ai_results r JOIN quality_sessions s ON s.tenant_id=r.tenant_id AND s.id=r.session_id
              WHERE r.tenant_id=$1 ${dateFilter}
              ORDER BY r.session_id, r.created_at DESC)
           SELECT agent,c->>'label' AS label,count(*)::int AS times
             FROM latest, jsonb_array_elements(coalesce(latest.data->'criteria','[]'::jsonb)) c
            WHERE c->>'status'='fail' AND c->>'label' IS NOT NULL
            GROUP BY 1,2 ORDER BY 1, 3 DESC`,
          args
        )
      ).rows;
      const issueMap = new Map();
      for (const item of agentIssues) {
        if (!issueMap.has(item.agent)) issueMap.set(item.agent, []);
        const list = issueMap.get(item.agent);
        if (list.length < 3) list.push({ label: item.label, times: item.times });
      }
      for (const row of agents) row.issues = issueMap.get(row.agent) || [];
      // 今日已复核：按 reviewed_at 落在今天统计（不受日期筛选影响）
      const reviewedToday = Number(
        (await db.query("SELECT count(*)::int AS n FROM quality_sessions WHERE tenant_id=$1 AND reviewed_at >= date_trunc('day', now())", [tenant])).rows[0].n
      );
      return res.json({ data: { date: date || 'all', summary, agents, topIssues, pool, reviewedToday } });
    }
    fail('操作不存在', 404);
  }

  if (action === 'review') {
    const sessionId = uuid(body.sessionId);
    const row = (await db.query('SELECT id FROM quality_sessions WHERE tenant_id=$1 AND id=$2', [tenant, sessionId])).rows[0];
    if (!row) fail('会话不存在', 404);
    const latest = (
      await db.query('SELECT id,score,grade,data FROM quality_ai_results WHERE tenant_id=$1 AND session_id=$2 ORDER BY created_at DESC LIMIT 1', [tenant, sessionId])
    ).rows[0];
    if (!latest) fail('这条会话还没有 AI 分析结果，无法复核', 422);
    const overrides = body.overrides && typeof body.overrides === 'object' ? body.overrides : {};
    const allowed = ['pass', 'fail', 'na'];
    const analysis = JSON.parse(JSON.stringify(latest.data || {}));
    const applied = [];
    for (const item of analysis.criteria || []) {
      const next = String(overrides[item.id] || '');
      if (!allowed.includes(next) || next === item.status) continue;
      applied.push({ id: item.id, label: item.label, from: item.status, to: next });
      item.status = next;
      item.note = next === 'pass' ? '主管改判为合格' : next === 'fail' ? '主管改判为不合格' : '主管判定为不适用';
      if (item.kind === 'standard') item.score = next === 'pass' ? 5 : next === 'fail' ? 1 : null;
    }
    const score = computeScore(analysis);
    const review = {
      mode: 'ai',
      rubricVersion: analysis.rubricVersion || RUBRIC_VERSION,
      resultId: latest.id,
      aiScore: Number(latest.score),
      aiGrade: latest.grade,
      score: score.score,
      grade: score.grade,
      gradeLabel: score.gradeLabel,
      overrides: applied,
      note: String(body.note || '').trim().slice(0, 2000),
      reviewedAt: new Date().toISOString()
    };
    await db.query(
      "UPDATE quality_sessions SET review=$1,status='reviewed',revision=revision+1,reviewed_by=$2,reviewed_at=now() WHERE tenant_id=$3 AND id=$4",
      [JSON.stringify(review), user.userId, tenant, sessionId]
    );
    return res.json({ data: { sessionId, review, score } });
  }

  if (action === 'analyze') {
    if (!client.configured()) fail('未配置 DeepSeek API Key，请先在 .env.local 填写 DEEPSEEK_API_KEY', 503);
    const row = await loadSession(db, tenant, body.sessionId);
    const analysis = await analyzeSession(toSession(row), {
      categories: Array.isArray(body.categories) ? body.categories : [],
      classify: body.classify !== false
    });
    const saved = await persist(db, tenant, row.id, analysis, user.userId);
    return res.json({ data: { sessionId: row.id, resultId: saved.id, analysis } });
  }

  if (action === 'batch') {
    if (!client.configured()) fail('未配置 DeepSeek API Key，请先在 .env.local 填写 DEEPSEEK_API_KEY', 503);
    const date = dateText(body.date);
    const limit = Math.max(1, Math.min(50, Number(body.limit) || 10));
    const args = [tenant];
    let where = 'tenant_id=$1';
    if (date) {
      args.push(date);
      where += ` AND left(started_at,10)=$${args.length}`;
    }
    if (body.skipAnalyzed !== false) {
      args.push(RUBRIC_VERSION);
      where += ` AND NOT EXISTS (SELECT 1 FROM quality_ai_results r WHERE r.tenant_id=quality_sessions.tenant_id AND r.session_id=quality_sessions.id AND r.rubric_version=$${args.length})`;
    }
    if (Array.isArray(body.sessionIds) && body.sessionIds.length) {
      const ids = body.sessionIds.slice(0, limit).map(uuid);
      args.push(ids);
      where += ` AND id = ANY($${args.length}::uuid[])`;
    }
    const rows = (await db.query(`SELECT id,ordinal,agent,started_at,ended_at,data FROM quality_sessions WHERE ${where} ORDER BY started_at DESC, ordinal DESC LIMIT ${limit}`, args)).rows;
    if (!rows.length) return res.json({ data: { total: 0, ok: 0, failed: 0, results: [] } });

    const outcomes = await analyzeBatch(rows.map(toSession), {
      concurrency: Math.max(1, Math.min(4, Number(body.concurrency) || 3))
    });

    const results = [];
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const outcome = outcomes[i];
      if (!outcome || !outcome.ok) {
        failed += 1;
        results.push({ sessionId: rows[i].id, ok: false, error: outcome?.error?.message || '分析失败' });
        continue;
      }
      const saved = await persist(db, tenant, rows[i].id, outcome.analysis, user.userId);
      ok += 1;
      results.push({ sessionId: rows[i].id, ok: true, resultId: saved.id, score: outcome.analysis.score.score, grade: outcome.analysis.score.grade });
    }
    return res.json({ data: { total: rows.length, ok, failed, results } });
  }

  if (action === 'delete') {
    await db.query('DELETE FROM quality_ai_results WHERE tenant_id=$1 AND session_id=$2', [tenant, uuid(body.sessionId)]);
    return res.json({ data: { deleted: true } });
  }

  fail('操作不存在', 404);
});
