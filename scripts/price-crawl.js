'use strict';

/**
 * 比价采集一轮（跑在用户自己的 Mac 上，由定时任务调用）
 *
 * 用法：
 *   node scripts/price-crawl.js                 # 全量一轮（对应 10:00）
 *   node scripts/price-crawl.js --focus         # 只跑重点机型（对应 20:00）
 *   node scripts/price-crawl.js --limit 3       # 只跑 3 条，调试用
 *   node scripts/price-crawl.js --dry           # 只打印，不写库、不推送
 *   node scripts/price-crawl.js --no-push       # 写库但不发企微
 *
 * 原则（与库存模块一致）：采不到就如实记 failed/blocked，绝不拿旧价格顶替。
 */

require('../lib/price/env').loadEnv();

const store = require('../lib/price/store');
const session = require('../lib/price/session');
const jd = require('../lib/price/sources/jd');
const browser = require('../lib/price/sources/browser');
const wecom = require('../lib/price/wecom');
const { computeLanded } = require('../lib/price/landed');
const { getInventoryPool } = require('../lib/db/inventory-client');

const CONSECUTIVE_STOP = 6; // 连续失败这么多条就熔断，避免把账号/IP 打死
// 2026-10-31 实测（重要）：京东移动详情页的限流是**按 IP 计数**的，跟登录态无关。
// 间隔 12~22 秒连续跑十几条之后，会进入"每条都要先吃一次 302、等 3 分钟冷却"的状态，
// 折合 3.3 分钟/条，60 条要跑 3 小时——等于不可用。
// 现在把间隔拉到 25~45 秒（约 35 分钟跑完 60 条），用"慢而稳"换"快而废"。
// 注意：PC 详情页（item.jd.com）是另一层更严的 IP 频控，当天被标记后连有头浏览器都只返回
// 「PC频控页」，所以浏览器通道暂时用不上，见 lib/price/sources/browser.js 的说明。
const DELAY_MIN = 25000;
const DELAY_MAX = 45000;
const RATE_LIMIT_BACKOFF_MS = 4 * 60 * 1000; // 被限流后等 4 分钟再试一次
const RATE_LIMIT_STOP = 2; // 退避后仍被限流，就整轮中止
// 一轮里最多容忍几次「限流→退避→成功」。
// 2026-11-02 实测：IP 处在惩罚期时，每一条都要先吃一次限流再等 4 分钟，
// 4 条跑 14 分钟；照这个速度 60 条要跑 4 小时，跨过下一个采样时点，等于这轮废掉。
// 与其硬撑，不如采到多少算多少、记 degraded，把「IP 需要歇一歇」这件事显式暴露出来。
const MAX_BACKOFFS_PER_RUN = 3;

