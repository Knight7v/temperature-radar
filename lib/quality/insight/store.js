'use strict';

const { VERSION } = require('./taxonomy');

// 落库：一条会话一份洞察，重复分析直接覆盖（upsert），不保留历史版本。
// 质检结果与洞察结果分表存放，互不覆盖。
async function saveInsight(db, tenant, sessionId, analysis, userId) {
  const topicIds = [...new Set((analysis.questions || []).map(item => item.topic).filter(Boolean))];
  await db.query(
    `INSERT INTO quality_insights(tenant_id,session_id,version,model,stage,topics,gaps,question_count,unresolved_count,data,usage,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (tenant_id,session_id) DO UPDATE SET
       version=EXCLUDED.version, model=EXCLUDED.model, stage=EXCLUDED.stage, topics=EXCLUDED.topics,
       gaps=EXCLUDED.gaps, question_count=EXCLUDED.question_count, unresolved_count=EXCLUDED.unresolved_count,
       data=EXCLUDED.data, usage=EXCLUDED.usage, updated_at=now()`,
    [
      tenant,
      sessionId,
      VERSION,
      String(analysis.model || '').slice(0, 80),
      analysis.stage,
      topicIds,
      analysis.stats?.gapTypes || [],
      analysis.stats?.questionCount || 0,
      analysis.stats?.unresolvedCount || 0,
      JSON.stringify(analysis),
      JSON.stringify(analysis.usage || {}),
      userId || null
    ]
  );
}

module.exports = { saveInsight };
