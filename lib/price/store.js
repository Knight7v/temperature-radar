'use strict';
/* 价格监控 —— 数据访问层。
 * 只做四件事：读配置、把库里的机型/链接/快照拼成判价入参、把判价结果写回告警、给页面出概览。
 * 判价规则不在这个文件里（见 evaluate.js），页面字段怎么拼也不在这里（见 view.js）。 */

const { getInventoryPool } = require('../db/inventory-client');
const { ensurePriceSchema } = require('./schema');
const { evaluateAll, decideAlert } = require('./evaluate');
const view = require('./view');

async function pool() {
  await ensurePriceSchema();
  return getInventoryPool();
}

/* 上海时区的「今天」，写成 YYYY-MM-DD。captured_on 与它对齐，避免 23:30 采集被算到第二天 */
function todayInShanghai(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/* ---------------- 配置 ---------------- */

async function readSettings(tenantId) {
  const db = await pool();
  await db.query('INSERT INTO price_settings(tenant_id) VALUES($1) ON CONFLICT (tenant_id) DO NOTHING', [tenantId]);
  const row = (await db.query('SELECT * FROM price_settings WHERE tenant_id=$1', [tenantId])).rows[0];
  return {
    amount: Number(row.amount_threshold),
    rate: Number(row.rate_threshold),
    full: row.full_time,
    focus: row.focus_time,
    notify: row.notify_mode,
    newUser: row.new_user_mode,
    subsidyRate: Number(row.subsidy_rate), // 0.15 = 15%
    subsidyCap: Number(row.subsidy_cap) // 抵扣上限（元）
  };
}

async function saveSettings(tenantId, patch, userId) {
  const db = await pool();
  await readSettings(tenantId);
  const sets = [];
  const vals = [tenantId];
  const put = (col, value) => {
    vals.push(value);
    sets.push(`${col}=$${vals.length}`);
  };
  if (patch.amount != null && Number.isFinite(Number(patch.amount))) put('amount_threshold', Number(patch.amount));
  if (patch.rate != null && Number.isFinite(Number(patch.rate))) put('rate_threshold', Number(patch.rate));
  if (typeof patch.full === 'string' && patch.full) put('full_time', patch.full);
  if (typeof patch.focus === 'string' && patch.focus) put('focus_time', patch.focus);
  // 原来这里写的是 patch.notify === 'string'（少了 typeof），恒为 false，通知模式一直存不进去
  if (typeof patch.notify === 'string' && patch.notify) put('notify_mode', patch.notify);
  if (typeof patch.newUser === 'string' && patch.newUser) put('new_user_mode', patch.newUser);
  // 国补按比例存（前端填 15，这里存 0.15），上限按元存
  if (patch.subsidyRate != null && Number.isFinite(Number(patch.subsidyRate))) {
    const r = Number(patch.subsidyRate);
    put('subsidy_rate', r > 1 ? r / 100 : r);
  }
  if (patch.subsidyCap != null && Number.isFinite(Number(patch.subsidyCap))) put('subsidy_cap', Number(patch.subsidyCap));
  if (!sets.length) return readSettings(tenantId);
  vals.push(userId || null);
  sets.push(`updated_by=$${vals.length}`);
  await db.query(`UPDATE price_settings SET ${sets.join(', ')}, updated_at=now() WHERE tenant_id=$1`, vals);
  return readSettings(tenantId);
}

/* ---------------- 机型与链接 ---------------- */

async function listModels(tenantId) {
  const db = await pool();
  const rows = (
    await db.query(
      `SELECT m.id, m.model_key, m.brand, m.series, m.code, m.capacity, m.name, m.priority, m.status,
              l.id AS link_id, l.side, l.url, l.shop_id, l.shop_name, l.title,
              l.status AS link_status, l.priority AS link_priority
         FROM price_models m
         LEFT JOIN price_links l
                ON l.tenant_id = m.tenant_id AND l.model_id = m.id
        WHERE m.tenant_id = $1 AND m.status = 'active'
        ORDER BY m.brand, m.series NULLS LAST, m.id, l.side, l.shop_name`,
      [tenantId]
    )
  ).rows;

  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, {
        id: r.id,
        modelKey: r.model_key,
        brand: r.brand,
        series: r.series,
        code: r.code,
        capacity: r.capacity,
        name: r.name,
        priority: r.priority,
        links: []
      });
    }
    if (r.link_id) {
      byId.get(r.id).links.push({
        id: r.link_id,
        side: r.side,
        url: r.url,
        shopId: r.shop_id,
        shopName: r.shop_name,
        title: r.title,
        status: r.link_status,
        priority: r.link_priority
      });
    }
  }
  return [...byId.values()];
}

