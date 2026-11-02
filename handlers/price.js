// 比价助手（价格监控）接口。
// GET  /api/price/overview        今日概览（命中、缺失、采集状态、配置）
// POST /api/price/alert-action    忽略/恢复/标记已处理  ?action=ignore|restore|handle|recover&id=
// GET  /api/price/config          读阈值与采样时点
// POST /api/price/config          存阈值与采样时点
// 只读接口对 viewer 开放（客服也能看竞品价格），写操作限 admin/operator。

const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
const store = require('../lib/price/store');
const linkHelper = require('../lib/price/links');

const READ_ROLES = ['admin', 'operator', 'supply_chain', 'viewer'];
const WRITE_ROLES = ['admin', 'operator'];

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/* 批量挂链接：解析 → 查重 → 写库。
 * 只写「机型-链接」关系，**不读京东页面**（读标题要一条条请求，几十条必然吃频控，
 * 标题留给第一次采集补齐）。所以这里很快，可以一次贴 300 条。 */
async function importLinks(ctx, body) {
  const side = body.side === 'own' ? 'own' : 'competitor';
  const { items, invalid, dup } = linkHelper.parseText(body.urls || body.text || '');
  if (!items.length) {
    throw badRequest(invalid.length ? '没识别出京东商品链接，检查一下粘贴的内容' : '请先粘贴要导入的链接');
  }

  // 归属：要么选已有商品，要么新建（品牌 + 系列 + 匹数）
  let modelId = typeof body.modelId === 'string' && body.modelId ? body.modelId : '';
  let modelKey = '';
  if (modelId) {
    const m = await store.modelById(ctx.tenantId, modelId);
    if (!m) throw badRequest('选中的商品不存在（可能刚被删掉），刷新页面再试');
    modelKey = m.model_key;
  } else {
    const brand = linkHelper.brandOf(body.brand) || String(body.brand || '').trim().toLowerCase();
    const series = String(body.series || '').trim();
    const capacity = String(body.capacity || '').trim();
    if (!brand || !series) throw badRequest('新建商品要填品牌和系列名');
    modelKey = linkHelper.modelKeyOf({ brand, series, capacity });
    modelId = await store.upsertModel(ctx.tenantId, {
      modelKey,
      brand,
      series,
      capacity: capacity || null,
      name: linkHelper.modelNameOf({ brand, series, capacity }),
      priority: !!body.priority
    });
  }

  const existing = await store.linksByUrls(ctx.tenantId, items.map((i) => i.url));
  const { rows } = linkHelper.classify(items, existing);

  const created = [];
  const skipped = [];
  const moved = [];
  const failed = [];

  for (const row of rows) {
    if (row.state === 'exists') {
      const hit = existing.get(row.url);
      if (hit.model_id === modelId) {
        skipped.push({ sku: row.sku, reason: '已在本商品下' });
        continue;
      }
      // 已经在别的机型下：默认不挪。列错位把链接从 A 挪到 B 是踩过的坑，
      // 所以只有用户明确勾了「改挂过来」才动。
      if (!body.moveExisting) {
        failed.push({ sku: row.sku, reason: `已挂在「${row.modelKey || '其他商品'}」下，本次未移动` });
        continue;
      }
      await store.moveLink(ctx.tenantId, hit.id, modelId, side);
      moved.push({ sku: row.sku });
      continue;
    }

    try {
      await store.upsertLink(ctx.tenantId, modelId, {
        side,
        url: row.url,
        sku: row.sku,
        verifyState: 'confirmed'
      });
      created.push({ sku: row.sku, url: row.url });
    } catch (error) {
      failed.push({ sku: row.sku, reason: error.message || '写入失败' });
    }
  }

  return {
    modelId,
    modelKey,
    created: created.length,
    skipped: skipped.length,
    moved: moved.length,
    invalid: invalid.length,
    failed,
    dup,
    rows
  };
}

module.exports = apiHandler(async (req, res) => {
  const action = typeof req.query?.action === 'string' ? req.query.action : '';
  const url = req.url || '';

  // 定时采集触发：只允许本机服务进程（x-cron-local）或带密钥的外部调度器调用。
  // 不放在登录鉴权后面，因为定时任务没有用户令牌；用共享密钥代替。
  if (url.includes('/api/price/cron')) {
    const local = req.headers['x-cron-local'] === '1';
    const secret = process.env.CRON_SECRET;
    const authed = local || (!!secret && req.headers.authorization === `Bearer ${secret}`);
    if (!authed) return res.status(401).json({ error: '未授权的定时调用' });
    const scheduler = require('../lib/price/scheduler');
    return res.status(200).json({ success: true, data: await scheduler.tick() });
  }

  // 手动触发一轮采集（页面「立即采集」按钮）。跟定时任务不同，这里要用户权限。
  if (url.includes('/api/price/run-now')) {
    const ctx = await requireInventoryUser(req, WRITE_ROLES);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const scheduler = require('../lib/price/scheduler');
    return res.status(200).json({ success: true, data: await scheduler.runNow(ctx.tenantId) });
  }

  // 配置读写
  if (url.includes('/api/price/config')) {
    const ctx = await requireInventoryUser(req, req.method === 'GET' ? READ_ROLES : WRITE_ROLES);
    if (req.method === 'GET') {
      return res.status(200).json({ success: true, data: await store.readSettings(ctx.tenantId) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    return res.status(200).json({ success: true, data: await store.saveSettings(ctx.tenantId, req.body || {}, ctx.userId) });
  }

  // 链接清单 + 导入 / 停用 / 删除 / 改阵营
  if (url.includes('/api/price/links')) {
    const ctx = await requireInventoryUser(req, req.method === 'GET' ? READ_ROLES : WRITE_ROLES);
    if (req.method === 'GET') {
      return res.status(200).json({ success: true, data: await store.buildLinksView(ctx.tenantId) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    const op = String(body.op || 'import');

    if (op === 'import') {
      return res.status(200).json({ success: true, data: await importLinks(ctx, body) });
    }
    if (op === 'status' || op === 'side' || op === 'remove') {
      const id = typeof body.id === 'string' ? body.id : '';
      // 先挡掉格式不对的 id：直接丢给 Postgres 会抛 22P02，页面只能看到「服务器错误」
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw badRequest('链接 id 不合法，刷新页面再试');
      }
      let data;
      if (op === 'status') data = await store.setLinkStatus(ctx.tenantId, id, body.status);
      else if (op === 'side') data = await store.setLinkSide(ctx.tenantId, id, body.side);
      else data = await store.removeLink(ctx.tenantId, id);
      return res.status(200).json({ success: true, data: { ...data, view: await store.buildLinksView(ctx.tenantId) } });
    }
    throw badRequest('不支持的操作');
  }

  // 告警操作：忽略 / 取消忽略 / 已处理
  if (url.includes('/api/price/alert-action')) {
    const ctx = await requireInventoryUser(req, WRITE_ROLES);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const id = typeof req.query?.id === 'string' ? req.query.id : '';
    if (!id) {
      const err = new Error('缺少告警 id');
      err.status = 400;
      throw err;
    }
    return res.status(200).json({ success: true, data: await store.applyAlertAction(ctx.tenantId, id, action) });
  }

  // 概览
  const ctx = await requireInventoryUser(req, READ_ROLES);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return res.status(200).json({ success: true, data: await store.buildOverview(ctx.tenantId) });
});
