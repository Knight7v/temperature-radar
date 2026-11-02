'use strict';
/* 每日经营日报（P0-A）：昨天卖了多少、本月目标跑到哪、哪些店缺数据。
 * 聚合口径与销售页同源（js/sales-lifecycle + sales_daily/sales_targets）：
 *   · 参与口径的店 = 当天在经营期内的店（开/闭店当天都算营业）；
 *   · 零销售日记 0：日期落在该店已有数据的窗口内 → 记 0，不算缺数据；
 *   · 窗口外没数（尤其是窗口还没导到那天）→ 记「未导入」，进缺数据提醒。
 * 纯函数 + db 参数注入，方便 node --test 直接测。
 */
const fs = require('node:fs');
const path = require('node:path');
const Life = require('../js/sales-lifecycle');

let ready;
function ensureDailyReportSchema() {
  if (!ready) ready = getPool().query(fs.readFileSync(path.join(__dirname, 'db/migrations/0016_daily_reports.sql'), 'utf8')).catch(error => { ready = null; throw error; });
  return ready;
}
/* 延迟取池子：直接 require db 客户端会把连接池提前建出来，测试（env -u DATABASE_URL）会被卡 */
let poolRef = null;
function getPool() {
  if (!poolRef) poolRef = require('./db/inventory-client').getInventoryPool();
  return poolRef;
}