/* 某天的最后一条快照（同一天重跑只认最后一次） */
async function observationsOfDay(tenantId, day) {
  const db = await pool();
  const rows = (
    await db.query(
      `SELECT DISTINCT ON (link_id) link_id, status,
              listed_price, promo_amount, after_promo_price, subsidy_amount, subsidy_rate,
              landed_price, promo_text, promo_expire_at, subsidy_flag, landed_confidence,
              reason, captured_at
         FROM price_observations
        WHERE tenant_id = $1 AND captured_on = $2
        ORDER BY link_id, captured_at DESC`,
      [tenantId, day]
    )
  ).rows;
  return new Map(rows.map((r) => [r.link_id, r]));
}

/* 每条链接最近一次成功快照：只用于「上次采到是多少」，绝不参与判价 */
async function lastOkByLink(tenantId) {
  const db = await pool();
  const rows = (
    await db.query(
      `SELECT DISTINCT ON (link_id) link_id, listed_price, landed_price, captured_at
         FROM price_observations
        WHERE tenant_id = $1 AND status = 'ok'
        ORDER BY link_id, captured_at DESC`,
      [tenantId]
    )
  ).rows;
  return new Map(rows.map((r) => [r.link_id, r]));
}

async function activeAlerts(tenantId) {
  const db = await pool();
  const rows = (
    await db.query(
      `SELECT DISTINCT ON (model_id) *
         FROM price_alerts
        WHERE tenant_id = $1
          AND (status <> 'recovered' OR resolved_at >= now() - interval '3 days')
        ORDER BY model_id, first_seen_at DESC`,
      [tenantId]
    )
  ).rows;
  return new Map(
    rows.map((r) => [
      r.model_id,
      {
        id: r.id,
        status: r.status,
        ownPrice: r.own_price,
        competitorPrice: r.competitor_price,
        gap: r.gap,
        gapRate: r.gap_rate,
        competitorShop: r.competitor_shop,
        otherLower: r.other_lower,
        confidence: r.confidence,
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at
      }
    ])
  );
}

/* 近 N 天走势：按「机型 + 日期 + 我方/竞品」取当天最低到手价，再拼成两条线。
 * 只保留两边都有数据的日子——宁可点少几个，也不画一条用旧价补出来的假线。 */
async function trends(tenantId, days = 14) {
  const db = await pool();
  const rows = (
    await db.query(
      `SELECT l.model_id, l.side, o.captured_on, MIN(o.landed_price) AS price
         FROM price_observations o
         JOIN price_links l ON l.tenant_id = o.tenant_id AND l.id = o.link_id
        WHERE o.tenant_id = $1
          AND o.status = 'ok'
          AND o.captured_on >= (CURRENT_DATE - ($2::int - 1))
          AND o.landed_price IS NOT NULL
        GROUP BY l.model_id, l.side, o.captured_on
        ORDER BY o.captured_on`,
      [tenantId, days]
    )
  ).rows;

  const byModel = new Map();
  for (const r of rows) {
    if (!byModel.has(r.model_id)) byModel.set(r.model_id, { own: new Map(), comp: new Map() });
    const bucket = byModel.get(r.model_id);
    const key = r.captured_on instanceof Date ? r.captured_on.toISOString().slice(0, 10) : String(r.captured_on);
    (r.side === 'own' ? bucket.own : bucket.comp).set(key, Number(r.price));
  }

  const out = new Map();
  for (const [modelId, bucket] of byModel) {
    const labels = [...bucket.own.keys()].filter((d) => bucket.comp.has(d)).sort();
    out.set(modelId, {
      labels: labels.map((d) => view.fmtDay(d)),
      my: labels.map((d) => bucket.own.get(d)),
      comp: labels.map((d) => bucket.comp.get(d))
    });
  }
  return out;
}

