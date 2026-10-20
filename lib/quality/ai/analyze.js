'use strict';

const client = require('./client');
const { buildMessages, buildClassifyMessages } = require('./prompt');
const { normalizeJudgments } = require('./verify');
const { computeScore } = require('./score');
const { applicableCriteria, RUBRIC_VERSION, CATEGORIES } = require('./rubric');

const VALID_CATEGORIES = new Set(CATEGORIES.map(item => item.id));

function sanitizeCategories(list) {
  const output = [];
  for (const item of Array.isArray(list) ? list : []) {
    const id = String(item || '').trim();
    if (VALID_CATEGORIES.has(id) && !output.includes(id)) output.push(id);
    if (output.length >= 3) break;
  }
  return output;
}

async function classify(session, options = {}) {
  const messages = buildClassifyMessages({ session });
  const result = await client.chatWithRetry({ messages, maxTokens: 200, temperature: 0, signal: options.signal }, { retries: options.retries });
  const parsed = client.parseJson(result.content);
  return { categories: sanitizeCategories(parsed?.categories), usage: result.usage, model: result.model };
}

/**
 * 单会话 AI 质检。
 * @param {object} session  质检会话（含 messages / agent / startedAt / endedAt）
 * @param {object} options  categories 指定分类则跳过分类调用；classify=false 关闭分类
 */
async function analyzeSession(session, options = {}) {
  if (!session || !Array.isArray(session.messages) || !session.messages.length) {
    throw Object.assign(Error('会话没有可分析的消息'), { status: 422, code: 'EMPTY_SESSION' });
  }

  const usages = [];
  let categories = sanitizeCategories(options.categories);
  let model = null;
  let classifyError = null;

  if (!categories.length && options.classify !== false) {
    try {
      const classified = await classify(session, options);
      categories = classified.categories;
      usages.push(classified.usage);
      model = classified.model;
    } catch (error) {
      // 分类失败不阻断主流程：退化为"全部规则适用"，只是多判几项。
      classifyError = error.message;
    }
  }

  const built = buildMessages({ session, categories });
  const result = await client.chatWithRetry({ messages: built.messages, maxTokens: 3000, temperature: 0.1, signal: options.signal }, { retries: options.retries });
  usages.push(result.usage);
  model = result.model || model;

  const raw = client.parseJson(result.content);
  const normalized = normalizeJudgments(raw, session, built.criteria);
  const score = computeScore(normalized);

  const promptTokens = usages.reduce((sum, item) => sum + (item?.promptTokens || 0), 0);
  const completionTokens = usages.reduce((sum, item) => sum + (item?.completionTokens || 0), 0);

  return {
    rubricVersion: RUBRIC_VERSION,
    model,
    analyzedAt: new Date().toISOString(),
    categories: normalized.categories.length ? normalized.categories : categories,
    summary: normalized.summary,
    overall: normalized.overall,
    criteria: normalized.criteria,
    score,
    warnings: [
      ...(classifyError ? [`分类调用失败，已按全部规则判定：${classifyError}`] : []),
      ...(built.transcriptMeta.truncated ? [`会话较长（${built.transcriptMeta.totalMessages} 条），中间部分已省略`] : []),
      ...(normalized.criteria.some(item => item.missing) ? ['模型缺少部分质检项，已按不适用处理并标记待复核'] : [])
    ],
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      calls: usages.length
    },
    facts: built.facts,
    applicableCount: built.criteria.length,
    hasKey: client.configured()
  };
}

// 批量：可控并发，避免把 DeepSeek 的限流打满。
async function analyzeBatch(sessions, options = {}) {
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 3));
  const results = new Array(sessions.length);
  let cursor = 0;

  async function worker() {
    while (cursor < sessions.length) {
      const index = cursor;
      cursor += 1;
      const session = sessions[index];
      try {
        results[index] = { ok: true, session, analysis: await analyzeSession(session, options) };
      } catch (error) {
        results[index] = { ok: false, session, error: { message: error.message, code: error.code || 'AI_FAILED' } };
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          done: results.filter(Boolean).length,
          total: sessions.length,
          ok: results.filter(item => item?.ok).length
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, sessions.length) }, worker));
  return results;
}

module.exports = { analyzeSession, analyzeBatch, classify, sanitizeCategories, applicableCriteria };
