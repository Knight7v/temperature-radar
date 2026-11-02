'use strict';

/**
 * 从已登录的浏览器配置目录里「收割」登录态，写入 data/price-session.json。
 *
 * 用在哪：扫码其实成功了，但登录脚本没认出来（比如京东换了 cookie 名），
 * 此时不必让用户重扫一次——浏览器 profile 里的 cookie 还在，直接读出来即可。
 *
 * 用法：node scripts/price-session-save.js
 * 前提：没有别的 Chrome 占用 data/price-browser（否则 profile 被锁）。
 */

const path = require('path');
const { chromium } = require('playwright');
const session = require('../lib/price/session');

(async () => {
  const ctx = await chromium.launchPersistentContext(session.PROFILE_DIR, {
    channel: 'chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });

  // 必须走一次 jd.com，才能拿到挂在该域下的 cookie
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://www.jd.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const state = await ctx.storageState();
  state.__savedAt = new Date().toISOString();

  // ⚠️ 别用"cookie 名出现过"来判断：thor 会散落在 yiyaojd / jdcloud / jingxi 等子域，
  // 主域 jd.com 的那个没了照样会被误判成已登录（价格其实是打码的）。
  // 统一交给 session.checkSession() 用主域口径判断。
  const probe = session.writeSession(state);
  const check = session.checkSession();
  if (!check.ok) {
    const mainNames = (state.cookies || [])
      .filter((c) => String(c.domain || '').replace(/^\./, '') === 'jd.com')
      .map((c) => c.name);
    console.log('❌ 浏览器里的登录态已失效：' + check.message);
    console.log('   主域 jd.com 上的 cookie：' + (mainNames.slice(0, 20).join(', ') || '（空）'));
    await ctx.close();
    process.exit(2);
  }

  console.log(`✅ 已保存登录态：${path.relative(process.cwd(), probe)}`);
  console.log(`   共 ${state.cookies.length} 个 cookie`);
  console.log(`   状态：可用（保存于 ${check.savedAt}，已 ${check.days} 天）`);

  await ctx.close();
  process.exit(0);
})().catch((e) => {
  console.error('收割失败：', e.message);
  process.exit(1);
});
