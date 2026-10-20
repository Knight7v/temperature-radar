'use strict';

// 图像生成客户端（背景图专用）。
//
// 只做一件事：把提示词发出去，把图片字节拿回来。所有业务判断都在上层。
// 默认服务商是硅基流动（国内直连、Kolors 免费、Z-Image 约 0.1 元/张），
// 协议是 OpenAI 兼容的 /images/generations，所以换成任何兼容网关都只要改 Base URL。

const DEFAULT_BASE = 'https://api.siliconflow.cn/v1';
const DEFAULT_MODEL = 'Kwai-Kolors/Kolors';
const DEFAULT_TIMEOUT = 120000;

// 可选模型清单给前端下拉用。价格是写死的展示文案，随服务商调价需同步改这里。
const MODELS = Object.freeze([
  {
    id: 'Kwai-Kolors/Kolors',
    name: 'Kolors 快手可图',
    price: '免费',
    note: '日常场景图够用，出图快，适合先试'
  },
  {
    id: 'Tongyi-MAI/Z-Image-Turbo',
    name: 'Z-Image Turbo',
    price: '约 0.10 元 / 张',
    note: '光影与质感明显更好，正式出图推荐'
  },
  {
    id: 'Qwen/Qwen-Image',
    name: 'Qwen-Image',
    price: '约 0.30 元 / 张',
    note: '细节最丰富，适合高质量详情页 Banner'
  }
]);

function config() {
  const apiKey = String(process.env.DESIGN_IMAGE_API_KEY || process.env.SILICONFLOW_API_KEY || '').trim();
  return {
    apiKey,
    baseUrl: String(process.env.DESIGN_IMAGE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ''),
    model: String(process.env.DESIGN_IMAGE_MODEL || DEFAULT_MODEL).trim(),
    protocol: String(process.env.DESIGN_IMAGE_PROTOCOL || 'siliconflow').trim(),
    timeout: Number(process.env.DESIGN_IMAGE_TIMEOUT_MS) || DEFAULT_TIMEOUT
  };
}

function configured() {
  return Boolean(config().apiKey);
}

function fail(message, status, code) {
  return Object.assign(Error(message), { status: status || 502, code: code || 'DESIGN_UPSTREAM' });
}

function modelInfo(id) {
  return MODELS.find(item => item.id === id) || null;
}

function models() {
  const { model } = config();
  return MODELS.map(item => ({ ...item, active: item.id === model }));
}

// 不同服务商参数名不一致：硅基流动用 image_size / batch_size，
// 标准 OpenAI 用 size / n。传错参数的后果是静默返回默认尺寸，所以必须显式分支。
function requestBody({ prompt, negativePrompt, imageSize, model }) {
  const { protocol } = config();
  if (protocol === 'openai') {
    return {
      model,
      prompt,
      size: imageSize,
      n: 1,
      response_format: 'url'
    };
  }
  const body = {
    model,
    prompt,
    image_size: imageSize,
    batch_size: 1,
    num_inference_steps: 30,
    guidance_scale: 7.5
  };
  // Kolors 不接受 negative_prompt，传了会 400；其它模型才带。
  if (negativePrompt && !/kolors/i.test(model)) body.negative_prompt = negativePrompt;
  return body;
}

// 上游可能给 URL、b64_json，或直接在 images 里给 base64。三种都兜住。
async function extractImage(payload) {
  const list = payload && (payload.images || payload.data || payload.output?.results);
  const first = Array.isArray(list) ? list[0] : null;
  if (!first) {
    const message = payload?.error?.message || payload?.message || '生成服务未返回图片';
    throw fail(`生成服务未返回图片：${message}`, 502, 'DESIGN_EMPTY');
  }
  if (first.b64_json) return Buffer.from(first.b64_json, 'base64');
  if (first.image_base64) return Buffer.from(String(first.image_base64).replace(/^data:[^,]+,/, ''), 'base64');
  const url = first.url || first.image_url || '';
  if (!url) throw fail('生成服务返回的图片地址为空', 502, 'DESIGN_EMPTY');
  if (url.startsWith('data:')) return Buffer.from(url.replace(/^data:[^,]+,/, ''), 'base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw fail(`下载生成图片失败（${response.status}）`, 502, 'DESIGN_DOWNLOAD');
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function generate({ prompt, negativePrompt, imageSize = '1024x1024', model: modelOverride, signal }) {
  const { apiKey, baseUrl, timeout } = config();
  const model = String(modelOverride || config().model);
  if (!apiKey) throw fail('尚未配置图像生成 API Key', 503, 'DESIGN_NOT_CONFIGURED');
  if (!String(prompt || '').trim()) throw fail('背景描述不能为空', 422, 'DESIGN_NO_PROMPT');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(requestBody({ prompt, negativePrompt, imageSize, model })),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      const brief = raw.slice(0, 300);
      if (response.status === 401 || response.status === 403) {
        throw fail('图像生成 Key 无效或余额不足，请到服务商控制台检查', 503, 'DESIGN_AUTH_FAILED');
      }
      if (response.status === 429) throw fail('生成请求太频繁，请稍后再试', 429, 'DESIGN_RATE_LIMIT');
      throw fail(`生成失败（${response.status}）：${brief}`, 502, 'DESIGN_UPSTREAM');
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw fail('生成服务返回了无法解析的内容', 502, 'DESIGN_BAD_JSON');
    }
    const buffer = await extractImage(payload);
    return { buffer, mime: 'image/jpeg', model, bytes: buffer.length };
  } catch (error) {
    if (error.name === 'AbortError') throw fail('生成超时，请稍后重试或换更快的模型', 504, 'DESIGN_TIMEOUT');
    throw error.status ? error : fail(`连接生成服务失败：${error.message}`, 502, 'DESIGN_NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

// 自检：不消耗额度，只列模型确认 Key 有权限。
async function verify() {
  const { apiKey, baseUrl } = config();
  if (!apiKey) throw fail('尚未配置图像生成 API Key', 503, 'DESIGN_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    const raw = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw fail('API Key 无效，请重新生成', 503, 'DESIGN_AUTH_FAILED');
    }
    if (!response.ok) {
      if (response.status === 404) return { ok: true, model: config().model, note: '该服务不提供模型列表接口' };
      throw fail(`自检失败（${response.status}）：${raw.slice(0, 200)}`, 502, 'DESIGN_UPSTREAM');
    }
    let ids = [];
    try {
      const payload = JSON.parse(raw);
      ids = (payload.data || payload.models || []).map(item => item.id || item.model || '').filter(Boolean);
    } catch {
      return { ok: true, model: config().model, note: '模型列表格式异常，但鉴权已通过' };
    }
    const current = config().model;
    return {
      ok: true,
      model: current,
      available: ids.length ? ids.includes(current) : null,
      note: ids.length && !ids.includes(current) ? `当前模型 ${current} 不在你的可用列表里` : '鉴权通过'
    };
  } catch (error) {
    if (error.name === 'AbortError') throw fail('连接生成服务超时，请检查网络', 504, 'DESIGN_TIMEOUT');
    throw error.status ? error : fail(`连接生成服务失败：${error.message}`, 502, 'DESIGN_NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { config, configured, generate, verify, models, modelInfo, MODELS };
