'use strict';

/**
 * 京东扫码登录（一次性操作，登录态可复用 1~4 周）
 *
 * 用法：
 *   node scripts/price-login.js
 *
 * 做的事：
 *   1. 打开一个真实的 Chrome 窗口到京东登录页，你用京东 App 扫码
 *   2. 检测到登录 cookie 后写入 data/price-session.json（不入库、不进 git）
 *   3. 立刻用**纯 HTTP**（不开浏览器）验证 5 个链接能否读到真实价格，把结果打出来
 *
 * 注意：登录后浏览器窗口会自己关掉。若扫码超时，重跑即可。
 */

const path = require('path');
const { chromium } = require('playwright');
const session = require('../lib/price/session');
const jd = require('../lib/price/sources/jd');

const DEFAULT_SKUS = ['10175592455372', '10149212746799', '100212513162', '10152461753009', '10154195099696'];
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000; // 双击 .command 运行时你有时间慢慢扫码

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

/** 给等待中的提示补上「当前停在哪个页面」，扫码没生效时能直接看出卡在哪一步 */
async function describePage(ctx) {
  const pages = ctx.pages().filter((p) => !p.isClosed());
  if (!pages.length) return '浏览器窗口已关闭';
  const p = pages[pages.length - 1];
  let url = '';
  let text = '';
  try {
    url = p.url() || '';
    text = (await p.evaluate(() => (document.body && document.body.innerText) || '')).replace(/\s+/g, ' ').trim();
  } catch (e) {
    return '页面读取中…';
  }
  if (/risk_handler|验证|captcha/.test(url) || /安全验证|拖动|滑块/.test(text)) return '⚠️ 停在京东安全验证页，需要在窗口里完成验证';
  if (/passport\.jd\.com/.test(url)) {
    if (/确认登录|扫描成功|请在手机/.test(text)) return '📱 已扫码，等你在手机上点「确认登录」';
    if (/二维码.*(失效|过期)|重新获取/.test(text)) return '⌛ 二维码已失效，请点窗口里的二维码刷新后重扫';
    return '📷 停在扫码页（QRCodeKey 已下发，等待扫码）';
  }
  return `已离开登录页：${url.slice(0, 60)}`;
}

