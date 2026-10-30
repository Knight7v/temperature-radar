'use strict';

// 产品知识库接口。
//
// 设计要点：
// 1. 导入是「预览 → 确认」两步：预览只算不写，主管看得到提取出来什么、哪几条待核实，再决定存。
// 2. 同型号再导入默认合并（参数以新的为准，卖点只增不删，人工改过的条目不覆盖），
//    因为详情页会更新，而人补的内容不该被机器冲掉。
// 3. 「关联会话」和「修正建议」都按需算：列表只要计数，建议一条一条生成并落库缓存，
//    不做全量批跑（会计费，也会在没看的时候白跑）。
// 4. 建议只用于改话术，不写质检分、不改复核结论——两套口径互不干扰。

const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
const { getInventoryPool, transact } = require('../lib/db/inventory-client');
const client = require('../lib/quality/ai/client');
const { GROUPS, GROUP_IDS, groupById, normalizeModel } = require('../lib/product/groups');
/* 列表排序（按累计销量）的唯一实现，顺带让「零销量排最后」这条规则能被测试盯住 */
const {
  SALES_ITEM_TABLE,
  buildListQuery,
  mapProductRow,
  mapSalesTotals,
  normalizeSort
} = require('../lib/product/list-query');
const {
  cleanSource,
  parseFallback,
  extractWithAi,
  verifyExtraction,
  normalizeForSave,
  mergeProduct,
  productFacts
} = require('../lib/product/extract');
const { matchSessions, matchProduct, withSessionText } = require('../lib/product/match');
const { adviseSession, VERSION: ADVICE_VERSION } = require('../lib/product/advice');
const { parseWorkbook } = require('../lib/product/gree-table');
const { SECTIONS: PARAM_SECTIONS, publicFields: publicParamFields } = require('../lib/product/fields');
const { ensureProductSchema } = require('../lib/product/schema');

const fail = (message, status = 422) => {
  throw Object.assign(Error(message), { status });
};

const uuid = value => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))) fail('ID 无效');
  return value;
};

const dateText = value => {
  const text = String(value || '').trim();
  if (text && !/^20\d{2}-\d{2}-\d{2}$/.test(text)) fail('日期格式无效');
  return text;
};

const needReviewCount = data =>
  [...(data.features || []), ...(data.params || [])].filter(item => item.needsReview).length;

function countsOf(data) {
  return {
    features: (data.features || []).length,
    params: (data.params || []).length,
    appearance: (data.appearance || []).length,
    service: (data.service || []).length,
    needsReview: needReviewCount(data)
  };
}

/* 销量口径：销售结构里那张「免扣款结算表」逐行是「店铺×日×物料编码×台数」，
   正好能和知识库靠物料编码对上。表是单独迁移建的，没跑过迁移的环境要能降级，不能把列表搞挂。
   排序规则本身在 lib/product/list-query.js，那边有测试盯着。 */
async function salesTableReady(db) {
  const row = (await db.query('SELECT to_regclass($1) AS t', [SALES_ITEM_TABLE])).rows[0];
  return Boolean(row && row.t);
}

/* 全库累计销量（按物料编码聚合）：不分店铺、不分月份，就是「这台机器一共卖了多少台」。
   口径写死在页面提示里，避免主管以为是当月数。 */
async function loadSalesTotals(db, tenant) {
  const row = (
    await db.query(
      `SELECT coalesce(sum(units),0)::bigint AS units, min(date) AS from_date, max(date) AS to_date,
              count(DISTINCT sku) AS skus, count(DISTINCT shop_id) AS shops
         FROM sales_structure_settlement_items WHERE tenant_id=$1`,
      [tenant]
    )
  ).rows[0];
  return mapSalesTotals(row);
}

async function loadProducts(db, tenant, { group = '', q = '', sort = 'sales' } = {}) {
  const hasSales = await salesTableReady(db);
  const { sql, args } = buildListQuery({
    tenant,
    group: group && GROUP_IDS.has(group) ? group : '',
    q,
    sort,
    hasSales
  });
  const rows = (await db.query(sql, args)).rows;
  return rows.map(row => ({ ...mapProductRow(row), counts: countsOf(row.data || {}) }));
}

