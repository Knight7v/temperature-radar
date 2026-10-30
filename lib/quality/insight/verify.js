'use strict';

const { mask } = require('../ai/prompt');
const {
  TOPICS,
  GAP_TYPES,
  CONCERNS,
  MOODS,
  OUTCOMES,
  STAGES,
  UNCLASSIFIED,
  gapSeverity
} = require('./taxonomy');

const TOPIC_IDS = new Set(TOPICS.map(item => item.id));
const GAP_IDS = new Set(GAP_TYPES.map(item => item.id));
const CONCERN_IDS = new Set(CONCERNS.map(item => item.id));
const MOOD_IDS = new Set(MOODS.map(item => item.id));
const OUTCOME_IDS = new Set(OUTCOMES.map(item => item.id));
const STAGE_IDS = new Set(STAGES.map(item => item.id));

const MAX_QUESTIONS = 6;
const MAX_CONCERNS = 2;

const text = (value, max) => {
  const clean = mask(String(value == null ? '' : value)).replace(/\s+/g, ' ').trim();
  return max && clean.length > max ? clean.slice(0, max) : clean;
};

function toEnum(value, allowed, fallback) {
  const id = String(value || '').trim();
  return allowed.has(id) ? id : fallback;
}

function messageIndex(session) {
  const map = new Map();
  for (const item of Array.isArray(session?.messages) ? session.messages : []) {
    const id = Number(item?.id);
    if (Number.isFinite(id)) map.set(id, item);
  }
  return map;
}

// 模型偶尔把 messageId 写成字符串或写错编号。这里只做“落到真实消息上”的纠正，
// 不猜语义：找不到就退回最近一条顾客消息，再找不到就丢掉这条问题。
function resolveMessage(index, value, role) {
  const id = Number(value);
  if (Number.isFinite(id) && index.has(id)) {
    const item = index.get(id);
    if (!role || item.role === role) return item;
  }
  if (!role) return null;
  const candidates = [...index.values()].filter(item => item.role === role);
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function dedupeKey(value) {
  return String(value || '').replace(/[\s，。,.!?！？~～#*]/g, '').slice(0, 14);
}

function normalizeInsight(raw, session) {
  const warnings = [];
  const index = messageIndex(session);
  const customers = [...index.values()].filter(item => item.role === 'customer' && String(item.text || '').trim());

  if (!customers.length) {
    return {
      stage: 'none',
      outcome: 'unknown',
      mood: 'unknown',
      questions: [],
      concerns: [],
      summary: '会话里没有顾客发言，无法提炼问题。',
      coaching: '',
      stats: { questionCount: 0, unresolvedCount: 0, gapTypes: [] },
      warnings: ['会话没有顾客消息，未做洞察分析'],
      skipped: true
    };
  }

  const stage = toEnum(raw?.stage, STAGE_IDS, 'none');
  const outcome = toEnum(raw?.outcome, OUTCOME_IDS, 'unknown');
  const mood = toEnum(raw?.mood, MOOD_IDS, 'unknown');

  const questions = [];
  const seen = new Set();
  const rawQuestions = Array.isArray(raw?.questions) ? raw.questions : [];
  for (const item of rawQuestions) {
    if (questions.length >= MAX_QUESTIONS) break;
    const body = text(item?.text, 60);
    if (!body) continue;
    const key = dedupeKey(body);
    if (seen.has(key)) continue;
    seen.add(key);

    const customerMessage = resolveMessage(index, item?.messageId, 'customer');
    if (!customerMessage) {
      warnings.push(`问题「${body.slice(0, 12)}」找不到对应的顾客消息，已丢弃`);
      continue;
    }

    const answered = toEnum(item?.answered, new Set(['yes', 'partial', 'no', 'unknown']), 'unknown');
    let gapTypes = (Array.isArray(item?.gapTypes) ? item.gapTypes : [])
      .map(value => String(value || '').trim())
      .filter((value, position, list) => GAP_IDS.has(value) && list.indexOf(value) === position)
      .slice(0, 4);

    // 没答清就必须能说出缺在哪：模型忘了给类型时落到“未说明不足”，并标记待复核，
    // 不能因为缺字段就把这条算成已解决。
    const needsReview = (answered === 'no' || answered === 'partial') && !gapTypes.length;
    if (needsReview) gapTypes = [UNCLASSIFIED.id];

    const evidence = resolveMessage(index, item?.evidenceMessageId, null);
    questions.push({
      text: body,
      messageId: customerMessage.id,
      topic: toEnum(item?.topic, TOPIC_IDS, 'other'),
      stage: toEnum(item?.stage, new Set(['pre_sale', 'after_sale']), stage === 'after_sale' ? 'after_sale' : 'pre_sale'),
      repeat: Boolean(item?.repeat),
      answered,
      gapTypes,
      gapDetail: text(item?.gapDetail, 80),
      evidenceMessageId: evidence ? evidence.id : null,
      needsReview
    });
  }

  if (!questions.length) {
    // 顾客只发了链接或表情：仍然记一条，避免这条会话在统计里凭空消失。
    const last = customers[customers.length - 1];
    questions.push({
      text: text(last.text, 30) || '顾客仅发送链接或表情',
      messageId: last.id,
      topic: 'other',
      stage: 'pre_sale',
      repeat: false,
      answered: 'unknown',
      gapTypes: [],
      gapDetail: '',
      evidenceMessageId: null,
      needsReview: true
    });
    warnings.push('模型没有给出可用的顾客问题，已按原话兜底记录');
  }

  const concerns = (Array.isArray(raw?.concerns) ? raw.concerns : [])
    .map(value => String(value || '').trim())
    .filter((value, position, list) => CONCERN_IDS.has(value) && list.indexOf(value) === position)
    .slice(0, MAX_CONCERNS);

  const unresolvedCount = questions.filter(item => item.answered === 'no' || item.answered === 'partial').length;
  const allGaps = [...new Set(questions.flatMap(item => item.gapTypes))];

  return {
    stage: stage === 'none' ? 'pre_sale' : stage,
    outcome,
    mood,
    questions,
    concerns,
    summary: text(raw?.summary, 120),
    coaching: text(raw?.coaching, 120),
    stats: {
      questionCount: questions.length,
      unresolvedCount,
      gapTypes: allGaps,
      topSeverity: allGaps.map(gapSeverity).sort((a, b) => rank(a) - rank(b))[0] || null
    },
    warnings,
    skipped: false
  };
}

function rank(severity) {
  return severity === 'high' ? 0 : severity === 'medium' ? 1 : 2;
}

module.exports = { normalizeInsight, MAX_QUESTIONS, MAX_CONCERNS };