async function lastRun(tenantId) {
  const db = await pool();
  return (await db.query('SELECT * FROM price_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 1', [tenantId])).rows[0] || null;
}

/* 判断「能不能发」必须和 wecom.resolveWebhook 的判断一致，否则页面显示「未配置」
   而实际能发（或反过来），运营会去瞎配。
   2026-11-02 就是这个坑：环境变量里有机器人，页面却写「未配置」。 */
async function webhookConfigured(tenantId) {
  const keys = ['PRICE_WECOM_WEBHOOK', 'DAILY_REPORT_WEBHOOK', 'WECOM_BOT_WEBHOOK'];
  if (keys.some((k) => String(process.env[k] || '').trim())) return true;
  try {
    const db = await pool();
    const r = await db.query('SELECT 1 FROM inventory_push_config WHERE tenant_id=$1', [tenantId]);
    return r.rowCount > 0;
  } catch {
    return false;
  }
}

/* ---------------- 链接清单（「查看链接」页） ----------------
 * 和 listModels 的区别：那边只取 active 机型、只服务判价；
 * 这边要把「已经挂了但还没采过的」「已停用的」也列出来，否则用户看不到自己导进去的东西。 */

async function listAllLinks(tenantId) {
  const db = await pool();
  const rows = (
    await db.query(
      `WITH last_any AS (
         SELECT DISTINCT ON (link_id) link_id, status, reason, captured_at
           FROM price_observations
          WHERE tenant_id = $1
          ORDER BY link_id, captured_at DESC
       ), last_ok AS (
         SELECT DISTINCT ON (link_id) link_id, landed_price, listed_price, captured_at
           FROM price_observations
          WHERE tenant_id = $1 AND status = 'ok'
          ORDER BY link_id, captured_at DESC
       )
       SELECT m.id AS model_id, m.model_key, m.brand, m.series, m.code, m.capacity, m.name,
              m.priority, m.status AS model_status,
              l.id AS link_id, l.side, l.url, l.jd_sku, l.shop_name, l.title,
              l.status AS link_status, l.verify_state,
              a.status AS last_status, a.reason AS last_reason, a.captured_at AS last_at,
              k.landed_price AS ok_landed, k.listed_price AS ok_listed, k.captured_at AS ok_at
         FROM price_models m
         JOIN price_links l
           ON l.tenant_id = m.tenant_id AND l.model_id = m.id
         LEFT JOIN last_any a ON a.link_id = l.id
         LEFT JOIN last_ok k ON k.link_id = l.id
        WHERE m.tenant_id = $1
        ORDER BY m.brand, m.series NULLS LAST, m.capacity, l.side, l.shop_name`,
      [tenantId]
    )
  ).rows;

  const byModel = new Map();
  const latest = new Map();
  for (const r of rows) {
    if (!byModel.has(r.model_id)) {
      byModel.set(r.model_id, {
        id: r.model_id,
        modelKey: r.model_key,
        brand: r.brand,
        series: r.series,
        code: r.code,
        capacity: r.capacity,
        name: r.name,
        priority: r.priority,
        status: r.model_status,
        links: []
      });
    }
    byModel.get(r.model_id).links.push({
      id: r.link_id,
      side: r.side,
      url: r.url,
      sku: r.jd_sku,
      shopName: r.shop_name,
      title: r.title,
      status: r.link_status,
      verifyState: r.verify_state
    });
    latest.set(r.link_id, {
      last_status: r.last_status,
      last_reason: r.last_reason,
      last_at: r.last_at,
      ok_landed: r.ok_landed,
      ok_listed: r.ok_listed,
      ok_at: r.ok_at
    });
  }
  return { models: [...byModel.values()], latest };
}

