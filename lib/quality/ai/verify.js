'use strict';

const { mask } = require('./prompt');
const { criterion } = require('./rubric');

// 归一化：去掉空白与常见标点差异，降低模型"少打一个逗号"造成的误判。
function normalize(text) {
  return String(text ?? '')
    .replace(/\s+/g, '')
    .replace(/[“”"‘’'']/g, '')
    .replace(/[，。！？、；：,.!?;:…—\-~～]/g, '')
    .toLowerCase();
}

// 证据校验：messageId 必须存在，quote 必须确实是该消息的连续片段。
// 这是防幻觉的核心闸门——模型编造的证据在这里被拦下，判定自动降级为待人工。
function verifyEvidence(evidence, byId) {
  const list = Array.isArray(evidence) ? evidence : [];
  const valid = [];
  const rejected = [];
  for (const item of list) {
    const id = Number(item?.messageId);
    const message = byId.get(id);
    const quote = String(item?.quote ?? '').trim();
    if (!message) {
      rejected.push({ messageId: Number.isFinite(id) ? id : null, quote, reason: '消息编号不存在' });
      continue;
    }
    if (!quote) {
      rejected.push({ messageId: id, quote, reason: '引文为空' });
      continue;
    }
    const haystack = normalize(mask(message.text));
    const needle = normalize(mask(quote));
    if (!needle) {
      rejected.push({ messageId: id, quote, reason: '引文为空' });
      continue;
    }
    if (haystack.includes(needle)) {
      valid.push({ messageId: id, quote, role: message.role, at: message.at });
    } else {
      rejected.push({ messageId: id, quote, reason: '引文与该消息原文不一致' });
    }
  }
  return { valid, rejected };
}

/**
 * 把模型输出整理成可算分的判定。
 * 规则：
 *  - fail 必须有有效证据，且置信度过线（红线 0.85 / 关键项 0.7），否则降级 pending（不扣分，转人工）
 *  - 关键项 pass 但置信度 < 0.5 → pending（关键项宁严勿松）
 *  - 非关键项 score 缺失 → pending
 * 阈值按「误判代价」分级：红线命中即 0 分，误判代价最大，门槛最高。
 */
// 判定失败所需的最低置信度：级别越高，误判代价越大，门槛越高。
const FAIL_CONFIDENCE = { fatal: 0.85, critical: 0.7, standard: 0.5 };

function normalizeJudgments(raw, session, criteria) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const byId = new Map(messages.map(item => [Number(item.id), item]));
  const submitted = Array.isArray(raw?.criteria) ? raw.criteria : [];
  const submittedById = new Map();
  for (const item of submitted) {
    const id = String(item?.id || '').trim();
    if (!criterion(id)) continue;
    if (!submittedById.has(id)) submittedById.set(id, item);
  }

  const results = [];
  for (const spec of criteria) {
    const item = submittedById.get(spec.id) || {};
    const evidence = verifyEvidence(item.evidence, byId);
    let verdict = String(item.verdict || '').toLowerCase();
    if (!['pass', 'fail', 'na'].includes(verdict)) verdict = 'na';
    const confidence = Math.max(0, Math.min(1, Number(item.confidence ?? 0)));
    const reason = String(item.reason || '').slice(0, 300);
    let status = verdict;
    let note = '';

    if (verdict === 'fail') {
      if (!evidence.valid.length) {
        status = 'pending';
        note = '模型判定不合格但未给出可核实的原文证据，已转人工复核，暂不扣分';
      } else if (confidence < FAIL_CONFIDENCE[spec.kind]) {
        status = 'pending';
        note = `模型置信度偏低（${confidence.toFixed(2)}，${FAIL_CONFIDENCE[spec.kind]} 以上才扣分），转人工复核，暂不扣分`;
      }
    } else if (verdict === 'pass' && spec.kind !== 'standard' && confidence < 0.5) {
      status = 'pending';
      note = `关键项判定把握不足（${confidence.toFixed(2)}），转人工复核`;
    }

    let score = null;
    if (spec.kind === 'standard') {
      const raw5 = Number(item.score);
      if ([5, 3, 1].includes(raw5)) score = raw5;
      else if (status === 'pass') {
        status = 'pending';
        note = note || '非关键项缺少 5/3/1 评分，转人工复核';
      }
      if (status === 'na') score = null;
    }

    results.push({
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      applies: true,
      status,
      score,
      confidence: Number.isFinite(confidence) ? Math.round(confidence * 100) / 100 : 0,
      reason,
      note,
      evidence: evidence.valid.slice(0, 5),
      rejectedEvidence: evidence.rejected.slice(0, 5),
      missing: !submittedById.has(spec.id)
    });
  }

  const categories = (Array.isArray(raw?.categories) ? raw.categories : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 3);

  return {
    categories,
    summary: String(raw?.summary || '').slice(0, 200),
    overall: String(raw?.overall || '').slice(0, 300),
    criteria: results
  };
}

module.exports = { normalize, verifyEvidence, normalizeJudgments };
