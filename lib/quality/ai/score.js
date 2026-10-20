'use strict';

const { CRITICAL_WEIGHT, STANDARD_WEIGHT, STANDARD_MAX, gradeOf } = require('./rubric');

// 分数只在这里算，模型永远不参与算分。
// 公式沿用模板：关键项 70 分一票否决 + 非关键项 30 分（按 5 分制折算）。
// 红线命中 → 整单 0 分（模板中高压线只扣 70 分，这里按业务要求加严）。
function computeScore(analysis) {
  const criteria = Array.isArray(analysis?.criteria) ? analysis.criteria : [];
  const fatal = criteria.filter(item => item.kind === 'fatal');
  const critical = criteria.filter(item => item.kind === 'critical');
  const standard = criteria.filter(item => item.kind === 'standard');

  const fatalFails = fatal.filter(item => item.status === 'fail');
  const criticalFails = critical.filter(item => item.status === 'fail');
  const criticalPending = critical.filter(item => item.status === 'pending');
  const standardPending = standard.filter(item => item.status === 'pending');
  const standardScored = standard.filter(item => item.status !== 'na' && item.status !== 'pending' && [5, 3, 1].includes(Number(item.score)));
  const standardNa = standard.filter(item => item.status === 'na');

  const standardAvg = standardScored.length
    ? standardScored.reduce((sum, item) => sum + Number(item.score), 0) / (standardScored.length * STANDARD_MAX)
    : 1;
  const standardScore = Math.round(standardAvg * STANDARD_WEIGHT * 100) / 100;

  let criticalScore = CRITICAL_WEIGHT;
  if (fatalFails.length || criticalFails.length) criticalScore = 0;

  const total = Math.round((fatalFails.length ? 0 : criticalScore + standardScore) * 100) / 100;
  const grade = gradeOf(total);

  const provisional = !fatalFails.length && !criticalFails.length && criticalPending.length > 0;
  // 最坏情况：所有"待人工确认"的关键项最终都被确认有问题。
  const worstCase = fatalFails.length ? 0 : (criticalPending.length ? Math.round(standardScore * 100) / 100 : total);

  const confidences = criteria.filter(item => item.status !== 'na').map(item => Number(item.confidence) || 0);
  const confidence = confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100 : 0;

  return {
    score: total,
    grade: grade.grade,
    gradeLabel: grade.label,
    fatalFail: fatalFails.length > 0,
    criticalScore,
    standardScore,
    standardAvg: Math.round(standardAvg * 1000) / 1000,
    provisional,
    worstCase,
    confidence,
    needsReview: criticalPending.length + standardPending.length > 0 || fatalFails.length > 0,
    counts: {
      fatal: fatal.length,
      critical: critical.length,
      standard: standard.length,
      standardScored: standardScored.length,
      standardNa: standardNa.length,
      fatalFails: fatalFails.length,
      criticalFails: criticalFails.length,
      criticalPending: criticalPending.length,
      standardPending: standardPending.length
    },
    failItems: [...fatalFails, ...criticalFails].map(item => ({ id: item.id, label: item.label, reason: item.reason })),
    pendingItems: [...criticalPending, ...standardPending].map(item => ({ id: item.id, label: item.label, note: item.note })),
    naItems: criteria.filter(item => item.status === 'na').map(item => item.id)
  };
}

module.exports = { computeScore };
