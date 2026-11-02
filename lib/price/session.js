'use strict';

/**
 * 京东登录态管理。
 *
 * 为什么必须要有它：京东商品页自 2025 年起对未登录访客隐藏价格（页面里是 "3??8"
 * 这种打码值，并显示"登录查看价格"），所以不带登录态采集器只能拿到标题和店铺名。
 *
 * 约定：
 * - 登录态存 data/price-session.json（Playwright storageState 格式），**不入库、不进 git、不写日志**。
 * - 只取 jd.com 域下的 cookie；对外只暴露 cookieHeader() 的结果。
 * - 失效不静默：调用方拿到 null/过期标记后，必须把采集结果标成 need_login，页面显示"登录已失效"。
 */

const fs = require('fs');
const path = require('path');

const SESSION_PATH = path.join(__dirname, '..', '..', 'data', 'price-session.json');
const PROFILE_DIR = path.join(__dirname, '..', '..', 'data', 'price-browser');

/**
 * 京东登录态关键 cookie。
 *
 * 2026-10-31 实测：京东新版登录页扫码成功后**不再下发 pt_key/pt_pin**，
 * 改由 thor + pin（配合 unick / pinId）承载登录身份。
 * 只认 pt_key 会导致"扫码明明成功、脚本却一直空等"，因此两套都认，满足任一套即视为已登录。
 * 旧 cookie 名保留，是因为部分老会话与移动页面仍可能继续下发。
 */
const AUTH_COOKIE_SETS = [
  ['pt_key', 'pt_pin'],
  ['thor', 'pin']
];
const AUTH_COOKIES = AUTH_COOKIE_SETS[0]; // 兼容旧引用

/** 固定收货地区，保证价格口径可复现（北京，京东默认仓） */
const AREA_COOKIE = 'area=1_72_2799_0';

function readSession() {
  try {
    const raw = fs.readFileSync(SESSION_PATH, 'utf8');
    const state = JSON.parse(raw);
    if (!state || !Array.isArray(state.cookies)) return null;
    return state;
  } catch (e) {
    return null;
  }
}

function writeSession(state) {
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2));
  try {
    fs.chmodSync(SESSION_PATH, 0o600);
  } catch (e) {
    /* 权限收紧失败不影响使用 */
  }
  return SESSION_PATH;
}

function cookiesOf(state) {
  if (!state || !Array.isArray(state.cookies)) return [];
  return state.cookies.filter((c) => c && typeof c.name === 'string' && /jd\.com$/.test(String(c.domain || '').replace(/^\./, '')));
}

/**
 * 判断"真的登录了"有个坑（2026-11-02 踩到）：
 * 浏览器 profile 里 thor 会散落在 yiyaojd.com / jdcloud.com / jingxi.com 等一堆子域上，
 * 只要按"cookie 名出现过"来判断，就会得出"已登录"——但真正决定价格能不能解密的是
 * **主域 jd.com 上的那一个**。那天的情况是：所有子域 thor 都在（有效期到 2027 年），
 * 主域的 thor 已经没了，于是页面能打开、标题店铺都能读，价格却是打码的。
 * 所以鉴权 cookie 必须在主域 jd.com 上凑齐才算数。
 */
const MAIN_DOMAIN = 'jd.com';

function mainDomainCookies(state) {
  return cookiesOf(state).filter((c) => String(c.domain || '').replace(/^\./, '') === MAIN_DOMAIN);
}

function hasAuthCookies(state) {
  const names = new Set(mainDomainCookies(state).map((c) => c.name));
  return AUTH_COOKIE_SETS.some((set) => set.every((n) => names.has(n)));
}

/** 返回可直接放进请求头的 cookie 串；没登录态返回 null */
function cookieHeader(state) {
  const st = state || readSession();
  if (!st || !hasAuthCookies(st)) return null;
  const list = cookiesOf(st).map((c) => `${c.name}=${c.value}`);
  if (!list.some((x) => x.startsWith('area='))) list.push(AREA_COOKIE);
  return list.join('; ');
}

/** 登录态是否可用：存在 + 有鉴权 cookie + 未超过 30 天（京东通常 1~4 周失效） */
function checkSession() {
  const state = readSession();
  if (!state) return { ok: false, reason: 'missing', message: '尚未登录京东（缺 data/price-session.json），请运行 node scripts/price-login.js' };
  if (!hasAuthCookies(state)) return { ok: false, reason: 'invalid', message: '登录态已失效（主域 jd.com 上没有 thor / pt_key），价格会是打码的，请双击「启动比价登录.command」重新扫码' };
  const savedAt = state.__savedAt ? new Date(state.__savedAt) : fs.statSync(SESSION_PATH).mtime;
  const days = (Date.now() - savedAt.getTime()) / 86400000;
  if (days > 30) {
    return { ok: false, reason: 'stale', message: `登录态已保存 ${Math.floor(days)} 天，京东通常 1~4 周失效，请重新扫码` };
  }
  return { ok: true, savedAt: savedAt.toISOString(), days: Math.round(days * 10) / 10 };
}

module.exports = {
  SESSION_PATH,
  PROFILE_DIR,
  AUTH_COOKIES,
  AUTH_COOKIE_SETS,
  readSession,
  writeSession,
  hasAuthCookies,
  cookieHeader,
  checkSession
};
