'use strict';

// 视觉设计板块的接口。
//
// 分工：
//   action=meta         告诉前端「能不能出图、有哪些场景、支持哪些模型、素材库开没开」
//   action=scenes       内置场景库清单
//   action=prompt       用 DeepSeek 把一句中文需求扩写成专业背景提示词
//   action=generate     调用图像生成服务出背景（失败自动换模型，见 provider.generateWithFallback）
//   action=verify       自检 Key 是否可用（不消耗额度）
//   action=matting      AI 精修抠图（可选，未配置时前端不显示按钮）
//   action=assets       素材库列表（按型号/用途/日期/关键词筛）
//   action=asset-save   存进素材库
//   action=asset-update 改状态/标题/型号
//   action=asset-delete 删记录（连带删文件）
//   action=assets-zip   按型号或选中项打包 ZIP（返回 base64）
//   action=usage        本月出图张数与花费
//
// 铁律不变：接口只产出「背景」和「成品图」，商品与文字永远由浏览器 canvas 合成，
// 商品图不进任何生成模型。

const fs = require('node:fs');
const path = require('node:path');
const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
const { getInventoryPool } = require('../lib/db/inventory-client');
// 复用质检模块里那套 DeepSeek 客户端（通用的 OpenAI 兼容对话客户端，与本模块无业务耦合）
const deepseek = require('../lib/quality/ai/client');
const scenes = require('../lib/design/scenes');
const provider = require('../lib/design/provider');
const promptBuilder = require('../lib/design/prompt');
const store = require('../lib/design/store');
const assets = require('../lib/design/assets');
const usage = require('../lib/design/usage');
const matting = require('../lib/design/matting');
const { ensureDesignSchema } = require('../lib/design/schema');

const fail = (message, status = 422, code) => {
  throw Object.assign(Error(message), { status, code });
};

const uuid = value => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))) fail('ID 无效');
  return value;
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

// 型号下拉：直接读产品知识库，避免手打型号写错字母后面搜不到图。
// 读不到（表还没建、或没导过参数表）就返回空数组，不影响出图。
async function productModels(db, tenant) {
  try {
    const rows = (
      await db.query(
        `SELECT DISTINCT ON (data->>'model')
                data->>'model' AS model, data->>'name' AS name, data->>'brand' AS brand
           FROM product_knowledge
          WHERE tenant_id=$1 AND coalesce(data->>'model','')<>''
          ORDER BY data->>'model'`,
        [tenant]
      )
    ).rows;
    return rows.map(row => ({ model: row.model, name: row.name || '', brand: row.brand || '' }));
  } catch {
    return [];
  }
}

// 素材库列表要用的枚举 + 当前张数。张数放 meta 里是为了打开页面就能显示在按钮上，
// 不用为了一行数字再发一次请求。
async function libraryMeta(db, tenant) {
  const base = assets.meta();
  try {
    const row = (await db.query('SELECT count(*)::int AS total FROM design_assets WHERE tenant_id=$1', [tenant])).rows[0];
    return { ...base, total: row ? row.total : 0 };
  } catch {
    return { ...base, total: 0 };
  }
}

async function meta(db, tenant) {
  const { model, protocol, baseUrl, apiKey } = provider.config();  return {
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
    textModel: deepseek.configured() ? deepseek.config().model : null,
    // 抠图：本机算法永远可用（免费、不上传）；AI 精修要看有没有配服务
    matting: { local: true, ai: matting.configured(), engine: matting.engineName() },
    library: await libraryMeta(db, tenant),
    usage: await usage.summary(db, tenant).catch(() => null),
    productModels: await productModels(db, tenant)
  };
}

