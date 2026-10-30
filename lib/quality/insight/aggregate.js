'use strict';

const { createHash } = require('node:crypto');
const {
  STAGES,
  MOODS,
  OUTCOMES,
  TOPICS,
  GAP_TYPES,
  CONCERNS,
  UNCLASSIFIED,
  TOPIC_MAP,
  GAP_MAP
} = require('./taxonomy');

const round1 = value => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
const share = (part, whole) => (whole ? round1((part / whole) * 100) : null);

/**
 * 把逐条洞察结果汇总成看板数据。纯函数，方便单测：不查库、不调模型。
 * rows: [{ sessionId, agent, startedAt, data }]
 */
function aggregate(rows, options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 60));
  const list = Array.isArray(rows) ? rows.filter(row => row && row.data) : [];

  const stageCount = new Map(STAGES.map(item => [item.id, 0]));
  const topicStats = new Map();
  const gapStats = new Map();
  const concernCount = new Map();
  const moodCount = new Map();
  const outcomeCount = new Map();
  const agentStats = new Map();

  let sessionCount = 0;
  let skipped = 0;
  let sessionsWithGap = 0;
  const answerCount = { yes: 0, partial: 0, no: 0, unknown: 0 };
  const open = [];

  for (const row of list) {
    const data = row.data || {};
    const questions = Array.isArray(data.questions) ? data.questions : [];
    if (data.skipped || data.stage === 'none') {
      skipped += 1;
      continue;
    }
    sessionCount += 1;
    stageCount.set(data.stage, (stageCount.get(data.stage) || 0) + 1);
    moodCount.set(data.mood || 'unknown', (moodCount.get(data.mood || 'unknown') || 0) + 1);
    outcomeCount.set(data.outcome || 'unknown', (outcomeCount.get(data.outcome || 'unknown') || 0) + 1);
    for (const concern of Array.isArray(data.concerns) ? data.concerns : []) {
      concernCount.set(concern, (concernCount.get(concern) || 0) + 1);
    }

    const agent = String(row.agent || '未识别');
    if (!agentStats.has(agent)) {
      agentStats.set(agent, { agent, sessions: 0, questions: 0, unresolved: 0, sessionUnresolved: 0, gapMap: new Map() });
    }
    const agentRow = agentStats.get(agent);
    agentRow.sessions += 1;

    const seenTopics = new Set();
    const seenGaps = new Set();
    let sessionHasGap = false;
    let sessionUnresolved = 0;

    for (const question of questions) {
      const topicId = TOPIC_MAP.has(question.topic) ? question.topic : 'other';
      const gaps = (Array.isArray(question.gapTypes) && question.gapTypes.length ? question.gapTypes : [])
        .filter(id => id === UNCLASSIFIED.id || GAP_MAP.has(id));
      const answered = ['yes', 'partial', 'no', 'unknown'].includes(question.answered) ? question.answered : 'unknown';
      const unresolved = answered === 'no' || answered === 'partial';

      answerCount[answered] += 1;
      agentRow.questions += 1;
      if (unresolved) {
        agentRow.unresolved += 1;
        sessionUnresolved += 1;
      }
      if (gaps.length) sessionHasGap = true;

      if (!topicStats.has(topicId)) {
        topicStats.set(topicId, { id: topicId, questions: 0, sessions: 0, unresolved: 0, samples: [] });
      }
      const topicRow = topicStats.get(topicId);
      topicRow.questions += 1;
      if (unresolved) topicRow.unresolved += 1;
      if (!seenTopics.has(topicId)) {
        topicRow.sessions += 1;
        seenTopics.add(topicId);
      }
      if (topicRow.samples.length < 3 && question.text) {
        topicRow.samples.push({ text: question.text, agent, startedAt: row.startedAt || null, sessionId: row.sessionId });
      }

      for (const gapId of gaps) {
        if (!gapStats.has(gapId)) gapStats.set(gapId, { id: gapId, questions: 0, sessions: 0, samples: [] });
        const gapRow = gapStats.get(gapId);
        gapRow.questions += 1;
        if (!seenGaps.has(gapId)) {
          gapRow.sessions += 1;
          seenGaps.add(gapId);
        }
        if (gapRow.samples.length < 3) {
          gapRow.samples.push({ detail: question.gapDetail || question.text, text: question.text, agent, startedAt: row.startedAt || null, sessionId: row.sessionId });
        }
        agentRow.gapMap.set(gapId, (agentRow.gapMap.get(gapId) || 0) + 1);
      }

      if (unresolved) {
        open.push({
          text: question.text,
          answered,
          topic: topicId,
          gapTypes: gaps,
          gapDetail: question.gapDetail || '',
          agent,
          startedAt: row.startedAt || null,
          sessionId: row.sessionId,
          messageId: question.messageId ?? null,
          repeat: Boolean(question.repeat),
          needsReview: Boolean(question.needsReview)
        });
      }
    }

    if (sessionHasGap) sessionsWithGap += 1;
    agentRow.sessionUnresolved = (agentRow.sessionUnresolved || 0) + (sessionUnresolved ? 1 : 0);
  }

  const totalQuestions = answerCount.yes + answerCount.partial + answerCount.no + answerCount.unknown;
  const unresolvedCount = answerCount.partial + answerCount.no;

  const severityRank = id => {
    const severity = id === UNCLASSIFIED.id ? 'medium' : GAP_MAP.get(id)?.severity || 'medium';
    return severity === 'high' ? 0 : severity === 'medium' ? 1 : 2;
  };

  const topics = [...topicStats.values()]
    .map(row => ({
      ...row,
      label: TOPIC_MAP.get(row.id)?.label || '其他',
      stage: TOPIC_MAP.get(row.id)?.stage || null,
      rate: share(row.questions, totalQuestions),
      unresolvedRate: share(row.unresolved, row.questions)
    }))
    .sort((a, b) => b.questions - a.questions || a.label.localeCompare(b.label, 'zh'));

  const gaps = [...gapStats.values()]
    .map(row => {
      const meta = row.id === UNCLASSIFIED.id ? UNCLASSIFIED : GAP_MAP.get(row.id);
      return {
        ...row,
        label: meta?.label || '未归类',
        severity: meta?.severity || 'medium',
        rate: share(row.sessions, sessionCount),
        questionRate: share(row.questions, totalQuestions)
      };
    })
    .sort((a, b) => b.questions - a.questions || severityRank(a.id) - severityRank(b.id));

  const agents = [...agentStats.values()]
    .map(row => ({
      agent: row.agent,
      sessions: row.sessions,
      questions: row.questions,
      unresolved: row.unresolved,
      unresolvedRate: share(row.unresolved, row.questions),
      sessionUnresolved: row.sessionUnresolved,
      sessionUnresolvedRate: share(row.sessionUnresolved, row.sessions),
      gaps: [...row.gapMap.entries()]
        .map(([id, count]) => ({ id, label: GAP_MAP.get(id)?.label || UNCLASSIFIED.label, severity: severityRank(id) === 0 ? 'high' : severityRank(id) === 1 ? 'medium' : 'low', count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
    }))
    .sort((a, b) => (b.unresolvedRate || 0) - (a.unresolvedRate || 0) || b.sessions - a.sessions);

  open.sort((a, b) => severityOf(a.gapTypes) - severityOf(b.gapTypes) || String(b.startedAt || '').localeCompare(String(a.startedAt || '')));

  const stages = STAGES.filter(item => item.id !== 'none').map(item => ({
    id: item.id,
    label: item.label,
    sessions: stageCount.get(item.id) || 0,
    rate: share(stageCount.get(item.id) || 0, sessionCount)
  }));

  const signature = createHash('sha1')
    .update(JSON.stringify({
      sessionCount,
      totalQuestions,
      stage: stages.map(item => item.sessions),
      topics: topics.map(item => [item.id, item.questions]),
      gaps: gaps.map(item => [item.id, item.questions]),
      agents: agents.map(item => [item.agent, item.sessions])
    }))
    .digest('hex')
    .slice(0, 16);

  return {
    sessions: sessionCount,
    skipped,
    stages,
    questions: {
      total: totalQuestions,
      perSession: sessionCount ? round1(totalQuestions / sessionCount) : null,
      answeredYes: answerCount.yes,
      partial: answerCount.partial,
      no: answerCount.no,
      unknown: answerCount.unknown,
      unresolved: unresolvedCount,
      unresolvedRate: share(unresolvedCount, totalQuestions),
      answeredRate: share(answerCount.yes, totalQuestions)
    },
    sessionsWithGap,
    sessionsWithGapRate: share(sessionsWithGap, sessionCount),
    topics,
    topicCatalog: TOPICS.map(item => ({ id: item.id, label: item.label, stage: item.stage })),
    gaps,
    gapCatalog: GAP_TYPES.map(item => ({ id: item.id, label: item.label, severity: item.severity })),
    concerns: CONCERNS.map(item => ({ id: item.id, label: item.label, count: concernCount.get(item.id) || 0 }))
      .filter(item => item.count)
      .sort((a, b) => b.count - a.count),
    moods: MOODS.map(item => ({ id: item.id, label: item.label, count: moodCount.get(item.id) || 0 })),
    outcomes: OUTCOMES.map(item => ({ id: item.id, label: item.label, count: outcomeCount.get(item.id) || 0 })),
    agents,
    open: open.slice(0, limit),
    openTotal: open.length,
    signature
  };
}

function severityOf(gaps) {
  const list = Array.isArray(gaps) ? gaps : [];
  if (list.some(id => (id === UNCLASSIFIED.id ? 'medium' : GAP_MAP.get(id)?.severity) === 'high')) return 0;
  if (list.length) return 1;
  return 2;
}

module.exports = { aggregate };
