'use strict';

/**
 * 浏览器通道采集器（2026-10-31 新增，用于替代纯 HTTP 直连）。
 *
 * 为什么要换：
 *   纯 HTTP 抓 item.m.jd.com 在链接量上来后会被京东**按 IP 频控**——实测每一条都要先吃一次
 *   限流、再等 3 分钟冷却才成功，约 3.3 分钟/条；200 条约 11 小时，两轮/天根本跑不完。
 *   真浏览器加载整页（带几十个子请求、真实 Referer、真实 UA）看起来就是正常访客，
 *   频控阈值高得多，而且能顺带读到 PLUS 价和券——纯 HTTP 只能读到"页面价"。
 *
 * 代价：一条 5~10 秒（纯 HTTP 是 1~3 秒）。60 条约 6~10 分钟，可接受。
 *
 * 复用登录态：直接用 data/price-browser 这个浏览器 profile（扫码登录时就用它），
 * 不必再把 cookie 注入进去，风控特征也更自然。
 *
 * 只读：本模块不点任何按钮、不加购、不下单。
 */

const { chromium } = require('playwright');
const session = require('../session');

// 模拟人的停留节奏：翻页太快本身就是频控特征
const GAP_MIN = 5000;
const GAP_MAX = 9000;

// 页面加载后等价格渲染出来的上限（超时不算失败，先试着取一次）
const READY_TIMEOUT = 12000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gap = () => GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);

/**
 * 在页面里提取价格字段。
 * 京东 PC 页结构改版过多次，所以不赌单一选择器，按「可靠度从高到低」依次尝试，
 * 并把所有候选都放进 __diag，解析失败时能一眼看出该改哪。
 */
function extractInPage(sku) {
  const num = (v) => {
    if (v == null) return null;
    const m = String(v).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  };
  const texts = (sel) => Array.from(document.querySelectorAll(sel)).map((el) => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const diag = { url: location.href, title: document.title, hasPageConfig: !!window.pageConfig };
  const pc = (window.pageConfig && window.pageConfig.product) || null;
  if (pc) {
    diag.productKeys = Object.keys(pc);
    diag.priceish = {};
    for (const k of Object.keys(pc)) {
      if (/price|pluss|coupon|promo|vip|p$/i.test(k)) diag.priceish[k] = pc[k];
    }
  }
  diag.bodyHead = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300);

  // 京东价（页面价）：DOM 与 pageConfig 两个来源交叉验证
  const domPrice = num(text('#jd-price')) || num(text('.p-price .price')) || num(text('.summary-price .price'));
  const cfgPrice = pc ? num(pc.p) || num(pc.price) || num(pc.jdPrice) : null;
  const p0 = domPrice || cfgPrice || null;

  // PLUS 价：只在页面明确显示 PLUS 专享价时才取
  const plusText = text('.p-price-plus .price') || text('.plus-price .price') || text('[class*="plus"] .price');
  const cfgPlus = pc ? num(pc.plussPrice) || num(pc.plusPrice) : null;
  const plus = num(plusText) || cfgPlus || null;

  // 券：页面右侧「优惠券」区块里的每条文案，交给上层判断面额
  const coupons = texts('#summary-quan .quan-item').length
    ? texts('#summary-quan .quan-item')
    : texts('.quan-item, .coupon-item');

  const promo = text('#summary-promotion') || text('.summary-promotion') || null;
  const shopName = text('.J-hove-wrap .name a') || text('#popbox .mt .name a') || text('.shopName') || (pc && (pc.shopName || pc.venderName)) || null;
  const title = (pc && pc.name) || text('.sku-name') || document.title;

  return { sku, p0, plus, coupons, promo, shopName, title, diag };
}

/** 判断这一页到底是商品页、频控页还是验证页 */
function pageKind(info) {
  const t = String((info.diag && info.diag.title) || '');
  const u = String((info.diag && info.diag.url) || '');
  const body = String((info.diag && info.diag.bodyHead) || '');
  if (/频控|验证|安全|robot/i.test(t) || /risk_handler|verify/.test(u)) return 'blocked';
  if (/passport\.jd\.com|plogin/.test(u)) return 'need_login';
  if (!info.p0 && /频控/.test(body)) return 'blocked';
  return info.p0 ? 'ok' : 'parse_failed';
}

/** 券文案 → 面额合计（只累加"满 x 减 y"里我们一定能拿到的部分：无门槛券） */
function couponValue(coupons) {
  let direct = 0;
  let unknown = 0;
  for (const raw of coupons || []) {
    const s = String(raw);
    const m = s.match(/(\d+(?:\.\d+)?)\s*元/);
    const amount = m ? Number(m[1]) : null;
    if (!amount) continue;
    // 「满 3000 减 200」这类要凑单才有，口径上不算最低可得价
    if (/满\s*\d+/.test(s)) { unknown += 1; continue; }
    direct += amount;
  }
  return { direct, unknown };
}