async function buildLinksView(tenantId) {
  const { models, latest } = await listAllLinks(tenantId);
  return view.buildLinkGroups(models, latest);
}

/** 批量导入前查重：只查这一批的地址，不扫全表 */
async function linksByUrls(tenantId, urls) {
  const list = [...new Set((urls || []).filter(Boolean))];
  if (!list.length) return new Map();
  const db = await pool();
  const rows = (
    await db.query(
      `SELECT l.id, l.url, l.model_id, l.side, l.status, m.model_key
         FROM price_links l
         LEFT JOIN price_models m ON m.tenant_id = l.tenant_id AND m.id = l.model_id
        WHERE l.tenant_id = $1 AND l.url = ANY($2::text[])`,
      [tenantId, list]
    )
  ).rows;
  return new Map(rows.map((r) => [r.url, r]));
}

async function modelById(tenantId, id) {
  const db = await pool();
  const r = await db.query(
    `SELECT id, model_key, brand, series, code, capacity, name, status
       FROM price_models WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return r.rows[0] || null;
}

/** 停用 / 启用一条链接。停用的不采集，但保留历史快照 */
async function setLinkStatus(tenantId, linkId, status) {
  const next = status === 'paused' ? 'paused' : 'active';
  const db = await pool();
  const r = await db.query(
    `UPDATE price_links SET status = $3, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, status`,
    [tenantId, linkId, next]
  );
  if (!r.rowCount) {
    const err = new Error('链接不存在');
    err.status = 404;
    throw err;
  }
  return r.rows[0];
}

/** 改阵营（我方 / 竞品）。只会被用户手动点，不做任何自动推断 */
async function setLinkSide(tenantId, linkId, side) {
  const next = side === 'own' ? 'own' : 'competitor';
  const db = await pool();
  const r = await db.query(
    `UPDATE price_links SET side = $3, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, side`,
    [tenantId, linkId, next]
  );
  if (!r.rowCount) {
    const err = new Error('链接不存在');
    err.status = 404;
    throw err;
  }
  return r.rows[0];
}

/** 删除一条链接。快照会跟着级联删掉，所以页面上必须二次确认 */
async function removeLink(tenantId, linkId) {
  const db = await pool();
  const r = await db.query(
    'DELETE FROM price_links WHERE tenant_id = $1 AND id = $2 RETURNING id, url',
    [tenantId, linkId]
  );
  if (!r.rowCount) {
    const err = new Error('链接不存在');
    err.status = 404;
    throw err;
  }
  return r.rows[0];
}

/** 把一条已挂在别的机型下的链接改挂过来（只在用户明确勾选时调用） */
async function moveLink(tenantId, linkId, modelId, side) {
  const db = await pool();
  const r = await db.query(
    `UPDATE price_links SET model_id = $3, side = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING id`,
    [tenantId, linkId, modelId, side === 'own' ? 'own' : 'competitor']
  );
  if (!r.rowCount) {
    const err = new Error('链接不存在');
    err.status = 404;
    throw err;
  }
  return r.rows[0];
}

/* ---------------- 页面概览 ---------------- */
async function buildOverview(tenantId, now = new Date()) {
  const settings = await readSettings(tenantId);
  const models = await listModels(tenantId);
  const day = todayInShanghai(now);
  const obsMap = await observationsOfDay(tenantId, day);
  const [alerts, trendMap, lastOk, run, hook] = await Promise.all([
    activeAlerts(tenantId),
    trends(tenantId, 14),
    lastOkByLink(tenantId),
    lastRun(tenantId),
    webhookConfigured(tenantId)
  ]);

  const evalModels = models.map((m) => view.toEvalModel(m, obsMap));
  const { rows, summary } = evaluateAll(evalModels, {
    minGapYuan: settings.amount,
    minGapRate: settings.rate
  });
  const entries = models.map((model, i) => ({ model, row: rows[i] }));

  const hits = view.buildHits(entries, { alertByModel: alerts, obsMap, trendByModel: trendMap });
  const missing = view.buildMissing(models, obsMap, lastOk);

  const linkCount = models.reduce((n, m) => n + m.links.filter((l) => l.side === 'competitor').length, 0);

  return {
    mode: 'live',
    day,
    hits,
    missing,
    cover: { models: models.length, links: linkCount },
    summary,
    status: {
      lastRun: run ? view.fmtDateTime(run.started_at) : null,
      lastResult: run ? run.status : 'none',
      nextRun: view.nextRunAt(now, settings.full, settings.focus),
      login: run && run.login_state ? run.login_state : 'unknown',
      loginNote: run && run.status === 'blocked' ? '本轮被风控中断' : ''
    },
    config: {
      amount: settings.amount,
      rate: Number((settings.rate * 100).toFixed(3)),
      full: settings.full,
      focus: settings.focus,
      webhook: hook ? '已配置（与库存推送共用）' : '未配置',
      notify: settings.notify,
      newUser: settings.newUser,
      subsidyRate: Number((settings.subsidyRate * 100).toFixed(2)),
      subsidyCap: settings.subsidyCap
    }
  };
}

/* ---------------- 写：采集结果与告警 ---------------- */

async function startRun(tenantId, slot, catchup) {
  const db = await pool();
  const r = await db.query(
    'INSERT INTO price_runs(tenant_id, slot, catchup) VALUES($1,$2,$3) RETURNING id',
    [tenantId, slot || 'manual', !!catchup]
  );
  return r.rows[0].id;
}

async function finishRun(tenantId, runId, result) {
  const db = await pool();
  await db.query(
    `UPDATE price_runs
        SET finished_at = now(), status = $3, total_links = $4, ok_links = $5,
            failed_links = $6, login_state = $7, note = $8
      WHERE tenant_id = $1 AND id = $2`,
    [
      tenantId,
      runId,
      result.status || 'success',
      result.total || 0,
      result.ok || 0,
      result.failed || 0,
      result.loginState || null,
      result.note || null
    ]
  );
}

async function saveObservation(tenantId, linkId, runId, obs) {
  const db = await pool();
  const capturedAt = obs.capturedAt || new Date();
  await db.query(
    `INSERT INTO price_observations
       (tenant_id, link_id, run_id, captured_at, captured_on, status,
        listed_price, promo_amount, after_promo_price, subsidy_amount, subsidy_rate, landed_price,
        promo_text, promo_expire_at, subsidy_flag, landed_confidence,
        confidence, source, reason, raw, p0, p1, p2)
     VALUES ($1,$2,$3,$4,$5,$6,
             $7,$8,$9,$10,$11,$12,
             $13,$14,$15,$16,
             $17,$18,$19,$20,$21,$22,$23)`,
    [
      tenantId,
      linkId,
      runId || null,
      capturedAt,
      todayInShanghai(capturedAt),
      obs.status,
      obs.listed ?? null,
      obs.promoAmount ?? null,
      obs.afterPromo ?? null,
      obs.subsidyAmount ?? null,
      obs.subsidyRate ?? null,
      obs.landed ?? null,
      obs.promoText || null,
      obs.promoExpireAt || null,
      obs.subsidyFlag || null,
      obs.confidence || null,
      // 旧列冗余写入：p0=标价、p1=到手价，让还没改完的老查询不至于突然全空
      obs.confidence || null,
      obs.source || null,
      obs.reason || null,
      obs.raw ? JSON.stringify(obs.raw) : null,
      obs.listed ?? null,
      obs.landed ?? null,
      null
    ]
  );
}

/* 判价结果 → 告警行。
 * 状态机决定「要不要开新告警」，唯一索引 (tenant_id, model_id) WHERE status IN (...) 是最后一道防线：
 * 即使并发跑了两轮，数据库也不会让同一机型出现两条未结束的告警。 */
async function syncAlerts(tenantId, entries) {
  const db = await pool();
  const current = await activeAlerts(tenantId);
  const stats = { opened: 0, recovered: 0, updated: 0 };

  for (const { model, row } of entries) {
    const prev = current.get(model.id) || null;
    const decision = decideAlert(prev, row);

    if (decision === 'open') {
      await db.query(
        `INSERT INTO price_alerts
           (tenant_id, model_id, status, own_price, competitor_price, gap, gap_rate,
            competitor_shop, competitor_link_id, other_lower, confidence, first_seen_at, last_seen_at)
         VALUES ($1,$2,'open',$3,$4,$5,$6,$7,$8,$9,$10,now(),now())
         ON CONFLICT (tenant_id, model_id) WHERE status IN ('open','ignored','handled')
         DO UPDATE SET own_price = EXCLUDED.own_price,
                       competitor_price = EXCLUDED.competitor_price,
                       gap = EXCLUDED.gap,
                       gap_rate = EXCLUDED.gap_rate,
                       competitor_shop = EXCLUDED.competitor_shop,
                       competitor_link_id = EXCLUDED.competitor_link_id,
                       other_lower = EXCLUDED.other_lower,
                       confidence = EXCLUDED.confidence,
                       last_seen_at = now()`,
        [
          tenantId,
          model.id,
          row.own.price,
          row.competitor.price,
          row.gap,
          row.gapRate,
          row.competitor.shopName,
          row.competitor.linkId,
          row.competitor.otherLower,
          row.confidence
        ]
      );
      stats.opened += 1;
      continue;
    }

    if (!prev) continue;

    if (decision === 'recovered') {
      await db.query(
        `UPDATE price_alerts SET status='recovered', resolved_at=now(), last_seen_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [tenantId, prev.id]
      );
      stats.recovered += 1;
      continue;
    }

    if (row.status === 'ok' && row.hit) {
      await db.query(
        `UPDATE price_alerts
            SET own_price=$3, competitor_price=$4, gap=$5, gap_rate=$6,
                competitor_shop=$7, competitor_link_id=$8, other_lower=$9,
                confidence=$10, last_seen_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [
          tenantId,
          prev.id,
          row.own.price,
          row.competitor.price,
          row.gap,
          row.gapRate,
          row.competitor.shopName,
          row.competitor.linkId,
          row.competitor.otherLower,
          row.confidence
        ]
      );
      stats.updated += 1;
    }
  }

  return stats;
}

/* 跑一轮判价：从库里取当天快照 → 评估 → 写告警。采集器跑完后调用它。 */
async function evaluateToday(tenantId, now = new Date()) {
  const settings = await readSettings(tenantId);
  const models = await listModels(tenantId);
  const obsMap = await observationsOfDay(tenantId, todayInShanghai(now));
  const evalModels = models.map((m) => view.toEvalModel(m, obsMap));
  const { rows, summary } = evaluateAll(evalModels, {
    minGapYuan: settings.amount,
    minGapRate: settings.rate
  });
  const entries = models.map((model, i) => ({ model, row: rows[i] }));
  const alerts = await syncAlerts(tenantId, entries);
  return { entries, summary, alerts };
}

async function applyAlertAction(tenantId, alertId, action) {
  const db = await pool();
  const map = { ignore: 'ignored', restore: 'open', handle: 'handled', recover: 'recovered' };
  const status = map[action];
  if (!status) {
    const err = new Error('不支持的操作');
    err.status = 400;
    throw err;
  }
  const r = await db.query(
    `UPDATE price_alerts
        SET status = $3,
            resolved_at = CASE WHEN $3 = 'recovered' THEN now() ELSE NULL END
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, status`,
    [tenantId, alertId, status]
  );
  if (!r.rowCount) {
    const err = new Error('告警不存在');
    err.status = 404;
    throw err;
  }
  return r.rows[0];
}

/* 导入用：机型按 model_key 幂等，链接按 url 幂等 */
async function upsertModel(tenantId, model) {
  const db = await pool();
  const r = await db.query(
    `INSERT INTO price_models (tenant_id, model_key, brand, series, code, capacity, name, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, model_key)
     DO UPDATE SET brand = EXCLUDED.brand, series = COALESCE(EXCLUDED.series, price_models.series),
                   code = COALESCE(EXCLUDED.code, price_models.code),
                   capacity = COALESCE(EXCLUDED.capacity, price_models.capacity),
                   name = COALESCE(EXCLUDED.name, price_models.name),
                   priority = price_models.priority OR EXCLUDED.priority,
                   updated_at = now()
     RETURNING id`,
    [
      tenantId,
      model.modelKey,
      model.brand,
      model.series || null,
      model.code || null,
      model.capacity || null,
      model.name || null,
      !!model.priority
    ]
  );
  return r.rows[0].id;
}

// 同一条链接重复导入时，**只补店铺名/标题/重点标记，绝不动它已经挂好的机型和阵营**。
// 教训（2026-11-02）：以前会覆盖 model_id 和 side，一次列错位的 CSV 就让我方链接
// 变成了「竞品」，还把价格挂到了另一个机型下，比价结果直接错掉。
async function upsertLink(tenantId, modelId, link) {
  const db = await pool();
  const r = await db.query(
    `INSERT INTO price_links (tenant_id, model_id, side, jd_sku, url, shop_id, shop_name, title, priority, verify_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (tenant_id, url)
     DO UPDATE SET shop_name = COALESCE(EXCLUDED.shop_name, price_links.shop_name),
                   title = COALESCE(EXCLUDED.title, price_links.title),
                   priority = price_links.priority OR EXCLUDED.priority,
                   updated_at = now()
     RETURNING id`,
    [
      tenantId,
      modelId,
      link.side === 'own' ? 'own' : 'competitor',
      link.sku || null,
      link.url,
      link.shopId || null,
      link.shopName || null,
      link.title || null,
      !!link.priority,
      link.verifyState || 'confirmed'
    ]
  );
  return r.rows[0].id;
}

/** 这条链接是不是已经挂过了？给批量导入判断「新增 / 已存在」用 */
async function linkByUrl(tenantId, url) {
  const db = await pool();
  const r = await db.query(
    `SELECT l.id, l.model_id, l.side, m.model_key
       FROM price_links l
       LEFT JOIN price_models m ON m.tenant_id = l.tenant_id AND m.id = l.model_id
      WHERE l.tenant_id = $1 AND l.url = $2`,
    [tenantId, url]
  );
  return r.rows[0] || null;
}

module.exports = {
  todayInShanghai,
  readSettings,
  saveSettings,
  listModels,
  listAllLinks,
  buildLinksView,
  linksByUrls,
  modelById,
  setLinkStatus,
  setLinkSide,
  removeLink,
  moveLink,
  observationsOfDay,
  lastOkByLink,
  activeAlerts,
  trends,
  lastRun,
  buildOverview,
  startRun,
  finishRun,
  saveObservation,
  syncAlerts,
  evaluateToday,
  applyAlertAction,
  upsertModel,
  upsertLink,
  linkByUrl
};
