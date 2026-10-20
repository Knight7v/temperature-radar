'use strict';

// DeepSeek 客户端（OpenAI 兼容协议）。只做一件事：发对话、拿 JSON、报告用量。
// 不在本文件里写任何业务判断。

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT = 90000;

function config() {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  return {
    apiKey,
    baseUrl: String(process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ''),
    model: String(process.env.DEEPSEEK_MODEL || DEFAULT_MODEL),
    timeout: Number(process.env.DEEPSEEK_TIMEOUT_MS) || DEFAULT_TIMEOUT
  };
}

function configured() {
  return Boolean(config().apiKey);
}

function fail(message, status, code) {
  return Object.assign(Error(message), { status: status || 502, code: code || 'DEEPSEEK_ERROR' });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// JSON 输出偶发带 ```json 包裹或尾随逗号，做最小修复；修不好就交给上层判定为失败。
function parseJson(content) {
  const text = String(content || '').trim();
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.search(/[[{]/);
    const end = Math.max(stripped.lastIndexOf('}'), stripped.lastIndexOf(']'));
    if (start < 0 || end <= start) throw fail('模型返回内容不是合法 JSON', 502, 'AI_BAD_JSON');
    const sliced = stripped.slice(start, end + 1);
    try {
      return JSON.parse(sliced);
    } catch {
      const repaired = sliced.replace(/,\s*([}\]])/g, '$1');
      try {
        return JSON.parse(repaired);
      } catch {
        throw fail('模型返回内容不是合法 JSON', 502, 'AI_BAD_JSON');
      }
    }
  }
}

async function chat({ messages, temperature = 0.1, maxTokens = 3000, json = true, signal }) {
  const { apiKey, baseUrl, model, timeout } = config();
  if (!apiKey) throw fail('未配置 DeepSeek API Key（DEEPSEEK_API_KEY）', 503, 'AI_NOT_CONFIGURED');

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false
  };
  if (json) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      const brief = raw.slice(0, 300);
      const status = response.status === 401 || response.status === 403 ? 503 : 502;
      const code = response.status === 401 || response.status === 403 ? 'AI_AUTH_FAILED' : response.status === 429 ? 'AI_RATE_LIMIT' : 'AI_UPSTREAM';
      throw fail(`DeepSeek 请求失败（${response.status}）：${brief}`, status, code);
    }
    const payload = JSON.parse(raw);
    const choice = payload.choices && payload.choices[0];
    if (!choice || !choice.message) throw fail('DeepSeek 未返回结果', 502, 'AI_EMPTY');
    return {
      content: choice.message.content || '',
      finishReason: choice.finish_reason,
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? null,
        completionTokens: payload.usage?.completion_tokens ?? null,
        totalTokens: payload.usage?.total_tokens ?? null,
        cacheHitTokens: payload.usage?.prompt_cache_hit_tokens ?? null
      },
      model: payload.model || model
    };
  } catch (error) {
    if (error.name === 'AbortError') throw fail('DeepSeek 请求超时，请稍后重试', 504, 'AI_TIMEOUT');
    throw error.status ? error : fail(`DeepSeek 请求失败：${error.message}`, 502, 'AI_NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

// 连通性自检：只查余额，不消耗 token。用来区分「填了 Key」和「Key 真能用」。
// 返回 { ok, balance, currency } 或抛错（错误信息直接给用户看）。
async function verify() {
  const { apiKey, baseUrl } = config();
  if (!apiKey) throw fail('未配置 DeepSeek API Key（DEEPSEEK_API_KEY）', 503, 'AI_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config().timeout, 15000));
  try {
    const response = await fetch(`${baseUrl}/user/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    const raw = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw fail('API Key 无效或已被删除，请到 DeepSeek 控制台重新生成', 503, 'AI_AUTH_FAILED');
    }
    if (!response.ok) {
      // 部分代理不实现 /user/balance，只要不是鉴权失败就当可用
      if (response.status === 404) return { ok: true, balance: null, currency: 'CNY', note: '该服务不提供余额查询' };
      throw fail(`DeepSeek 自检失败（${response.status}）：${raw.slice(0, 200)}`, 502, 'AI_UPSTREAM');
    }
    let payload = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      return { ok: true, balance: null, currency: 'CNY', note: '余额返回格式异常' };
    }
    const info = (payload.balance_infos || [])[0] || {};
    return {
      ok: true,
      available: payload.is_available !== false,
      balance: info.total_balance == null ? null : Number(info.total_balance),
      currency: info.currency || 'CNY'
    };
  } catch (error) {
    if (error.name === 'AbortError') throw fail('连接 DeepSeek 超时，请检查网络或代理', 504, 'AI_TIMEOUT');
    throw error.status ? error : fail(`连接 DeepSeek 失败：${error.message}`, 502, 'AI_NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

// 429/5xx 退避重试；4xx（除 429）不重试，避免无意义消耗。
async function chatWithRetry(options, { retries = 2, baseDelay = 800 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await chat(options);
    } catch (error) {
      lastError = error;
      const retryable = ['AI_RATE_LIMIT', 'AI_UPSTREAM', 'AI_NETWORK', 'AI_TIMEOUT'].includes(error.code);
      if (!retryable || attempt === retries) break;
      await sleep(baseDelay * 2 ** attempt);
    }
  }
  throw lastError;
}

module.exports = { config, configured, verify, chat, chatWithRetry, parseJson };
