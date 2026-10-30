'use strict';

const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
const { getInventoryPool } = require('../lib/db/inventory-client');
const { ensureQualityCalibrationSchema } = require('../lib/quality/calibration-schema');
const { RUBRIC_VERSION, CRITERIA } = require('../lib/quality/ai/rubric');
const {
  GRADE_ORDER,
  DEFAULT_SIZE,
  buildSample,
  summarize,
  describe,
  normalizeGrade
} = require('../lib/quality/calibration');

const fail = (message, status = 422) => {
  throw Object.assign(Error(message), { status });
};

const uuid = value => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))) fail('ID 无效');
  return value;
};

const currentRound = async (db, tenant) =>
  (await db.query('SELECT coalesce(max(round_no),0)::int AS round_no FROM quality_calibration WHERE tenant_id=$1', [tenant]))
    .rows[0].round_no;

const roundProgress = async (db, tenant, roundNo) => {
  if (!roundNo) return { round: 0, total: 0, marked: 0 };
  const row = (
    await db.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE marked_at IS NOT NULL)::int AS marked
         FROM quality_calibration WHERE tenant_id=$1 AND round_no=$2`,
      [tenant, roundNo]
    )
  ).rows[0];
  return { round: roundNo, total: Number(row.total) || 0, marked: Number(row.marked) || 0 };
};

// 候选池：只用当前规则版本、且已经有 AI 结果的会话——没结果的没法对照
const loadCandidates = async (db, tenant) =>
  (
    await db.query(
      `SELECT s.id AS session_id, s.agent, s.started_at, a.score, a.grade, a.data->>'summary' AS ai_summary
         FROM quality_sessions s
         JOIN LATERAL (
           SELECT score, grade, data FROM quality_ai_results x
            WHERE x.tenant_id=s.tenant_id AND x.session_id=s.id AND x.rubric_version=$2
            ORDER BY x.created_at DESC LIMIT 1
         ) a ON true
        WHERE s.tenant_id=$1 AND a.score IS NOT NULL`,
      [tenant, RUBRIC_VERSION]
    )
  ).rows;

// 全体各档数量，用于把分层抽样的结果还原成总体一致率
const gradePopulation = rows => {
  const population = {};
  for (const grade of GRADE_ORDER) population[grade] = 0;
  for (const row of rows) {
    const grade = normalizeGrade(row.grade, row.score);
    if (grade) population[grade] += 1;
  }
  return population;
};

module.exports = apiHandler(async (req, res) => {
  const action = String(req.query.action || 'plan');
  const write = req.method === 'POST';
  const user = await requireInventoryUser(req, write ? ['admin', 'operator'] : ['admin', 'operator', 'viewer']);
  await ensureQualityCalibrationSchema();
  const db = getInventoryPool();
  const tenant = user.tenantId;
  const body = req.body || {};

  if (!write) {
    if (action === 'plan') {
      const round = await currentRound(db, tenant);
      const progress = await roundProgress(db, tenant, round);
      const candidates = await loadCandidates(db, tenant);
      return res.json({
        data: {
          rubricVersion: RUBRIC_VERSION,
          size: DEFAULT_SIZE,
          criteria: CRITERIA.map(item => ({ id: item.id, label: item.label, kind: item.kind })),
          grades: GRADE_ORDER,
          progress,
          pool: { total: candidates.length, byGrade: gradePopulation(candidates) },
          role: user.role
        }
      });
    }

    if (action === 'list') {
      const round = Number(req.query.round) || (await currentRound(db, tenant));
      const progress = await roundProgress(db, tenant, round);
      const rows = round
        ? (
            await db.query(
              `SELECT id, agent, started_at, marked_at IS NOT NULL AS marked, human_grade, ai_grade, ai_score
                 FROM quality_calibration
                WHERE tenant_id=$1 AND round_no=$2
                ORDER BY created_at, id`,
              [tenant, round]
            )
          ).rows
        : [];
      // 未打分的条目不返回 AI 档位——盲评的前提是主管看不到答案
      return res.json({
        data: {
          progress,
          rows: rows.map(row => ({
            id: row.id,
            agent: row.agent,
            startedAt: row.started_at,
            marked: row.marked,
            humanGrade: row.human_grade || '',
            aiGrade: row.marked ? row.ai_grade : null,
            aiScore: row.marked && row.ai_score != null ? Number(row.ai_score) : null
          }))
        }
      });
    }

    if (action === 'detail') {
      const id = uuid(req.query.id);
      const row = (
        await db.query(
          `SELECT c.id, c.round_no, c.session_id, c.agent, c.started_at, c.ai_grade, c.ai_score, c.ai_summary,
                  c.human_grade, c.human_issue, c.human_note, c.marked_at,
                  s.ordinal, s.ended_at, s.data
             FROM quality_calibration c
             JOIN quality_sessions s ON s.tenant_id=c.tenant_id AND s.id=c.session_id
            WHERE c.tenant_id=$1 AND c.id=$2`,
          [tenant, id]
        )
      ).rows[0];
      if (!row) fail('校准样本不存在', 404);
      const marked = Boolean(row.marked_at);
      const previous = (
        await db.query(
          `SELECT human_grade FROM quality_calibration
            WHERE tenant_id=$1 AND round_no=$2 AND marked_at IS NOT NULL AND id<>$3
            ORDER BY marked_at DESC LIMIT 3`,
          [tenant, row.round_no, id]
        )
      ).rows.map(item => item.human_grade);
      return res.json({
        data: {
          id: row.id,
          round: row.round_no,
          ordinal: row.ordinal,
          agent: row.agent,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          messages: (row.data && row.data.messages) || [],
          marked,
          human: marked ? { grade: row.human_grade, issue: row.human_issue || '', note: row.human_note || '' } : null,
          // 只有已提交的样本才揭晓 AI 结论
          ai: marked ? { grade: row.ai_grade, score: row.ai_score == null ? null : Number(row.ai_score), summary: row.ai_summary || '' } : null,
          recentGrades: previous
        }
      });
    }

    if (action === 'stats') {
      const round = Number(req.query.round) || (await currentRound(db, tenant));
      const progress = await roundProgress(db, tenant, round);
      if (!round) return res.json({ data: { progress, summary: summarize([]), verdict: describe(summarize([])), samples: [] } });
      const rows = (
        await db.query(
          `SELECT human_grade, ai_grade, ai_score, agent FROM quality_calibration
            WHERE tenant_id=$1 AND round_no=$2 AND marked_at IS NOT NULL`,
          [tenant, round]
        )
      ).rows.map(row => ({
        humanGrade: row.human_grade,
        aiGrade: row.ai_grade,
        aiScore: row.ai_score,
        agent: row.agent
      }));
      const candidates = await loadCandidates(db, tenant);
      const summary = summarize(rows, { population: gradePopulation(candidates) });
      const mistakes = rows
        .map(row => ({
          agent: row.agent,
          aiGrade: normalizeGrade(row.aiGrade, row.aiScore),
          aiScore: row.aiScore == null ? null : Number(row.aiScore),
          humanGrade: normalizeGrade(row.humanGrade, null)
        }))
        .filter(row => row.aiGrade !== row.humanGrade);
      return res.json({ data: { progress, summary, verdict: describe(summary), mistakes } });
    }

    return fail('未知操作', 400);
  }

  // ---------- 写操作 ----------
  if (action === 'start') {
    const round = await currentRound(db, tenant);
    const progress = await roundProgress(db, tenant, round);
    if (progress.marked > 0 && !body.force) {
      fail(`第 ${round} 轮已经评了 ${progress.marked} 条，请先把这一轮评完，或者确认重开新一轮`, 409);
    }
    const size = Math.min(120, Math.max(12, Number(body.size) || DEFAULT_SIZE));
    const candidates = await loadCandidates(db, tenant);
    if (candidates.length < 12) fail('已有 AI 结果的会话不足 12 条，先分析一批会话再校准');
    const sample = buildSample(candidates, { size, seed: `${tenant}#${round + 1}#${RUBRIC_VERSION}` });
    if (!sample.items.length) fail('没有可抽样的会话');

    const next = round + 1;
    await db.query(
      `INSERT INTO quality_calibration(tenant_id,round_no,rubric_version,session_id,agent,started_at,ai_score,ai_grade,ai_summary)
       SELECT $1,$2,$3,t.session_id,t.agent,t.started_at,t.score,t.grade,t.ai_summary
         FROM unnest($4::uuid[],$5::text[],$6::text[],$7::numeric[],$8::text[],$9::text[])
              AS t(session_id,agent,started_at,score,grade,ai_summary)
       ON CONFLICT (tenant_id, round_no, session_id) DO NOTHING`,
      [
        tenant,
        next,
        RUBRIC_VERSION,
        sample.items.map(item => item.session_id),
        sample.items.map(item => item.agent || ''),
        sample.items.map(item => item.started_at || ''),
        sample.items.map(item => item.score),
        sample.items.map(item => normalizeGrade(item.grade, item.score)),
        sample.items.map(item => String(item.ai_summary || '').slice(0, 400))
      ]
    );
    return res.json({
      data: {
        progress: await roundProgress(db, tenant, next),
        pool: { total: candidates.length, byGrade: gradePopulation(candidates) },
        missing: sample.missing
      }
    });
  }

  if (action === 'mark') {
    const id = uuid(body.id);
    const grade = String(body.grade || '').trim().toUpperCase();
    if (!GRADE_ORDER.includes(grade)) fail('档位只能是 A+ / A / B / C / D');
    const issue = String(body.issue || '').trim().slice(0, 40);
    const note = String(body.note || '').trim().slice(0, 500);
    const updated = (
      await db.query(
        `UPDATE quality_calibration
            SET human_grade=$3, human_issue=$4, human_note=$5, marked_by=$6, marked_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING round_no`,
        [tenant, id, grade, issue, note, user.userId]
      )
    ).rows[0];
    if (!updated) fail('校准样本不存在', 404);
    const progress = await roundProgress(db, tenant, updated.round_no);
    const ai = (
      await db.query(
        `SELECT ai_grade, ai_score, ai_summary FROM quality_calibration WHERE tenant_id=$1 AND id=$2`,
        [tenant, id]
      )
    ).rows[0];
    return res.json({
      data: {
        progress,
        // 提交后才把 AI 结论亮出来，让主管当场看到自己和 AI 差在哪
        ai: { grade: ai.ai_grade, score: ai.ai_score == null ? null : Number(ai.ai_score), summary: ai.ai_summary || '' },
        human: { grade }
      }
    });
  }

  if (action === 'reset') {
    if (body.confirm !== true) fail('需要确认后才清空');
    const round = Number(body.round) || (await currentRound(db, tenant));
    if (!round) fail('没有可清空的轮次');
    await db.query(
      `UPDATE quality_calibration
          SET human_grade=NULL, human_issue=NULL, human_note=NULL, marked_by=NULL, marked_at=NULL
        WHERE tenant_id=$1 AND round_no=$2`,
      [tenant, round]
    );
    return res.json({ data: { progress: await roundProgress(db, tenant, round) } });
  }

  return fail('未知操作', 400);
});