function log(msg) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}] ${msg}`);
}

function args() {
  const a = process.argv.slice(2);
  const get = (name, def) => {
    const hit = a.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
    if (!hit) return def;
    return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
  };
  return {
    focus: !!get('focus', false),
    dry: !!get('dry', false),
    noPush: !!get('no-push', false),
    limit: Number(get('limit', 0)) || 0,
    slot: String(get('slot', get('focus', false) ? 'focus' : 'full')),
    // 通道：http = 移动详情页纯 HTTP（当前默认，实测可用）；browser = 真浏览器抓 PC 页
    //（能读 PLUS 价和券，但京东对 PC 详情页有更严的 IP 频控，被标记后只返回「PC频控页」）
    channel: String(get('channel', process.env.PRICE_CHANNEL || 'http')),
    headful: !!get('headful', false)
  };
}

/** 采集器状态 → 数据库允许的四种状态 */
function mapStatus(r) {
  switch (r.status) {
    case 'ok':
      return 'ok';
    case 'need_login':
    case 'blocked':
    case 'rate_limited':
      return 'blocked';
    case 'offline':
    case 'not_found':
      return 'delisted';
    default:
      return 'failed';
  }
}

async function resolveTenant() {
  if (process.env.PRICE_TENANT_ID) return process.env.PRICE_TENANT_ID;
  const db = getInventoryPool();
  const r = await db.query('SELECT id, name FROM tenants ORDER BY created_at LIMIT 1');
  if (!r.rows.length) throw new Error('库里没有任何租户，先初始化工作台');
  log(`租户：${r.rows[0].name || r.rows[0].id}`);
  return r.rows[0].id;
}

async function loadLinks(tenantId, focus) {
  const db = getInventoryPool();
  const r = await db.query(
    `SELECT l.id, l.url, l.jd_sku, l.side, l.title, l.shop_name,
            m.model_key, m.series, m.capacity, m.brand
       FROM price_links l
       JOIN price_models m ON m.tenant_id = l.tenant_id AND m.id = l.model_id
      WHERE l.tenant_id = $1 AND l.status = 'active' AND m.status = 'active'
        ${focus ? 'AND (l.priority OR m.priority)' : ''}
      ORDER BY m.model_key, l.side DESC, l.id`,
    [tenantId]
  );
  return r.rows;
}

/**
 * 纯 HTTP 通道（当前主力）。
 * 一次 GET 移动详情页就能拿到：标价、可叠加直减券、国补开关，够算到手价。
 * 难点只在频率：京东按 IP 计数，隔得太近会 302 到 limit.html。
 */
async function collectByHttp(list, skus, cookie, cfg, onResult) {
  const out = [];
  let rateLimited = 0;
  let backoffs = 0;
  for (let i = 0; i < list.length; i += 1) {
    const sku = skus[i];
    const link = list[i];
    const call = () => jd.collect(sku, { cookie, subsidyRate: cfg.subsidyRate, subsidyCap: cfg.subsidyCap });
    let result;
    try {
      result = await call();
      // 被限流：不是页面问题，等一会儿再问一次；还不行就整轮停下，别硬撞
      if (result.status === 'rate_limited') {
        backoffs += 1;
        if (backoffs > MAX_BACKOFFS_PER_RUN) {
          log(`⚠️ 本轮已退避 ${backoffs - 1} 次，京东仍在限流：先收工，本轮采到的已入库，等下一轮再补。`);
          log('   处理办法：这个出口 IP 正在被京东限速，通常歇 1~2 小时自行恢复；不要在惩罚期硬刷。');
          if (onResult) await onResult(i, result);
          break;
        }
        log(`⚠️ 被京东限流，等 ${Math.round(RATE_LIMIT_BACKOFF_MS / 60000)} 分钟后重试这一条（本轮第 ${backoffs} 次退避）…`);
        await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
        result = await call();
        if (result.status === 'rate_limited') rateLimited += 1;
      }
    } catch (e) {
      result = { status: 'failed', reason: String(e.message || e).slice(0, 120), confidence: 'low' };
    }
    const st = mapStatus(result);
    const tag = st === 'ok' ? '✅' : st === 'delisted' ? '⛔' : '⚠️ ';
    log(`${tag} ${i + 1}/${list.length} ${link.shop_name || link.side} ${sku} ${priceText(result)} ${st !== 'ok' ? '[' + st + '] ' + (result.reason || '') : ''}`);
    out.push(result);

    // 立刻落库（调用方负责），拿回「要不要熔断」
    const stop = onResult ? await onResult(i, result) : false;

    if (rateLimited >= RATE_LIMIT_STOP) {
      log('连续被限流，本轮中止（已完成的结果已入库）');
      break;
    }
    if (stop) {
      log(`连续 ${CONSECUTIVE_STOP} 条失败，判定为被风控/登录失效，本轮中断（已采到的结果已入库）`);
      break;
    }
    if (i < list.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN)));
    }
  }
  return out;
}

/** 日志里把到手价链条摊开：「标价3098 −券300 −国补419.7 → 到手2378.3」
 *  为什么要摊开：只打一个数，出问题时无法判断是标价读错了还是券没减。 */
function priceText(r) {
  if (r.status !== 'ok' || r.listed == null) return r.p0 != null ? '¥' + r.p0 : '';
  const promo = r.promoAmount ? ` −券${r.promoAmount}` : '';
  const sub = r.subsidyAmount ? ` −国补${r.subsidyAmount}` : '';
  return `标价${r.listed}${promo}${sub} → 到手${r.landed}`;
}

/** 浏览器通道（暂不可用，保留适配）：它只返回 p0/p1，用同一套算术补出到手价链条，
 *  避免两条通道产出两种结构、落库时还要分支判断。 */
function normalizeResult(result, cfg) {
  if (!result || result.status !== 'ok') return result;
  if (result.landed != null) return result;
  const chain = computeLanded({
    listed: result.p0,
    promos: Array.isArray(result.coupons) ? result.coupons.filter((c) => c && c.off && c.usable !== false) : [],
    subsidyFlag: result.subsidyFlag || 'unknown',
    subsidyRate: cfg.subsidyRate,
    subsidyCap: cfg.subsidyCap
  });
  if (!chain) return { ...result, status: 'failed', reason: '未取到标价' };
  return { ...result, ...chain };
}

(async () => {
  const opt = args();
  const tenantId = await resolveTenant();

  // ① 登录态先检查：没有就整轮不跑，并把它记成 blocked（页面会显示"登录已失效"）
  const sess = session.checkSession();
  if (!sess.ok) {
    log(`登录态不可用：${sess.message}`);
    if (!opt.dry) {
      const runId = await store.startRun(tenantId, opt.slot, false);
      await store.finishRun(tenantId, runId, {
        status: 'blocked', total: 0, ok: 0, failed: 0, loginState: sess.reason, note: sess.message
      });
    }
    log('本轮未采集。修好后重跑：双击「启动比价登录.command」扫码。');
    process.exit(3);
  }
  log(`登录态正常（保存于 ${sess.days} 天前）`);

  let links = await loadLinks(tenantId, opt.focus);
  // 20:00 的重点轮只跑打了「重点」标记的机型。但一条都没标时不能直接跳过 ——
  // 那样页面看起来正常、晚上却什么都没采，价格停在早上，最容易被当成「今晚没降价」。
  // 链接总量还小（几十条）时，退化成全量跑更实在。
  if (opt.focus && !links.length) {
    links = await loadLinks(tenantId, false);
    if (links.length) log('没有标记为重点的机型，本轮按全量采');
  }
  if (!links.length) {
    log('库里还没有任何链接，先导入链接');
    process.exit(0);
  }
  const list = opt.limit ? links.slice(0, opt.limit) : links;
  log(`本轮待采 ${list.length} 条${opt.focus ? '（仅重点机型）' : ''}`);

  const runId = opt.dry ? null : await store.startRun(tenantId, opt.slot, false);
  const cookie = session.cookieHeader();
  const channel = opt.channel === 'http' ? 'http' : 'browser';
  log(`采集通道：${channel === 'browser' ? '真浏览器' : '纯 HTTP（移动详情页，能读券和国补开关）'}`);

  // 国补按配置算，不写死：比例/上限改了不用动代码
  const settings = await store.readSettings(tenantId);
  const cfg = { subsidyRate: settings.subsidyRate, subsidyCap: settings.subsidyCap };
  log(`国补口径：${(cfg.subsidyRate * 100).toFixed(0)}%，上限 ¥${cfg.subsidyCap}`);

  const skus = list.map((link) => link.jd_sku || jd.parseSku(link.url));

  // ===== 采集 =====
  let ok = 0;
  let failed = 0;
  let streak = 0;
  let blockedHits = 0;
  let aborted = false;

  /* 采到一条就立刻入库，返回 true 表示「该熔断了」。
     为什么不一口气采完再统一写：2026-11-02 实测，4 条链接在限流退避下要跑十几分钟，
     旧写法在这段时间里一条都没落库，页面看着像「今天没采」，被手动中断更是全丢。
     现在每条落地一次，中断时前面采到的还在。 */
  async function persist(i, raw) {
    const link = list[i];
    const result = normalizeResult(raw || { status: 'failed', reason: '未采集' }, cfg);
    const st = mapStatus(result);
    if (st === 'ok') {
      ok += 1;
      streak = 0;
    } else {
      failed += 1;
      streak += 1;
      if (st === 'blocked') blockedHits += 1;
    }
    if (streak >= CONSECUTIVE_STOP) aborted = true;

    if (!opt.dry) {
      await store.saveObservation(tenantId, link.id, runId, {
        status: st,
        // 到手价链条（主口径），以及构成它的每一步，方便事后对账
        listed: result.listed,
        promoAmount: result.promoAmount,
        afterPromo: result.afterPromo,
        subsidyAmount: result.subsidyAmount,
        subsidyRate: result.subsidyRate,
        landed: result.landed,
        promoText: result.promoText,
        promoExpireAt: result.promoExpireAt,
        subsidyFlag: result.subsidyFlag,
        confidence: result.confidence,
        source: channel === 'browser' ? 'jd-browser' : 'jd-mobile',
        reason: result.reason || null,
        raw: {
          title: result.title,
          shopName: result.shopName,
          bybtText: result.bybtText,
          salePrice: result.salePrice,
          coupons: result.coupons,
          notes: result.notes,
          priceKeys: result.priceKeys,
          masked: result.masked,
          diag: result.diag
        }
      });
      // 顺手把标题/店铺补上，页面链接管理里就有名字了
      if (result.title && !link.title) {
        await getInventoryPool().query(
          'UPDATE price_links SET title=$3, shop_name=COALESCE($4, shop_name), updated_at=now() WHERE tenant_id=$1 AND id=$2',
          [tenantId, link.id, String(result.title).slice(0, 200), result.shopName || null]
        );
      }
    }
    return aborted;
  }

  if (channel === 'browser') {
    // 浏览器通道一次出一批，采完再逐条落库（它本身就是整批跑，没有中间态）
    const batch = await browser.collectBatch(skus, {
      headless: !opt.headful,
      onProgress: (p) => {
        const link = list[p.index - 1] || {};
        const st = mapStatus(p);
        const tag = st === 'ok' ? '✅' : st === 'delisted' ? '⛔' : '⚠️ ';
        log(`${tag} ${p.index}/${p.total} ${link.shop_name || link.side || ''} ${p.sku} ${p.p0 != null ? '¥' + p.p0 : ''} ${st !== 'ok' ? '[' + p.status + ']' : ''} ${p.ms != null ? Math.round(p.ms / 100) / 10 + 's' : ''}`);
      }
    });
    for (let i = 0; i < list.length; i += 1) {
      if (await persist(i, batch[i])) break;
    }
  } else {
    await collectByHttp(list, skus, cookie, cfg, persist);
  }

  if (aborted) log(`连续 ${streak} 条失败，判定为被风控/登录失效，本轮中断（已采到的结果已入库）`);
  const rateLimited = blockedHits;

  const status = aborted ? 'blocked' : ok === 0 ? 'failed' : failed > 0 ? 'partial' : 'success';
  if (!opt.dry) {
    await store.finishRun(tenantId, runId, {
      status,
      total: list.length,
      ok,
      failed,
      loginState: aborted && rateLimited ? 'ok' : aborted ? 'expired' : 'ok',
      note: aborted ? (rateLimited ? '被京东限流，本轮中止' : '连续失败触发熔断') : null
    });
  }
  log(`采集完成：成功 ${ok} / 失败 ${failed} / 共 ${list.length}，状态 ${status}`);

  if (opt.dry) {
    log('--dry：不写库、不判价、不推送');
    process.exit(0);
  }

  // ② 判价 + 写告警
  const ev = await store.evaluateToday(tenantId);
  const a = ev.alerts || {};
  log(`判价：新开 ${a.opened || 0} 条，持续 ${a.updated || 0} 条，回升关闭 ${a.recovered || 0} 条`);

  // ③ 推送：一条汇总
  if (opt.noPush) {
    log('--no-push：跳过企微推送');
  } else {
    const overview = await store.buildOverview(tenantId);
    const push = await wecom.sendDigest(tenantId, {
      day: overview.day,
      hits: overview.hits.filter((h) => h.status !== 'recovered'),
      summary: overview.summary,
      status: overview.status
    });
    log(push.sent ? '企微汇总已发送' : `企微未发送：${push.reason}`);
  }

  process.exit(0);
})().catch(async (e) => {
  console.error('采集异常：', e.message);
  console.error(e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : '');
  process.exit(1);
});
