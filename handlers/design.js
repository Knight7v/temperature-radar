'use strict';

// 视觉设计板块的 AI 作图接口。
//
// 分工：
//   action=meta     告诉前端「能不能出图、有哪些场景、支持哪些模型」
//   action=scenes   内置场景库清单
//   action=prompt   用 DeepSeek 把一句中文需求扩写成专业背景提示词
//   action=generate 真正调用图像生成服务，产出背景图
//   action=verify   自检 Key 是否可用（不消耗额度）
//
// 商品图和文案永远不经过这里：接口只产出「背景」，商品与文字由浏览器 canvas 合成。

const fs = require('node:fs');
const path = require('node:path');
const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
// 复用质检模块里那套 DeepSeek 客户端（通用的 OpenAI 兼容对话客户端，与本模块无业务耦合）
const deepseek = require('../lib/quality/ai/client');
const scenes = require('../lib/design/scenes');
const provider = require('../lib/design/provider');
const promptBuilder = require('../lib/design/prompt');
const store = require('../lib/design/store');

const fail = (message, status = 422, code) => {
  throw Object.assign(Error(message), { status, code });
};

// 场景图是否真的落到了仓库里（第一次部署可能还没生成）
const SCENE_DIR = path.resolve(__dirname, '../assets/design/scenes');
function sceneReady(file) {
  try {
    return fs.statSync(path.join(SCENE_DIR, file)).size > 1024;
  } catch {
    return false;
  }
}

// 简单节流：连点生成按钮会白烧钱，同一租户 4 秒内只放行一次。
const lastHit = new Map();
function throttle(tenantId) {
  const now = Date.now();
  const last = lastHit.get(tenantId) || 0;
  if (now - last < 4000) throw fail('刚生成过一张，请等几秒再试，避免重复扣费', 429, 'DESIGN_THROTTLED');
  lastHit.set(tenantId, now);
  if (lastHit.size > 500) lastHit.clear();
}

const CATEGORIES = [
  { id: 'aircon', name: '空调 · 挂机' },
  { id: 'aircon-floor', name: '空调 · 柜机' },
  { id: 'fridge', name: '冰箱' },
  { id: 'washer', name: '洗衣机' },
  { id: 'tv', name: '电视' },
  { id: 'generic', name: '其它家电' }
];

const PLATFORMS = [
  { id: 'jd', name: '京东' },
  { id: 'tmall', name: '天猫' },
  { id: 'pdd', name: '拼多多' },
  { id: 'generic', name: '通用' }
];

function meta() {
  const { model, protocol, baseUrl, apiKey } = provider.config();
  return {
    configured: provider.configured(),
    keyHint: apiKey ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '',
    provider: protocol === 'openai' ? 'OpenAI 兼容网关' : '硅基流动',
    baseUrl,
    model,
    modelOptions: provider.models(),
    scenes: scenes.list().map(scene => ({ ...scene, ready: sceneReady(scene.file) })),
    categories: CATEGORIES,
    platforms: PLATFORMS,
    sizes: Object.entries(promptBuilder.SIZES).map(([id, value]) => ({ id, label: value.label, width: value.width, height: value.height })),
    // 京东首图硬规范，前端据此做合规校验，也直接展示给用户看
    jdRules: {
      minSize: 800,
      recommendSize: 1200,
      maxBytes: 3 * 1024 * 1024,
      productRatio: 0.7,
      padding: 30,
      firstImage: '纯白底（RGB 255,255,255）、无文字、无 LOGO、无边框，商品占比 ≥70%'
    },
    textModel: deepseek.configured() ? deepseek.config().model : null
  };
}