const YUAN = cents => Math.round(Number(cents || 0)) / 100;
const fmtMoney = cents => {
  const yuan = Number(cents || 0) / 100;
  return yuan.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const fmtPct = rate => rate == null || !Number.isFinite(Number(rate)) ? null : (Number(rate) * 100).toFixed(1) + '%';

/* 北京时区的「昨天」。服务器可能在任意时区，一律按 +08:00 折算 */
function beijingToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function reportDateFor(now = new Date()) {
  const today = beijingToday(now);
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function monthDaysOf(date) {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/* 组装某天的日报数据。date=YYYY-MM-DD（通常是昨天） */
async function buildDailyReport(db, tenant, date) {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Object.assign(Error('日期格式应为 YYYY-MM-DD'), { status: 422 });
  const prev = (() => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  const month = day.slice(0, 7);
  const monthStart = month + '-01';

  const shops = (await db.query('SELECT id,data FROM sales_shops WHERE tenant_id=$1', [tenant])).rows;
  const coverage = new Map(
    (await db.query('SELECT shop_id,MIN(date)::text AS from_date,MAX(date)::text AS to_date FROM sales_daily WHERE tenant_id=$1 GROUP BY shop_id', [tenant]))
      .rows.map(r => [r.shop_id, { from: r.from_date, to: r.to_date }])
  );
  const dayRows = (await db.query('SELECT shop_id,cents::text FROM sales_daily WHERE tenant_id=$1 AND date=$2', [tenant, day])).rows;
  const prevRows = (await db.query('SELECT shop_id,cents::text FROM sales_daily WHERE tenant_id=$1 AND date=$2', [tenant, prev])).rows;
  const monthRows = (await db.query('SELECT shop_id,date::text,cents::text FROM sales_daily WHERE tenant_id=$1 AND date BETWEEN $2 AND $3', [tenant, monthStart, day])).rows;
  const monthTargets = new Map(
    (await db.query('SELECT shop_id,cents::text FROM sales_targets WHERE tenant_id=$1 AND period=$2', [tenant, month])).rows.map(r => [r.shop_id, Number(r.cents)])
  );

  const dayCents = new Map(dayRows.map(r => [r.shop_id, Number(r.cents)]));
  const prevCents = new Map(prevRows.map(r => [r.shop_id, Number(r.cents)]));

  const shopRows = [];
  const missing = [];
  const zero = [];
  for (const shop of shops) {
    if (!Life.isOpenOn(shop, day)) continue;
    const name = shop.data.name || shop.data.shopId || shop.id;
    const cents = dayCents.get(shop.id) || 0;
    const cov = coverage.get(shop.id);
    if (!dayCents.has(shop.id) && (!cov || day < cov.from || day > cov.to)) {
      missing.push(name);
    } else if (!dayCents.has(shop.id)) {
      zero.push(name);
    }
    shopRows.push({
      name,
      cents,
      prevCents: prevCents.get(shop.id) || 0,
      targetCents: monthTargets.has(shop.id) ? monthTargets.get(shop.id) : null
    });
  }
  shopRows.sort((a, b) => b.cents - a.cents);

  const monthTotal = monthRows.reduce((sum, r) => sum + Number(r.cents), 0);
  const monthTarget = [...monthTargets.values()].reduce((sum, v) => sum + Number(v || 0), 0) || null;
  /* 时间进度 = 数据截止日号 / 当月天数（与首页同口径） */
  const cutoff = monthRows.reduce((max, r) => r.date > max ? r.date : max, monthStart);
  const elapsed = Number(cutoff.slice(8, 10));
  const monthDays = monthDaysOf(day);

  let service = null;
  try {
    const row = (await db.query("SELECT count(*)::int AS n FROM quality_sessions WHERE tenant_id=$1 AND left(started_at,10)=$2", [tenant, day])).rows[0];
    service = { sessions: Number(row && row.n) || 0 };
  } catch { service = null; }

  return {
    date: day,
    prevDate: prev,
    generatedAt: new Date().toISOString(),
    sales: {
      totalCents: dayRows.reduce((sum, r) => sum + Number(r.cents), 0),
      prevTotalCents: prevRows.reduce((sum, r) => sum + Number(r.cents), 0),
      shops: shopRows,
      missing,
      zero
    },
    month: {
      month,
      totalCents: monthTotal,
      targetCents: monthTarget,
      rate: monthTarget ? monthTotal / monthTarget : null,
      elapsedDays: Math.min(elapsed, monthDays),
      monthDays
    },
    service
  };
}

/* ===== 企微 markdown（上限 4096 字节，超长截断） ===== */
const MAX_BYTES = 4096;
function compose(blocks) {
  const lines = [];
  for (const block of blocks) {
    if (block && block.length) { lines.push(...block); lines.push(''); }
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}
function buildWecomMarkdown(report) {
  const r = report || {};
  const sales = r.sales || {}, month = r.month || {};
  const blocks = [];
  blocks.push(['## 🌅 观星台日报 · ' + (r.date || '')]);

  const total = fmtMoney(sales.totalCents);
  const prev = Number(sales.prevTotalCents || 0);
  let delta = '';
  if (prev > 0 && sales.totalCents != null) {
    const pct = (sales.totalCents - prev) / prev * 100;
    delta = '（前日 ' + fmtMoney(prev) + '，' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%）';
  }
  blocks.push(['**昨日销售额 ¥' + total + '**' + delta]);

  if (month.month) {
    const rate = fmtPct(month.rate);
    const lines = ['**本月目标进度**：¥' + fmtMoney(month.totalCents) + ' / ' + (month.targetCents ? '¥' + fmtMoney(month.targetCents) : '未设置') + (rate ? '（' + rate + '）' : '')];
    lines.push('时间进度 ' + month.elapsedDays + '/' + month.monthDays + ' 天');
    blocks.push(lines);
  }

  const shops = (sales.shops || []).filter(s => s.cents > 0);
  if (shops.length) {
    const lines = ['### 🏬 分店销量'];
    for (const s of shops.slice(0, 12)) {
      lines.push('- ' + s.name + '：¥' + fmtMoney(s.cents));
    }
    blocks.push(lines);
  }

  if ((sales.missing || []).length) {
    blocks.push(['### ⚠️ 缺数据提醒', ...sales.missing.map(name => '- ' + name + '：未导入')]);
  }
  if ((sales.zero || []).length) {
    blocks.push(['<font color="comment">零销售：' + sales.zero.join('、') + '</font>']);
  }

  if (r.service && r.service.sessions != null) {
    blocks.push(['💬 客服会话 ' + r.service.sessions + ' 通']);
  }
  blocks.push(['<font color="comment">来自观星台 · 完整看板见工作台首页</font>']);
  return capBytes(compose(blocks));
}
function capBytes(content) {
  if (Buffer.byteLength(content, 'utf8') <= MAX_BYTES) return content;
  const note = '\n<font color="comment">(内容过长已截断)</font>';
  const budget = MAX_BYTES - Buffer.byteLength(note, 'utf8');
  let out = '';
  for (const ch of content) {
    if (Buffer.byteLength(out + ch, 'utf8') > budget) break;
    out += ch;
  }
  return out + note;
}

async function pushToWecom(webhook, content) {
  const resp = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { content } })
  });
  let data = {};
  try { data = await resp.json(); } catch { /* 非 JSON 响应 */ }
  if (!resp.ok || data.errcode !== 0) {
    throw new Error('企业微信推送失败: ' + (data.errmsg || 'HTTP ' + resp.status));
  }
}

module.exports = {
  ensureDailyReportSchema, buildDailyReport, buildWecomMarkdown, pushToWecom,
  reportDateFor, beijingToday, fmtMoney, fmtPct
};