module.exports = apiHandler(async (req, res) => {
  const action = String(req.query.action || 'meta');
  const write = req.method === 'POST';
  const user = await requireInventoryUser(req, write ? ['admin', 'operator'] : ['admin', 'operator', 'supply_chain', 'viewer']);
  const body = req.body || {};
  await ensureDesignSchema();
  const db = getInventoryPool();
  const tenant = user.tenantId;

  if (!write) {
    if (action === 'meta') return res.json({ data: await meta(db, tenant) });
    if (action === 'scenes') return res.json({ data: scenes.list().map(scene => ({ ...scene, ready: sceneReady(scene.file) })) });
    if (action === 'assets') return res.json({ data: await assets.list(db, tenant, req.query) });
    if (action === 'usage') return res.json({ data: await usage.summary(db, tenant, req.query.month) });
    if (action === 'assets-zip') {
      const packed = await assets.zipMany(db, tenant, {
        sku: req.query.sku || '',
        ids: String(req.query.ids || '').split(',').filter(Boolean)
      });
      const { zipStore } = require('../lib/design/zip');
      const buffer = zipStore(packed.entries);
      const label = req.query.sku ? `素材库-${String(req.query.sku).toUpperCase()}` : '素材库-选中图';
      return res.json({
        data: {
          filename: `${label}-${packed.entries.length}张.zip`,
          base64: buffer.toString('base64'),
          count: packed.entries.length,
          missing: packed.missing.length,
          bytes: buffer.length
        }
      });
    }
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

    let shot;
    try {
      // 自动降级：指定的模型挂了会顺次换一个，而不是让运营对着一张报错发呆
      shot = await provider.generateWithFallback({
        prompt: finalPrompt,
        negativePrompt: negative,
        imageSize: size.imageSize,
        model
      });
    } catch (error) {
      await usage.record(db, tenant, { kind: 'background', model, images: 0, cost: 0, ok: false, error: error.message });
      throw error;
    }

    const saved = store.save(shot.buffer, {
      prompt: finalPrompt,
      model: shot.model,
      scene: scene ? scene.id : 'custom',
      meta: { ratio, size: size.imageSize, category: body.category || '' }
    });
    const cost = provider.costOf(shot.model, 1);
    await usage.record(db, tenant, { kind: 'background', model: shot.model, images: 1, cost, ok: true, scene: scene ? scene.id : 'custom' });

    // 自动登记进素材库：背景是复用率最高的资产，不该只躺在磁盘目录里等人来存。
    // 入库失败不影响出图（比如型号还没填），所以单独 try。
    let assetId = '';
    if (saved) {
      try {
        const record = await assets.save(db, tenant, user, {
          url: saved.url,
          sku: body.sku || '',
          title: scene ? scene.name : 'AI 场景背景',
          purpose: 'background',
          model: shot.model,
          prompt: finalPrompt,
          scene: scene ? scene.id : 'custom',
          size: size.imageSize,
          cost,
          source: 'ai',
          status: 'draft'
        });
        assetId = record.asset.id;
      } catch {
        assetId = '';
      }
    }

    console.log(
      `[design] 生成背景 ${shot.model} ${size.imageSize} ${shot.bytes}B ${Date.now() - startedAt}ms 尝试${shot.attempts || 1}次 tenant=${tenant}`
    );

    return res.json({
      data: {
        url: saved ? saved.url : '',
        dataUrl: saved ? '' : store.toDataUrl(shot.buffer, shot.mime),
        model: shot.model,
        requestedModel: model,
        fallback: (shot.attempts || 1) > 1,
        sceneId: scene ? scene.id : '',
        ratio,
        size: size.imageSize,
        prompt: finalPrompt,
        negative,
        bytes: shot.bytes,
        cost,
        assetId,
        elapsedMs: Date.now() - startedAt,
        persisted: Boolean(saved)
      }
    });
  }

  if (action === 'matting') {
    if (!matting.configured()) {
      fail('没有配置 AI 抠图服务；本机抠图始终可用，不需要它也能出图', 503, 'MATTING_NOT_CONFIGURED');
    }
    const decoded = assets.decodeDataUrl(body.dataUrl, 20 * 1024 * 1024);
    const refined = await matting.refine({ buffer: decoded.buffer, mime: decoded.mime });
    await usage.record(db, tenant, { kind: 'matting', model: refined.engine, images: 1, cost: 0, ok: true });
    return res.json({
      data: {
        dataUrl: `data:image/png;base64,${refined.buffer.toString('base64')}`,
        engine: refined.engine,
        bytes: refined.bytes
      }
    });
  }

  if (action === 'asset-save') {
    const result = await assets.save(db, tenant, user, body);
    return res.json({ data: result });
  }

  if (action === 'asset-update') {
    const asset = await assets.update(db, tenant, uuid(body.id), body);
    return res.json({ data: { asset } });
  }

  if (action === 'asset-delete') {
    return res.json({ data: await assets.remove(db, tenant, uuid(body.id)) });
  }

  return res.status(404).json({ error: '未知操作' });
});