/**
 * 一次性采集一批 SKU（共用一个浏览器，别每个链接都开关一次）。
 * 返回数组，元素形状与 lib/price/sources/jd.js 的 collect() 一致，上层不用区分通道。
 */
async function collectBatch(skus, opts = {}) {
  const list = Array.isArray(skus) ? skus.filter(Boolean) : [];
  if (!list.length) return [];

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const headless = opts.headless !== false;
  const ctx = await chromium.launchPersistentContext(session.PROFILE_DIR, {
    channel: 'chrome',
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']
  });

  const results = [];
  let closed = false;
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.setDefaultTimeout(READY_TIMEOUT);

    // 先随便访问一次首页，让风控 cookie 进入"正常浏览"状态
    await page.goto('https://www.jd.com/', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await sleep(1200 + Math.random() * 800);

    for (let i = 0; i < list.length; i += 1) {
      const sku = list[i];
      const started = Date.now();
      let info;
      try {
        await page.goto(`https://item.jd.com/${sku}.html`, { waitUntil: 'domcontentloaded', timeout: 25000 });
        // 价格是异步塞进 DOM 的：等到出现价格结点或超时，取到即走
        await page.waitForFunction(
          () => !!document.querySelector('#jd-price, .p-price .price, .summary-price .price'),
          null,
          { timeout: READY_TIMEOUT }
        ).catch(() => {});
        info = await page.evaluate(extractInPage, sku);
      } catch (e) {
        results.push({
          sku,
          status: 'failed',
          p0: null, p1: null, p2: null,
          reason: '页面打开失败：' + String(e.message || e).slice(0, 80),
          observedAt: new Date().toISOString()
        });
        onProgress({ index: i + 1, total: list.length, sku, status: 'failed', ms: Date.now() - started });
        await sleep(gap());
        continue;
      }

      const kind = pageKind(info);
      const cv = couponValue(info.coupons);
      const p0 = info.p0;
      // 最低可得价 = 页面价 - 无门槛券；PLUS 价更低时取 PLUS 价
      let p1 = p0;
      if (info.plus != null && p0 != null && info.plus < p1) p1 = info.plus;
      if (cv.direct > 0 && p1 != null) p1 = Math.round((p1 - cv.direct) * 100) / 100;
      if (p1 != null && p1 <= 0) p1 = p0;

      const notes = [];
      if (info.plus != null && p0 != null && info.plus < p0) notes.push(`PLUS 价 ${info.plus}`);
      if (cv.direct > 0) notes.push(`无门槛券 ${cv.direct} 元`);
      if (cv.unknown > 0) notes.push(`另有 ${cv.unknown} 张满减券（需凑单，不计入最低价）`);
      if (p1 === p0 && p1 != null) notes.push('未取到 PLUS/无门槛券，最低可得价按页面价计（券后更低时会漏报，不会假报）');

      results.push({
        sku,
        status: kind,
        p0,
        p1,
        p2: null,
        plus: info.plus,
        coupons: info.coupons,
        promoText: info.promo || null,
        shopName: info.shopName || null,
        title: info.title || null,
        notes,
        reason: kind === 'ok' ? null
          : kind === 'blocked' ? '被京东频控/验证页拦住，需要降低频率或稍后再采'
            : kind === 'need_login' ? '登录态失效，请重新扫码'
              : '价格结点存在但没解析出数字，可能页面改版',
        source: 'browser',
        diag: kind === 'ok' ? undefined : info.diag,
        observedAt: new Date().toISOString()
      });
      onProgress({ index: i + 1, total: list.length, sku, status: kind, p0, p1, ms: Date.now() - started });

      // 连续被拦住就别硬撞了，直接收工，把已知结果交上去
      if (kind === 'blocked' && results.filter((r) => r.status === 'blocked').length >= 3) {
        for (let j = i + 1; j < list.length; j += 1) {
          results.push({
            sku: list[j], status: 'blocked', p0: null, p1: null, p2: null,
            reason: '连续被频控，本轮中止', source: 'browser', observedAt: new Date().toISOString()
          });
        }
        break;
      }
      if (i < list.length - 1) await sleep(gap());
    }
  } finally {
    if (!closed) { closed = true; await ctx.close().catch(() => {}); }
  }
  return results;
}

/** 单条采集（给调试和验证脚本用） */
async function collect(sku, opts = {}) {
  const rows = await collectBatch([sku], opts);
  return rows[0];
}

module.exports = { collect, collectBatch, extractInPage, pageKind, couponValue };