async function findExisting(db, tenant, group, model) {
  if (!model) return null;
  const row = (
    await db.query(
      `SELECT id,data FROM product_knowledge
        WHERE tenant_id=$1 AND data->>'group'=$2
          AND upper(regexp_replace(coalesce(data->>'model',''), '\\s+', '', 'g'))=upper($3)
        LIMIT 1`,
      [tenant, group, normalizeModel(model)]
    )
  ).rows[0];
  return row ? { id: row.id, data: row.data || {} } : null;
}

async function loadSessions(db, tenant, { date = '', limit = 600 } = {}) {
  const args = [tenant];
  let where = '';
  if (date) {
    args.push(date);
    where += ` AND left(started_at,10)=$${args.length}`;
  }
  args.push(Math.max(20, Math.min(1200, Number(limit) || 600)));
  const rows = (
    await db.query(
      `SELECT id,agent,started_at,ordinal,data FROM quality_sessions
        WHERE tenant_id=$1${where}
        ORDER BY started_at DESC, ordinal DESC
        LIMIT $${args.length}`,
      args
    )
  ).rows;
  return rows.map(row => ({
    id: row.id,
    agent: row.agent || '',
    startedAt: row.started_at || '',
    ordinal: row.ordinal,
    customerId: (row.data || {}).customerId || '',
    messages: (row.data || {}).messages || []
  }));
}

async function loadSession(db, tenant, sessionId) {
  const row = (
    await db.query('SELECT id,agent,started_at,ordinal,data FROM quality_sessions WHERE tenant_id=$1 AND id=$2', [
      tenant,
      sessionId
    ])
  ).rows[0];
  if (!row) fail('会话不存在', 404);
  return {
    id: row.id,
    agent: row.agent || '',
    startedAt: row.started_at || '',
    ordinal: row.ordinal,
    customerId: (row.data || {}).customerId || '',
    messages: (row.data || {}).messages || []
  };
}

async function loadProduct(db, tenant, id) {
  const row = (await db.query('SELECT id,data FROM product_knowledge WHERE tenant_id=$1 AND id=$2', [tenant, id])).rows[0];
  if (!row) fail('这个型号不存在，可能已被删除', 404);
  return { id: row.id, data: row.data || {} };
}

async function adviceCounts(db, tenant) {
  const rows = (
    await db.query(
      `SELECT product_id, count(*)::int AS n,
              count(*) FILTER (WHERE (data->'stats'->>'needFix')::int > 0)::int AS need_fix
         FROM product_advice WHERE tenant_id=$1 GROUP BY product_id`,
      [tenant]
    )
  ).rows;
  const map = new Map(rows.map(row => [row.product_id, { total: row.n, needFix: row.need_fix }]));
  return map;
}

function summarizeProducts(products, adviceMap) {
  const byGroup = {};
  for (const group of GROUPS) byGroup[group.id] = { products: 0, features: 0, params: 0 };
  let features = 0;
  let params = 0;
  let service = 0;
  let needsReview = 0;
  for (const item of products) {
    const data = item.data || {};
    const bucket = byGroup[data.group] || (byGroup[data.group] = { products: 0, features: 0, params: 0 });
    bucket.products += 1;
    bucket.features += item.counts.features;
    bucket.params += item.counts.params;
    features += item.counts.features;
    params += item.counts.params;
    service += item.counts.service;
    needsReview += item.counts.needsReview;
  }
  let adviceTotal = 0;
  let adviceNeedFix = 0;
  for (const item of products) {
    const stat = adviceMap.get(item.id);
    if (!stat) continue;
    adviceTotal += stat.total;
    adviceNeedFix += stat.needFix;
  }
  return { byGroup, products: products.length, features, params, service, needsReview, adviceTotal, adviceNeedFix };
}

const csvCell = value => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';

