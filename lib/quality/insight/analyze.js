'use strict';

const client = require('../ai/client');
const { buildMessages } = require('./prompt');
const { normalizeInsight } = require('./verify');
const { VERSION } = require('./taxonomy');

/**
 * 单会话消费者洞察：把一段会话读成“顾客问了什么 + 客服答得如何”。
 * 和质检分析完全独立：不读质检结果，也不写质检表，方便各自重跑。
 */
async function analyzeSession(session, options = {}) {
  if (!session || !Array.isArray(session.messages) || !session.messages.length) {
    throw Object.assign(Error('会话没有可分析的消息'), { status: 422, code: 'EMPTY_SESSION' });
  }

  const built = buildMessages({ session });
  const result = await client.chatWithRetry(
    { messages: built.messages, maxTokens: 1600, temperature: 0.1, signal: options.signal },
    { retries: options.retries }
  );

  const raw = client.parseJson(result.content);
  const normalized = normalizeInsight(raw, session);

  return {
    version: VERSION,
    model: result.model,
    analyzedAt: new Date().toISOString(),
    ...normalized,
    warnings: [
      ...normalized.warnings,
      ...(built.transcriptMeta.truncated ? [`会话较长（${built.transcriptMeta.totalMessages} 条），中间部分已省略`] : [])
    ],
    usage: {
      promptTokens: result.usage?.promptTokens ?? null,
      completionTokens: result.usage?.completionTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null,
      calls: 1
    }
  };
}

async function analyzeBatch(sessions, options = {}) {
  const concurrency = Math.max(1, Math.min(6, Number(options.concurrency) || 3));
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
        options.onProgress({ done: results.filter(Boolean).length, total: sessions.length });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, sessions.length) }, worker));
  return results;
}

module.exports = { analyzeSession, analyzeBatch };
