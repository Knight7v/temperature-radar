'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Report = require('../lib/daily-report');

const DAY = '2026-10-29';
const PREV = '2026-10-28';

function shop(name, extra = {}) { return { id: 'shop-' + name, data: { name, openDate: '2026-01-01', ...extra } }; }

/* 假 db：按 SQL 特征路由返回固定数据 */
function fakeDb({ shops, dayRows, prevRows, monthRows, targets, coverage, qualitySessions }) {
  return {
    async query(sql, args = []) {
      if (sql.includes('FROM sales_shops')) return { rows: shops };
      if (sql.includes('MIN(date)')) return { rows: coverage };
      if (sql.includes('FROM sales_daily')) {
        if (sql.includes('BETWEEN')) return { rows: monthRows };
        if (args[1] === DAY) return { rows: dayRows };
        if (args[1] === PREV) return { rows: prevRows };
        throw Error('unexpected daily args ' + JSON.stringify(args));
      }
      if (sql.includes('FROM sales_targets')) return { rows: targets };
      if (sql.includes('quality_sessions')) return { rows: [{ n: qualitySessions }] };
      throw Error('unexpected sql: ' + sql.slice(0, 60));
    }
  };
}

const SCENARIO = {
  shops: [shop('格力旗舰店'), shop('海尔专卖店'), shop('喵速达'), shop('已闭店', { closeDate: '2026-06-30' })],
  coverage: [
    { shop_id: 'shop-格力旗舰店', from_date: '2026-10-01', to_date: DAY },
    { shop_id: 'shop-海尔专卖店', from_date: '2026-10-01', to_date: '2026-10-27' },
    { shop_id: 'shop-喵速达', from_date: '2026-10-01', to_date: DAY }
  ],
  dayRows: [{ shop_id: 'shop-格力旗舰店', cents: '1000000' }],
  prevRows: [{ shop_id: 'shop-格力旗舰店', cents: '800000' }],
  monthRows: [
    { shop_id: 'shop-格力旗舰店', date: '2026-10-01', cents: '2000000' },
    { shop_id: 'shop-格力旗舰店', date: DAY, cents: '1000000' }
  ],
  targets: [{ shop_id: 'shop-格力旗舰店', cents: '30000000' }, { shop_id: 'shop-海尔专卖店', cents: '20000000' }],
  qualitySessions: 12
};

test('北京时区的今天与昨天', () => {
  // UTC 17:30 = 北京次日 01:30：今天已经是 31 号，昨天是 30 号
  assert.equal(Report.beijingToday(new Date('2026-10-30T17:30:00Z')), '2026-10-31');
  assert.equal(Report.reportDateFor(new Date('2026-10-30T17:30:00Z')), '2026-10-30');
  // UTC 15:00 = 北京 23:00：昨天是 29 号
  assert.equal(Report.reportDateFor(new Date('2026-10-30T15:00:00Z')), '2026-10-29');
});

test('日报聚合：销售额 / 环比 / 缺数据 / 零销售 / 闭店剔除', async () => {
  const report = await Report.buildDailyReport(fakeDb(SCENARIO), 'tenant-1', DAY);
  assert.equal(report.sales.totalCents, 1000000);
  assert.equal(report.sales.prevTotalCents, 800000);
  // 海尔专卖店当天在经营期但数据窗口没到那天 → 未导入
  assert.deepEqual(report.sales.missing, ['海尔专卖店']);
  // 喵速达窗口覆盖到当天但没有行 → 零销售，不算缺数据
  assert.deepEqual(report.sales.zero, ['喵速达']);
  // 已闭店不出现
  const names = report.sales.shops.map(s => s.name);
  assert.ok(names.includes('格力旗舰店') && names.includes('喵速达'));
  assert.ok(!names.includes('已闭店'));
  // 分店排序：有销量的在前
  assert.equal(report.sales.shops[0].name, '格力旗舰店');
});

test('日报聚合：月度目标进度与时间进度', async () => {
  const report = await Report.buildDailyReport(fakeDb(SCENARIO), 'tenant-1', DAY);
  assert.equal(report.month.totalCents, 3000000);
  assert.equal(report.month.targetCents, 50000000);
  assert.ok(Math.abs(report.month.rate - 0.06) < 1e-9);
  // 数据截止到 29 号 → 时间进度 29/31
  assert.equal(report.month.elapsedDays, 29);
  assert.equal(report.month.monthDays, 31);
  assert.equal(report.service.sessions, 12);
});

test('企微 markdown：关键段落齐全且不超 4096 字节', async () => {
  const report = await Report.buildDailyReport(fakeDb(SCENARIO), 'tenant-1', DAY);
  const md = Report.buildWecomMarkdown(report);
  assert.ok(md.includes('观星台日报 · 2026-10-29'));
  assert.ok(md.includes('昨日销售额 ¥10,000'));
  assert.ok(md.includes('+25.0%'));
  assert.ok(md.includes('本月目标进度'));
  assert.ok(md.includes('格力旗舰店：¥10,000'));
  assert.ok(md.includes('缺数据提醒'));
  assert.ok(md.includes('海尔专卖店：未导入'));
  assert.ok(md.includes('零销售'));
  assert.ok(md.includes('客服会话 12 通'));
  assert.ok(Buffer.byteLength(md, 'utf8') <= 4096);
});

test('金额格式化', () => {
  assert.equal(Report.fmtMoney(1234500), '12,345');
  assert.equal(Report.fmtMoney(0), '0');
  assert.equal(Report.fmtPct(0.1234), '12.3%');
  assert.equal(Report.fmtPct(null), null);
});