module.exports = apiHandler(async (req, res) => {
  const action = String(req.query.action || 'meta');
  const write = req.method === 'POST';
  const user = await requireInventoryUser(req, write ? ['admin', 'operator'] : ['admin', 'operator', 'supply_chain', 'viewer']);
  const body = req.body || {};

  if (!write) {
    if (action === 'meta') return res.json({ data: meta() });
    if (action === 'scenes') return res.json({ data: scenes.list().map(scene => ({ ...scene, ready: sceneReady(scene.file) })) });
    if (action === 'verify') {
      try {
        return res.json({ data: { ok: true, ...(await provider.verify()) } });
      } catch (error) {
        return res.json({ data: { ok: false, error: error.message, code: error.code || 'DESIGN_VERIFY_FAILED' } });
      }
    }
    return res.status(404).json({ error: '未知操作' });
  }

  if (action === 'prompt') {
    if (!deepseek.configured()) fail('尚未配置 DeepSeek Key，无法智能扩写；可直接手写背景描述', 503, 'AI_NOT_CONFIGURED');
    const direction = String(body.direction || '').trim();
    if (!direction) fail('请先写一句场景需求，例如「客厅傍晚暖光，留出挂机位」');
    const scene = body.sceneId ? scenes.get(body.sceneId) : null;
    const context = [
      `商品品类：${(CATEGORIES.find(item => item.id === body.category) || CATEGORIES[0]).name}`,
      `投放平台：${(PLATFORMS.find(item => item.id === body.platform) || PLATFORMS[0]).name}`,
      scene ? `参考场景：${scene.name}（${scene.desc}）` : '',
      `商家需求：${direction.slice(0, 200)}`
    ]
      .filter(Boolean)
      .join('\n');
    const result = await deepseek.chatWithRetry({
      messages: [
        { role: 'system', content: promptBuilder.instruction() },
        { role: 'user', content: context }
      ],
      temperature: 0.4,
      maxTokens: 700
    });
    const parsed = deepseek.parseJson(result.content);
    return res.json({
      data: {
        prompt: String(parsed.prompt || '').slice(0, 1200),
        negative: String(parsed.negative || '').slice(0, 400),
        note: String(parsed.note || '').slice(0, 120),
        model: result.model
      }
    });
  }

  if (action === 'generate') {
    if (!provider.configured()) {
      fail('尚未配置图像生成 Key。可先用内置场景库出图，或在 .env.local 填入 DESIGN_IMAGE_API_KEY', 503, 'DESIGN_NOT_CONFIGURED');
    }
    throttle(user.tenantId);

    const scene = body.sceneId ? scenes.get(body.sceneId) : null;
    if (body.sceneId && !scene) fail('场景不存在');
    const ratio = promptBuilder.pickSize(body.ratio);
    const size = promptBuilder.sizeOf(ratio);
    const hasText = body.hasText !== false;

    // 前端可以传「已扩写好的 prompt」直接生成，也可以只给一句话让这里拼。
    const custom = String(body.prompt || '').trim();
    const built = promptBuilder.build({
      scene,
      category: body.category,
      platform: body.platform,
      direction: body.direction || '',
      hasText,
      ratio
    });
    const finalPrompt = custom || built.prompt;
    const negative = String(body.negative || '').trim() || built.negativePrompt;

    const startedAt = Date.now();
    // 前端可以指定模型，但只接受白名单里的，避免把任意字符串转发给上游
    const requested = String(body.model || '').trim();
    const model = provider.modelInfo(requested) ? requested : provider.config().model;
    const shot = await provider.generate({
      prompt: finalPrompt,
      negativePrompt: negative,
      imageSize: size.imageSize,
      model
    });
    const saved = store.save(shot.buffer, {
      prompt: finalPrompt,
      model: shot.model,
      scene: scene ? scene.id : 'custom',
      meta: { ratio, size: size.imageSize, category: body.category || '' }
    });

    console.log(`[design] 生成背景 ${shot.model} ${size.imageSize} ${shot.bytes}B ${Date.now() - startedAt}ms tenant=${user.tenantId}`);

    return res.json({
      data: {
        url: saved ? saved.url : '',
        dataUrl: saved ? '' : store.toDataUrl(shot.buffer, shot.mime),
        model: shot.model,
        sceneId: scene ? scene.id : '',
        ratio,
        size: size.imageSize,
        prompt: finalPrompt,
        negative,
        bytes: shot.bytes,
        elapsedMs: Date.now() - startedAt,
        persisted: Boolean(saved)
      }
    });
  }

  return res.status(404).json({ error: '未知操作' });
});