async function waitForLogin(ctx) {
  const started = Date.now();
  let lastHint = 0;
  while (Date.now() - started < LOGIN_TIMEOUT_MS) {
    const cookies = await ctx.cookies('https://www.jd.com');
    // 两套 cookie 都认：老版 pt_key/pt_pin，新版 thor/pin（2026-10 起扫码后只发这套）。
    // 判断口径统一用 session.hasAuthCookies（要求主域 jd.com 上凑齐），
    // 否则 "thor 只落在子域" 的情况会被误判成登录成功、价格却一直打码。
    const asState = { cookies };
    if (session.hasAuthCookies(asState)) {
      const pin = (cookies.find((c) => c.name === 'pt_pin') || cookies.find((c) => c.name === 'pin') || {}).value || '';
      return { ok: true, pin: decodeURIComponent(pin) };
    }
    const left = Math.round((LOGIN_TIMEOUT_MS - (Date.now() - started)) / 1000);
    if (Date.now() - lastHint > 20000) {
      lastHint = Date.now();
      log(`等待扫码登录…（剩余 ${left} 秒）${await describePage(ctx)}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false };
}

(async () => {
  const skus = process.argv.slice(2).filter(Boolean).map(jd.parseSku).filter(Boolean);
  const list = skus.length ? skus : DEFAULT_SKUS;

  log('打开京东登录页，请用京东 App 扫码…');
  const ctx = await chromium.launchPersistentContext(session.PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 860 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    args: ['--disable-blink-features=AutomationControlled']
  });

  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://passport.jd.com/new/login.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => log('打开登录页失败：' + e.message));

  const result = await waitForLogin(ctx);
  if (!result.ok) {
    log('超时未完成登录，窗口将关闭。需要时重跑本脚本。');
    await ctx.close();
    process.exit(2);
  }

  log(`登录成功（账号 ${result.pin || '未知'}），保存登录态…`);
  // 先访问一次首页，让京东把设备/风控 cookie 补齐，避免后续请求被判异常
  const warm = await ctx.newPage();
  await warm.goto('https://www.jd.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await warm.waitForTimeout(1500);
  await warm.close().catch(() => {});

  const state = await ctx.storageState();
  state.__savedAt = new Date().toISOString();
  const file = session.writeSession(state);
  log(`已写入 ${path.relative(process.cwd(), file)}（含 ${state.cookies.length} 个 cookie）`);

  await ctx.close();

  const cookie = session.cookieHeader();
  if (!cookie) {
    log('登录态校验失败：没有 pt_key/pt_pin（或新版 thor/pin），请重跑。');
    process.exit(3);
  }

  // 验证只跑 1 条：这里的目的只有一个——证明「登录态有效 + 采集通道能读到真实价」。
  // 早先这里把 5 条连着扫（间隔 1.2~2 秒），实测必然被京东限流：第 1 条成功，后 4 条全是
  // rate_limited，看上去像登录失败，其实是自己撞上去的。真实采集在 scripts/price-crawl.js，
  // 那边有 12~22 秒的间隔和长退避，这里的结论不能反过来当成「采集不可用」。
  log('开始验证采集通道（纯 HTTP，不开浏览器）…');
  const verifyList = list.slice(0, 1);
  const rows = [];
  for (const sku of verifyList) {
    let r = await jd.collect(sku, { cookie });
    if (r.status === 'rate_limited') {
      // 刚扫码完有时会被临时限流，等 90 秒再问一次，别让人误以为登录没成功
      log('⚠️ 首次请求被限流（访问过快），等 90 秒再试一次…');
      await new Promise((res) => setTimeout(res, 90 * 1000));
      r = await jd.collect(sku, { cookie });
    }
    rows.push(r);
    // 验证的价值就在这一行：把到手价的每一步摊开，人能一眼看出是标价错了、券没减，还是国补没算
    const chain =
      r.status === 'ok' && r.landed != null
        ? `标价 ¥${r.listed}${r.promoAmount ? ` − 券 ${r.promoAmount}` : ''}${r.subsidyAmount ? ` − 国补 ${r.subsidyAmount}` : ''} → 到手 ¥${r.landed}`
        : '未取到';
    console.log(`  ${r.status === 'ok' ? '✅' : '⚠️ '} ${sku}  ${r.shopName || '-'}  ${chain}  [${r.status}] ${r.reason || ''}`);
    console.log(`      ${(r.title || '').slice(0, 60)}`);
    if (r.status === 'ok') {
      const flag = r.subsidyFlag === 'yes' ? '支持国补' : r.subsidyFlag === 'no' ? '不支持国补' : '未标识国补';
      console.log(`      优惠: ${r.promoText || '页面无直减券'} · ${flag} · 置信度 ${r.confidence}`);
    }
    if (r.notes && r.notes.length) console.log(`      备注: ${r.notes.join('；')}`);
  }

  const ok = rows.filter((r) => r.status === 'ok').length;
  console.log('');
  log(`验证完成：${ok}/${rows.length} 条读到真实价格（只验 1 条，其余由定时采集负责）`);
  if (ok === 0) {
    const first = rows[0] || {};
    if (first.status === 'rate_limited') {
      log('被京东限流，不代表登录失效。等几分钟后由定时任务采集，或重跑本脚本再验。');
    } else {
      log('一条都没读到 → 登录态无效或被风控，需要重新登录。');
    }
    process.exit(4);
  }
  process.exit(0);
})().catch((e) => {
  console.error('登录脚本异常：', e.message);
  process.exit(1);
});
