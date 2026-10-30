'use strict';
/* 会话记录列表（京麦 xlsx）与聊天记录的核对规则
 * 这套逻辑一旦出错，后果是「顾客ID 挂到了别人头上」——复核时查到的是别人的对话，
 * 比没有ID 更糟。所以这里重点测「什么时候不允许匹配」。 */
const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { parseSessionList, reconcileSessions, signature, maskCustomer, timeText } = require('../lib/quality/session-list');

const session = (overrides = {}) => ({
  ordinal: 1,
  agent: '格力旗舰店售前-阿伟',
  startedAt: '2026-10-26 10:00:00',
  customerMasked: 'j****62',
  messages: [
    { role: 'customer', at: '2026-10-26 10:00:00', text: '你好' },
    { role: 'agent', at: '2026-10-26 10:00:12', text: '在的' },
    { role: 'customer', at: '2026-10-26 10:00:20', text: '什么时候发货' }
  ],
  ...overrides
});
const row = (overrides = {}) => ({
  line: 2,
  consultAt: '2026-10-26 10:00:00',
  customerId: 'jd_778cfbefb1562',
  agent: '格力旗舰店售前-阿伟',
  firstResponseAt: '2026-10-26 10:00:12',
  durationMin: 8.5,
  customerMessages: 2,
  agentMessages: 1,
  satisfaction: '',
  resolved: '-',
  cid: 'abc',
  productId: '',
  productName: '',
  ...overrides
});

test('脱敏规则：首字符 + 星号 + 末两位，中文昵称同样成立', () => {
  assert.strictEqual(maskCustomer('moto_dm'), 'm****dm');
  assert.strictEqual(maskCustomer('jd_778cfbefb1562'), 'j****62');
  assert.strictEqual(signature('m****dm'), signature('moto_dm'));
  // 中文昵称：log 里是 胡****13，列表里是 胡永林513
  assert.strictEqual(signature('胡****13'), signature('胡永林513'));
  assert.strictEqual(signature(''), '');
});

test('时间格式兼容 Excel 日期单元格与文本', () => {
  assert.strictEqual(timeText('2026-10-26 10:00'), '2026-10-26 10:00:00');
  assert.strictEqual(timeText('2026-10-26 10:00:00'), '2026-10-26 10:00:00');
  assert.strictEqual(timeText(''), '');
  assert.strictEqual(timeText('2026/10/26'), '');
});

test('掩码 + 时间 + 客服三者吻合 → 完整顾客ID 与后台统计一起落库', () => {
  const sessions = [session()];
  const report = reconcileSessions(sessions, [row()]);
  assert.strictEqual(report.exact, 1);
  assert.strictEqual(sessions[0].customerId, 'jd_778cfbefb1562');
  assert.strictEqual(sessions[0].sessionList.confidence, 'exact');
  assert.strictEqual(sessions[0].sessionList.firstResponseAt, '2026-10-26 10:00:12');
  assert.strictEqual(sessions[0].sessionList.durationMin, 8.5);
  // log 里顾客 2 条、客服 1 条，与后台一致 → 无缺口
  assert.strictEqual(sessions[0].sessionList.customerGap, 0);
  assert.strictEqual(sessions[0].sessionList.agentGap, 0);
});

test('客服名不一致仍然挂ID，但要单独标出来给人看', () => {
  const sessions = [session()];
  const report = reconcileSessions(sessions, [row({ agent: '格力旗舰店售后-鹿鹿' })]);
  assert.strictEqual(report.agentMismatch, 1);
  assert.strictEqual(sessions[0].customerId, 'jd_778cfbefb1562');
  assert.strictEqual(sessions[0].sessionList.confidence, 'agent-mismatch');
});

test('时间差超过 5 秒但仍在 60 秒内 → 挂ID 但标「需人工确认」', () => {
  const sessions = [session({ startedAt: '2026-10-26 10:00:40' })];
  const report = reconcileSessions(sessions, [row()]);
  assert.strictEqual(report.weak, 1);
  assert.strictEqual(sessions[0].sessionList.confidence, 'weak');
});

test('没有掩码时只认 5 秒内且唯一的行，宁可报没匹配也不猜', () => {
  const unique = [session({ customerMasked: '' })];
  assert.strictEqual(reconcileSessions(unique, [row()]).exact, 1);
  assert.strictEqual(unique[0].customerId, 'jd_778cfbefb1562');

  const far = [session({ customerMasked: '' })];
  const report = reconcileSessions(far, [row({ consultAt: '2026-10-26 10:00:30' })]);
  assert.strictEqual(report.unmatched, 1);
  assert.strictEqual(far[0].customerId, undefined);
});

test('多通会话抢同一行时不会重复挂同一个ID', () => {
  const sessions = [
    session({ ordinal: 1, startedAt: '2026-10-26 10:00:00' }),
    session({ ordinal: 2, startedAt: '2026-10-26 10:00:02', customerMasked: 'j****62' })
  ];
  const report = reconcileSessions(sessions, [row()]);
  assert.strictEqual(report.unmatched, 1);
  const withId = sessions.filter(item => item.customerId);
  assert.strictEqual(withId.length, 1);
  // 谁的时间更近谁拿到
  assert.strictEqual(withId[0].ordinal, 1);
});

test('log 条数少于后台统计时给出缺口，提示对话可能没导全', () => {
  const sessions = [session()];
  const report = reconcileSessions(sessions, [row({ customerMessages: 5, agentMessages: 3 })]);
  assert.strictEqual(report.gapWarnings, 1);
  assert.strictEqual(sessions[0].sessionList.customerGap, -3);
  assert.strictEqual(sessions[0].sessionList.agentGap, -2);
});

test('能读京麦导出的会话记录表，并按表头定位列', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('咨询会话查询');
  sheet.addRow(['咨询时间', '咨询类型', '客服', '顾客', '首次响应时间', '会话时长(M)', '客户消息数', '客服消息数', 'cid']);
  sheet.addRow(['2026-10-26 10:00:00', '在线咨询', '格力旗舰店售前-阿伟', 'jd_778cfbefb1562', '2026-10-26 10:00:12', 8.5, 2, 1, 'abc']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseSessionList(buffer);
  assert.strictEqual(parsed.rows.length, 1);
  assert.strictEqual(parsed.rows[0].customerId, 'jd_778cfbefb1562');
  assert.strictEqual(parsed.rows[0].customerMessages, 2);
  assert.deepStrictEqual(parsed.range, { from: '2026-10-26', to: '2026-10-26' });
});

test('缺关键列时报错，而不是悄悄按 0 行处理', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(['账号', '备注']);
  sheet.addRow(['x', 'y']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(() => parseSessionList(buffer), /咨询时间/);
});
