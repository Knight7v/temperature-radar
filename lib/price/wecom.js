'use strict';

/**
 * 比价告警的企业微信推送。
 *
 * 复用库存模块的机器人配置（inventory_push_config.data.webhookUrlEnc，加密存），
 * 不另建一套 webhook 配置，避免运维要维护两个机器人。
 *
 * 推送口径（2026-10-30 用户确认）：
 *   - 日常只发**一条汇总**，不逐条刷屏
 *   - 只有「明显击穿」（差 ≥5 元 或 ≥2.5%）才在汇总里单独高亮成一行
 *   - 已回升的机型合并成一句"↑ 已回升 N 个"，不单独弹
 */

const { getInventoryPool } = require('../db/inventory-client');
const { decryptWebhook, createWecomClient } = require('../inventory/wecom');

const BIG_GAP_YUAN = 5;
const BIG_GAP_RATE = 0.025;

function money(n) {
  if (n == null) return '—';
  return '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** 命中行的价差/比例（view.buildHits 只给两端价格，不重复存派生值） */
function gapOf(hit) {
  const my = Number(hit.my);
  const comp = Number(hit.comp);
  if (!Number.isFinite(my) || !Number.isFinite(comp) || my <= 0) return { gap: 0, rate: 0 };
  const gap = Math.round((my - comp) * 100) / 100;
  return { gap, rate: Math.round((gap / my) * 10000) / 100 };
}

function nameOf(hit) {
  const parts = [hit.brand === 'gree' ? '格力' : hit.brand === 'haier' ? '海尔' : hit.brand || '', hit.series, hit.cap]
    .filter(Boolean);
  return parts.join(' ') || hit.id;
}

function isBigGap(hit) {
  const { gap, rate } = gapOf(hit);
  return gap >= BIG_GAP_YUAN || rate >= BIG_GAP_RATE * 100;
}

/**
 * 生成汇总文案。hits 来自 view.buildHits（页面同一份数据），保证「群里看到的」和「页面看到的」一致。
 */
function formatDigest({ day, hits = [], summary = {}, status = {} }) {
  const lines = [];
  lines.push(`## 比价日报 ${day || ''}`.trim());
  lines.push('');

  if (!hits.length) {
    lines.push('今日未发现竞品到手价低于我方。');
  } else {
    // 口径写清楚：群里这个数必须是「顾客真正要掏的钱」，不是页面标价
    lines.push(`**命中 ${hits.length} 个机型**（到手价 = 标价 − 券 − 国补）`);
    lines.push('');
    const big = hits.filter(isBigGap);
    const rest = hits.filter((h) => !isBigGap(h));
    for (const h of big.slice(0, 8)) {
      const { gap, rate } = gapOf(h);
      lines.push(`> **${nameOf(h)}** 我方 ${money(h.my)} ← 竞品 ${money(h.comp)}　低 ${money(gap)}（${rate.toFixed(2)}%）`);
      // h.lowerCount 语义 = 除最低那家之外，还有几家也低于我方价（view 里复用的是 otherLower）
      lines.push(`> 最低来自「${h.shop || '未知店铺'}」${h.lowerCount > 0 ? `，另有 ${h.lowerCount} 家更低` : ''}`);
    }
    if (rest.length) {
      lines.push('');
      lines.push(`其余 ${rest.length} 个机型小幅低于我方价：`);
      for (const h of rest.slice(0, 10)) {
        const { gap, rate } = gapOf(h);
        lines.push(`- ${nameOf(h)}：低 ${money(gap)}（${rate.toFixed(2)}%）· ${h.shop || ''}`);
      }
      if (rest.length > 10) lines.push(`- …… 还有 ${rest.length - 10} 个，见工作台「比价助手」`);
    }
    // 竞品没有国补资格时我们只能按券后价比 → 算出来的到手价偏高，属"可能少报"，必须讲出来
    const lowCount = hits.filter((h) => h.confidence === 'low').length;
    if (lowCount) {
      lines.push('');
      lines.push(`ℹ️ 其中 ${lowCount} 个机型的竞品无国补或优惠券未取全，按券后价计，实际可能更低（只会漏报，不会虚报）`);
    }
  }

  if (summary && (summary.recovered || summary.missing)) {
    lines.push('');
    if (summary.recovered) lines.push(`↑ 已回升 ${summary.recovered} 个（已自动关闭告警）`);
    if (summary.missing) lines.push(`⚠️ ${summary.missing} 条链接本轮没采到，价格未更新，请勿当成"价格正常"`);
  }
  if (status.lastResult === 'partial' || status.lastResult === 'blocked') {
    lines.push(`⚠️ 本轮采集状态：${status.lastResult === 'blocked' ? '被风控中断' : '部分失败'}${status.loginNote ? '（' + status.loginNote + '）' : ''}`);
  }
  lines.push('');
  lines.push('[打开比价助手](http://127.0.0.1:41873/price.html)');
  return lines.join('\n');
}

/**
 * 找企业微信机器人地址。按顺序找，找到就用：
 *   ① 环境变量（PRICE_WECOM_WEBHOOK → DAILY_REPORT_WEBHOOK → WECOM_BOT_WEBHOOK）
 *      —— 这是本项目实际在用的那一个，气温推送、经营日报都走它；
 *   ② 库存模块入库加密存的 webhook（需要 INVENTORY_WEBHOOK_ENCRYPTION_KEY 才能解）。
 *
 * 教训（2026-11-02）：原来只走 ②，而这台机器上 ② 是空的、密钥也没配，
 * 结果采集判价都成功、推送静默不发，日志里只有一行「未配置机器人」。
 * 所以改成先读环境变量，DB 只当兜底。
 */
function envWebhook() {
  const keys = ['PRICE_WECOM_WEBHOOK', 'DAILY_REPORT_WEBHOOK', 'WECOM_BOT_WEBHOOK'];
  for (const k of keys) {
    const v = String(process.env[k] || '').trim();
    if (v) return v;
  }
  return '';
}

async function resolveWebhook(tenantId) {
  const direct = envWebhook();
  if (direct) return direct;
  try {
    const db = getInventoryPool();
    const r = await db.query('SELECT data FROM inventory_push_config WHERE tenant_id=$1', [tenantId]);
    const enc = r.rows[0] && r.rows[0].data && r.rows[0].data.webhookUrlEnc;
    if (!enc) return null;
    return decryptWebhook(enc, process.env.INVENTORY_WEBHOOK_ENCRYPTION_KEY);
  } catch (e) {
    return null;
  }
}

/**
 * 发一条汇总。返回 { sent, reason }
 * 宁可发不出去也不抛异常：推送失败不能影响采集和判价已经写进库的事实。
 */
async function sendDigest(tenantId, payload) {
  const webhook = await resolveWebhook(tenantId);
  if (!webhook) return { sent: false, reason: '未配置企业微信机器人：在 .env.local 填 WECOM_BOT_WEBHOOK（或 PRICE_WECOM_WEBHOOK）后重启服务' };
  const content = formatDigest(payload);
  try {
    await createWecomClient({ webhook }).sendMarkdown(content);
    return { sent: true, content };
  } catch (e) {
    return { sent: false, reason: String(e.message || e).slice(0, 200), content };
  }
}

module.exports = { formatDigest, sendDigest, resolveWebhook, isBigGap, gapOf, nameOf };
