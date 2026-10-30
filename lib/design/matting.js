'use strict';

// 服务端抠图（可选）。
//
// 默认不启用：常规商品图（京东/天猫白底图）在浏览器里就能抠干净，免费、不上传、还快。
// 这里留的是"难图"的兜底通道——商品压在深色背景上、边缘有毛发/布料、机身与背景同色时，
// 本地算法会给出低分，此时如果配了 AI 抠图服务，就送过去做一次精修。
//
// 两种接法，按配置优先级：
//   ① DESIGN_MATTING_URL       自建端点（rembg / BiRefNet 之类的 HTTP 服务），POST JSON 拿 PNG
//   ② REMOVEBG_API_KEY         remove.bg 官方接口
// 都没配时 configured() 返回 false，前端不会显示"AI 精修"按钮，也就不会误导用户。

const DEFAULT_TIMEOUT = 60000;

function config() {
  const url = String(process.env.DESIGN_MATTING_URL || '').trim().replace(/\/+$/, '');
  return {
    url,
    key: String(process.env.DESIGN_MATTING_KEY || '').trim(),
    removeBgKey: String(process.env.REMOVEBG_API_KEY || '').trim(),
    timeout: Number(process.env.DESIGN_MATTING_TIMEOUT_MS) || DEFAULT_TIMEOUT
  };
}

function configured() {
  const { url, removeBgKey } = config();
  return Boolean(url || removeBgKey);
}

function engineName() {
  const { url, removeBgKey } = config();
  if (url) return '自建抠图服务';
  if (removeBgKey) return 'remove.bg';
  return '';
}

function fail(message, status = 502, code = 'MATTING_UPSTREAM') {
  return Object.assign(Error(message), { status, code });
}

async function withTimeout(promise, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// 上游可能直接返回 PNG 字节，也可能返回 JSON（带 base64 或 url）。三种都兜住，
// 因为各家自建服务的返回体没有统一标准。
async function extractPng(response) {
  const type = String(response.headers.get('content-type') || '');
  if (type.includes('image/')) return Buffer.from(await response.arrayBuffer());
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw fail('抠图服务返回了无法解析的内容');
  }
  const base64 = payload.image_base64 || payload.image || payload.data || payload.output || '';
  if (typeof base64 === 'string' && base64.startsWith('data:')) {
    return Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64');
  }
  if (typeof base64 === 'string' && base64.length > 100) return Buffer.from(base64, 'base64');
  if (payload.url) {
    const download = await fetch(payload.url);
    if (!download.ok) throw fail('下载抠图结果失败');
    return Buffer.from(await download.arrayBuffer());
  }
  throw fail(payload.error || payload.message || '抠图服务没有返回图片');
}

async function viaCustom({ buffer, mime }) {
  const { url, key, timeout } = config();
  const body = JSON.stringify({ image: buffer.toString('base64'), mime, format: 'png' });
  return withTimeout(async signal => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body,
      signal
    });
    if (!response.ok) throw fail(`抠图服务返回 ${response.status}：${(await response.text()).slice(0, 200)}`);
    return extractPng(response);
  }, timeout);
}

async function viaRemoveBg({ buffer, mime }) {
  const { removeBgKey, timeout } = config();
  return withTimeout(async signal => {
    const form = new FormData();
    form.append('image_file', new Blob([buffer], { type: mime || 'image/png' }), 'product.png');
    form.append('size', 'auto');
    form.append('format', 'png');
    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': removeBgKey },
      body: form,
      signal
    });
    if (response.status === 402) throw fail('抠图额度已用完，请到 remove.bg 控制台充值或换自建服务', 429, 'MATTING_QUOTA');
    if (response.status === 401 || response.status === 403) throw fail('抠图 Key 无效', 503, 'MATTING_AUTH');
    if (!response.ok) throw fail(`抠图失败（${response.status}）`);
    return Buffer.from(await response.arrayBuffer());
  }, timeout);
}

async function refine({ buffer, mime }) {
  if (!buffer || !buffer.length) throw fail('缺少商品图', 422, 'MATTING_NO_IMAGE');
  if (!configured()) {
    throw fail('没有配置 AI 抠图服务；本机抠图始终可用', 503, 'MATTING_NOT_CONFIGURED');
  }
  const { url } = config();
  try {
    const png = url ? await viaCustom({ buffer, mime }) : await viaRemoveBg({ buffer, mime });
    return { buffer: png, mime: 'image/png', engine: engineName(), bytes: png.length };
  } catch (error) {
    if (error.name === 'AbortError') throw fail('抠图超时，请稍后重试', 504, 'MATTING_TIMEOUT');
    throw error.status ? error : fail(`连接抠图服务失败：${error.message}`);
  }
}

module.exports = { config, configured, engineName, refine };