module.exports = apiHandler(async (req, res) => {
  const write = req.method === 'POST';
  const user = await requireInventoryUser(req, write ? ['admin', 'operator'] : ['admin', 'operator', 'viewer']);
  await ensureProductSchema();
  const db = getInventoryPool();
  const tenant = user.tenantId;
  const action = String(req.query.action || 'list');
  const body = req.body || {};
  const aiConfigured = client.configured();

  if (!write) {
    if (action === 'meta') {
      return res.json({
        data: {
          groups: GROUPS.map(group => ({ id: group.id, label: group.label, brand: group.brand, category: group.category, example: group.example, hint: group.hint })),
          ai: { configured: aiConfigured, model: client.config().model },
          /* 参数标准字段表：前端靠它把任何型号铺成同一套格子，缺的落「待补充」。
             跟着 meta 一起下，省一次请求；改字段只改 lib/product/fields.js 一处。 */
          paramFields: { sections: PARAM_SECTIONS, fields: publicParamFields() },
          adviceVersion: ADVICE_VERSION,
          role: user.role
        }
      });
    }

    if (action === 'list') {
      const group = String(req.query.group || '');
      const q = String(req.query.q || '').trim();
      const scan = String(req.query.scan || '') === '1';
      const date = dateText(req.query.date);
      const sort = normalizeSort(req.query.sort);
      const products = await loadProducts(db, tenant, { group, q, sort });
      /* 销量口径写进返回值，页面直接照抄，不用前端自己猜数字从哪来 */
      const sales = (await salesTableReady(db)) ? await loadSalesTotals(db, tenant) : null;
      const adviceMap = await adviceCounts(db, tenant);
      let links = null;
      if (scan && products.length) {
        const sessions = withSessionText(await loadSessions(db, tenant, { date, limit: 600 }));
        /* 匹配函数吃的是「产品数据本身」，不是带 id 的外层包装 */
        const flat = products.map(item => ({ id: item.id, ...item.data }));
        const matched = matchSessions(sessions, flat, { minScore: 4, limit: 4000 });
        const counts = new Map();
        for (const row of matched) counts.set(row.productId, (counts.get(row.productId) || 0) + 1);
        links = { scanned: sessions.length, matched: matched.length, byProduct: Object.fromEntries(counts) };
      }
      return res.json({ data: { products, summary: summarizeProducts(products, adviceMap), links, advice: Object.fromEntries(adviceMap), sales, sort } });
    }

    if (action === 'session') {
      const sessionId = uuid(req.query.id);
      const session = await loadSession(db, tenant, sessionId);
      return res.json({ data: session });
    }

    /* 机型性能PK：按 ids 提取对比字段 + 第一张商品主图（一次拿齐，页面不用自己拼参数） */
    if (action === 'pk-fields') {
      const rawIds = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
      const ids = rawIds.map(uuid);
      const { ensureProductImagesSchema } = require('../lib/product/images');
      const { matchKey } = require('../lib/product/gree-master');
      const { extractPkFields, machineType } = require('../lib/product/pk-fields');
      await ensureProductImagesSchema();
      const models = [];
      for (const id of ids) {
        let product;
        try {
          product = await loadProduct(db, tenant, id);
        } catch (error) {
          continue; /* 已被同事删掉的型号直接跳过，不让整张图出不来 */
        }
        const key = matchKey(product.data.model);
        let mainImage = null;
        if (key) {
          const row = (
            await db.query(
              `SELECT mime,data FROM product_images
                WHERE tenant_id=$1 AND product_key=$2 AND kind='main'
                ORDER BY idx LIMIT 1`,
              [tenant, key]
            )
          ).rows[0];
          if (row) mainImage = `data:${row.mime};base64,${row.data}`;
        }
        models.push({
          id: product.id,
          series: product.data.series || product.data.name || '',
          model: product.data.model || '',
          tier: product.data.tier || '',
          distribution: product.data.distribution || '',
          machineType: machineType(product.data),
          fields: extractPkFields(product.data),
          mainImage
        });
      }
      /* 挂机跟挂机比、柜机跟柜机比：混着来直接拒绝，宁可报错也不出误导顾客的图 */
      const typeOf = m => m.machineType || '未知';
      const typeSet = [...new Set(models.map(typeOf))];
      if (typeSet.length > 1) {
        return res.status(400).json({ error: '挂机与柜机不能混着对比（当前含：' + typeSet.join('、') + '），请只选同一类机型。' });
      }
      if (typeSet[0] === '未知') {
        return res.status(400).json({ error: '选中的机型识别不出挂机/柜机类型，暂不支持对比，请换其他机型。' });
      }
      return res.json({ data: { models } });
    }

    /* 某个型号的详情图片（详情抽屉打开时按需拉取，列表接口不带图） */
    if (action === 'images') {
      const { ensureProductImagesSchema } = require('../lib/product/images');
      const { matchKey } = require('../lib/product/gree-master');
      await ensureProductImagesSchema();
      const product = await loadProduct(db, tenant, uuid(req.query.id));
      const key = matchKey(product.data.model);
      if (!key) return res.json({ data: { main: [], detail: [] } });
      const rows = (
        await db.query(
          `SELECT master_code,kind,idx,name,mime,bytes,data FROM product_images
            WHERE tenant_id=$1 AND product_key=$2
            ORDER BY master_code, idx`,
          [tenant, key]
        )
      ).rows;
      const shape = list => ({
        count: list.length,
        items: list.map(row => ({ name: row.name, masterCode: row.master_code, mime: row.mime, bytes: row.bytes, dataUrl: `data:${row.mime};base64,${row.data}` }))
      });
      return res.json({
        data: {
          main: shape(rows.filter(row => row.kind === 'main')),
          detail: shape(rows.filter(row => row.kind === 'detail'))
        }
      });
    }

    if (action === 'advice-list') {
      const productId = uuid(req.query.productId);
      const rows = (
        await db.query(
          `SELECT a.data,a.updated_at,a.session_id,s.agent,s.started_at,s.ordinal
             FROM product_advice a
             JOIN quality_sessions s ON s.tenant_id=a.tenant_id AND s.id=a.session_id
            WHERE a.tenant_id=$1 AND a.product_id=$2
            ORDER BY a.updated_at DESC
            LIMIT 120`,
          [tenant, productId]
        )
      ).rows;
      const rowsMapped = rows.map(row => ({
        sessionId: row.session_id,
        agent: row.agent || '',
        startedAt: row.started_at || '',
        ordinal: row.ordinal,
        updatedAt: row.updated_at,
        data: row.data || {}
      }));
      const missing = new Map();
      for (const row of rowsMapped) {
        for (const item of row.data.items || []) {
          if (item.verdict === 'covered') continue;
          const key = item.factRef;
          const entry = missing.get(key) || { factRef: key, kind: item.factKind, count: 0, sample: item.suggestedReply };
          entry.count += 1;
          if (!entry.sample && item.suggestedReply) entry.sample = item.suggestedReply;
          missing.set(key, entry);
        }
      }
      return res.json({
        data: {
          rows: rowsMapped,
          topMissing: [...missing.values()].sort((a, b) => b.count - a.count).slice(0, 10)
        }
      });
    }

    if (action === 'export') {
      const products = await loadProducts(db, tenant, { group: String(req.query.group || ''), q: String(req.query.q || '') });
      const head = ['分组', '型号', '名称', '累计销量(台)', '卖点数', '参数数', '售后口径', '待核实', '最近更新'];
      const lines = [head];
      for (const item of products) {
        const data = item.data || {};
        const group = groupById(data.group);
        lines.push([
          group ? group.label : data.group,
          data.model,
          data.name,
          item.units == null ? '' : item.units,
          item.counts.features,
          item.counts.params,
          item.counts.service,
          item.counts.needsReview,
          String(item.updatedAt || '').slice(0, 19).replace('T', ' ')
        ]);
      }
      const csv = '\ufeff' + lines.map(line => line.map(csvCell).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="product-knowledge.csv"');
      return res.end(csv);
    }

    fail('操作不存在', 404);
  }

  /* 表格批量导入 · 第一步：解析不落库。
     格力《产品参数一览表》是一列一个系列的横向矩阵，parseWorkbook 负责转置成一型号一条，
     主管看到「转出多少个型号、哪些已在库里、哪几列跳过了」再决定要不要入库。 */
  if (action === 'table-preview') {
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || buffer.length < 200) fail('没收到文件内容，请重新选择 xlsx 文件');
    if (buffer.slice(0, 2).toString('binary') !== 'PK') fail('这不是 xlsx 文件。请在 Excel 里「另存为 .xlsx」再上传（老的 .xls 不支持）');
    if (buffer.length > 30 * 1024 * 1024) fail('文件超过 30MB。表格里 20 多 MB 全是嵌入图片，先把图片列删掉再另存，参数文字只有几百 KB');

    const group = String(req.query.group || 'gree-ac');
    if (!GROUP_IDS.has(group)) fail('请先选择产品分组');

    let filename = String(req.headers['x-filename'] || '');
    try {
      filename = decodeURIComponent(filename);
    } catch {
      filename = String(req.headers['x-filename'] || '');
    }
    filename = filename.slice(0, 120) || '产品参数表.xlsx';

    let parsed;
    try {
      parsed = await parseWorkbook(buffer, { group });
    } catch (error) {
      fail(`这个文件读不了：${error.message || '格式不对'}`);
    }
    if (!parsed.products.length) {
      fail(`没转出任何型号。${(parsed.warnings || [])[0] || '请确认上传的是「格力产品参数一览表」'}`);
    }

    /* 顺手告诉主管哪些已经在库里了，避免重复导一遍 */
    const keys = parsed.products.map(item => normalizeModel(item.model));
    const existing = new Set(
      (
        await db.query(
          `SELECT upper(regexp_replace(coalesce(data->>'model',''), '\\s+', '', 'g')) AS key
             FROM product_knowledge
            WHERE tenant_id=$1 AND data->>'group'=$2
              AND upper(regexp_replace(coalesce(data->>'model',''), '\\s+', '', 'g')) = ANY($3)`,
          [tenant, group, keys]
        )
      ).rows.map(row => row.key)
    );

    const products = parsed.products.map(item => ({
      ...item,
      existing: existing.has(normalizeModel(item.model)),
      source: { ...item.source, name: filename, importedAt: new Date().toISOString() }
    }));

    return res.json({
      data: {
        products,
        warnings: parsed.warnings,
        skipped: parsed.skipped,
        stats: {
          ...parsed.stats,
          existing: products.filter(item => item.existing).length,
          bytes: buffer.length,
          filename
        }
      }
    });
  }

  /* 表格批量导入 · 第二步：把核对过的记录一次性入库。同型号走合并，不覆盖人工改过的条目。 */
  if (action === 'table-save') {
    const list = Array.isArray(body.products) ? body.products : [];
    if (!list.length) fail('没有要保存的型号');
    if (list.length > 400) fail('一次最多保存 400 个型号，请拆分后再导');

    return res.json({
      data: await transact(db, async c => {
        let created = 0;
        let mergedCount = 0;
        const failed = [];
        for (const raw of list) {
          try {
            const incoming = normalizeForSave(raw);
            if (!GROUP_IDS.has(incoming.group)) {
              failed.push({ model: raw?.model || '', reason: '分组无效' });
              continue;
            }
            if (!incoming.model) {
              failed.push({ model: '', reason: '型号为空' });
              continue;
            }
            const hit = await findExisting(c, tenant, incoming.group, incoming.model);
            if (hit) {
              const result = mergeProduct(hit.data, incoming);
              await c.query('UPDATE product_knowledge SET data=$1,revision=revision+1,updated_at=now() WHERE tenant_id=$2 AND id=$3', [
                result.data,
                tenant,
                hit.id
              ]);
              mergedCount += 1;
              continue;
            }
            await c.query('INSERT INTO product_knowledge(tenant_id,data,created_by) VALUES($1,$2,$3)', [
              tenant,
              incoming,
              user.userId
            ]);
            created += 1;
          } catch (error) {
            failed.push({ model: raw?.model || '', reason: error.message || '写入失败' });
          }
        }
        return { created, merged: mergedCount, failed, total: list.length };
      })
    });
  }

  /* 详情图压缩包导入：格力系统导出，文件名「主数据编码(序号).jpg」。
     头图 → 商品主图，详情图 → 商品详情；按主数据编码挂到对应型号上。
     编码→型号的映射在 product_knowledge.data.masterCode（主数据导入/回填脚本负责）。 */
  if (action === 'images-import') {
    const { ensureProductImagesSchema, parseImageZip } = require('../lib/product/images');
    await ensureProductImagesSchema();
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || !buffer.length) fail('请上传 zip 压缩包');
    const kind = req.query.kind === 'main' ? 'main' : req.query.kind === 'detail' ? 'detail' : '';
    if (!kind) fail('请指明图片类型：main=详情头图（商品主图）/ detail=详情图（商品详情）');
    const { items, skipped } = await parseImageZip(buffer);

    const codes = [...new Set(items.map(item => item.masterCode))];
    const hitRows = (
      await db.query(
        `SELECT id, data FROM product_knowledge WHERE tenant_id=$1 AND data->>'masterCode' = ANY($2)`,
        [tenant, codes]
      )
    ).rows;
    const byCode = new Map(hitRows.map(row => [String(row.data.masterCode).toUpperCase(), row]));

    return res.json({
      data: await transact(db, async c => {
        const touched = new Set();
        let images = 0;
        const models = new Map();
        for (const item of items) {
          const hit = byCode.get(item.masterCode);
          if (!hit) continue;
          const key = String(hit.data.model || '').toUpperCase().replace(/\s+/g, '');
          if (!key) continue;
          await c.query(
            `INSERT INTO product_images(tenant_id,product_key,master_code,kind,idx,name,mime,bytes,data)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (tenant_id,product_key,master_code,kind,idx)
             DO UPDATE SET name=EXCLUDED.name,mime=EXCLUDED.mime,bytes=EXCLUDED.bytes,data=EXCLUDED.data,created_at=now()`,
            [tenant, key, item.masterCode, kind, item.idx, item.name, item.mime, item.bytes, item.data]
          );
          images += 1;
          const bucket = models.get(hit.data.model) || { main: 0, detail: 0 };
          bucket[kind] += 1;
          models.set(hit.data.model, bucket);
        }
        const unmatched = codes.filter(code => !byCode.has(code));
        return {
          images,
          models: [...models.entries()].map(([model, counts]) => ({ model, ...counts })),
          unmatchedCodes: unmatched,
          skipped
        };
      })
    });
  }

  /* 详情页预览：只提取不落库。AI 优先，失败自动退回规则解析，并把原因说清楚。 */
  if (action === 'preview') {
    const group = String(body.group || '');
    if (!GROUP_IDS.has(group)) fail('请先选择产品分组');
    const raw = String(body.text || '');
    if (raw.trim().length < 20) fail('内容太短，把详情页正文（或整页复制）粘贴进来，至少 20 个字');
    const cleaned = cleanSource(raw);
    if (cleaned.text.length < 20) fail('这段内容里没有可读的文字，可能是纯图片详情页。请用「复制文字」后再粘贴，或手动新建型号。');

    const warnings = [];
    let product = null;
    let aiUsed = false;
    let usage = null;
    if (aiConfigured) {
      try {
        const result = await extractWithAi({ source: cleaned.text, groupId: group });
        const verified = verifyExtraction(result.raw, { source: cleaned.text, groupId: group });
        product = verified.product;
        warnings.push(...verified.warnings);
        aiUsed = true;
        usage = result.usage;
      } catch (error) {
        warnings.push(`AI 提取失败（${error.message}），已用规则解析兜底`);
      }
    } else {
      warnings.push('未配置 DeepSeek API Key，本次用规则解析提取：型号、参数、外观能抓，卖点只认关键词行');
    }
    if (!product) {
      product = parseFallback(cleaned.text, group);
    }
    product = normalizeForSave({ ...product, source: { ...product.source, type: 'text', name: String(body.filename || '').slice(0, 120), chars: cleaned.chars, aiUsed } });

    if (cleaned.truncated) warnings.push(`原文 ${cleaned.fullChars} 字，超过单次上限，只解析了前 ${cleaned.chars} 字`);
    if (!product.model) warnings.push('没识别到型号，请手动填写（型号是同一台机器的唯一标识，不填无法保存）');

    const existing = product.model ? await findExisting(db, tenant, group, product.model) : null;
    return res.json({
      data: {
        product,
        warnings,
        aiUsed,
        usage,
        source: { chars: cleaned.chars, fullChars: cleaned.fullChars, truncated: cleaned.truncated, isHtml: cleaned.isHtml },
        existing: existing ? { id: existing.id, model: existing.data.model, name: existing.data.name, counts: countsOf(existing.data) } : null
      }
    });
  }

  if (action === 'save') {
    const incoming = normalizeForSave(body.product || {});
    if (!GROUP_IDS.has(incoming.group)) fail('请选择产品分组');
    if (!incoming.model) fail('型号不能为空');
    const id = body.id ? uuid(body.id) : null;

    return res.json({
      data: await transact(db, async c => {
        if (id) {
          const current = (
            await c.query('SELECT id,data FROM product_knowledge WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, id])
          ).rows[0];
          if (!current) fail('这个型号不存在，可能已被删除', 404);
          const merged = body.merge === false ? { data: incoming, added: {}, counts: countsOf(incoming) } : mergeProduct(current.data, incoming);
          await c.query('UPDATE product_knowledge SET data=$1,revision=revision+1,updated_at=now() WHERE tenant_id=$2 AND id=$3', [
            merged.data,
            tenant,
            id
          ]);
          return { id, created: false, merged: body.merge !== false, added: merged.added, counts: merged.counts };
        }

        const existing = await findExisting(c, tenant, incoming.group, incoming.model);
        if (existing) {
          if (body.merge === false) {
            fail(`这个型号已经在库里（${existing.data.name || existing.data.model}），要覆盖请打开它再保存`, 409);
          }
          const merged = mergeProduct(existing.data, incoming);
          await c.query('UPDATE product_knowledge SET data=$1,revision=revision+1,updated_at=now() WHERE tenant_id=$2 AND id=$3', [
            merged.data,
            tenant,
            existing.id
          ]);
          return { id: existing.id, created: false, merged: true, added: merged.added, counts: merged.counts };
        }

        const inserted = await c.query(
          'INSERT INTO product_knowledge(tenant_id,data,created_by) VALUES($1,$2,$3) RETURNING id,revision',
          [tenant, incoming, user.userId]
        );
        return { id: inserted.rows[0].id, created: true, merged: false, added: {}, counts: countsOf(incoming) };
      })
    });
  }

  if (action === 'delete') {
    const id = uuid(body.id);
    const row = (await db.query('SELECT data FROM product_knowledge WHERE tenant_id=$1 AND id=$2', [tenant, id])).rows[0];
    if (!row) fail('这个型号不存在', 404);
    await db.query('DELETE FROM product_knowledge WHERE tenant_id=$1 AND id=$2', [tenant, id]);
    return res.json({ data: { deleted: true, model: (row.data || {}).model || '' } });
  }

  /* 关联会话：拿这个型号去最近的会话里找「提到它」的对话 */
  if (action === 'match') {
    const productId = uuid(body.productId);
    const product = await loadProduct(db, tenant, productId);
    const date = dateText(body.date);
    const sessions = withSessionText(await loadSessions(db, tenant, { date, limit: body.limit || 600 }));
    const matched = matchProduct(sessions, { id: product.id, ...product.data }, { minScore: 4, limit: 200 });
    return res.json({
      data: {
        product: { id: product.id, model: product.data.model, name: product.data.name },
        sessions: matched,
        stats: {
          scanned: sessions.length,
          matched: matched.length,
          modelHits: matched.filter(item => item.modelHit).length,
          date: date || 'all',
          facts: productFacts(product.data).length
        }
      }
    });
  }

  /* 单条建议：同一「会话 × 型号」有缓存就直接给，force=true 才重算（重算要花钱） */
  if (action === 'advise') {
    const sessionId = uuid(body.sessionId);
    const productId = uuid(body.productId);
    const force = body.force === true;
    if (!force) {
      const cached = (
        await db.query(
          'SELECT data,updated_at FROM product_advice WHERE tenant_id=$1 AND session_id=$2 AND product_id=$3',
          [tenant, sessionId, productId]
        )
      ).rows[0];
      if (cached && (cached.data || {}).version === ADVICE_VERSION) {
        return res.json({ data: { advice: cached.data, cached: true, updatedAt: cached.updated_at } });
      }
    }

    const [session, product] = await Promise.all([
      loadSession(db, tenant, sessionId),
      loadProduct(db, tenant, productId)
    ]);
    const advice = await adviseSession({ session, product: { id: product.id, ...product.data } });
    await db.query(
      `INSERT INTO product_advice(tenant_id,session_id,product_id,version,data,usage,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id,session_id,product_id) DO UPDATE SET
         version=EXCLUDED.version,data=EXCLUDED.data,usage=EXCLUDED.usage,updated_at=now()`,
      [tenant, sessionId, productId, ADVICE_VERSION, JSON.stringify(advice), JSON.stringify(advice.usage || {}), user.userId]
    );
    return res.json({
      data: {
        advice,
        cached: false,
        session: { id: session.id, agent: session.agent, startedAt: session.startedAt, ordinal: session.ordinal }
      }
    });
  }

  fail('操作不存在', 404);
});
