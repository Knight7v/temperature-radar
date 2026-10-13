const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyConversation, checksForCategories, analyzeConversation } = require('../lib/quality/intent');

const msg = (id, role, text) => ({ id, role, text, at: '2026-10-10 10:00:00' });

test('customer requests drive multi-label categories with traceable messages', () => {
  const result = classifyConversation({ messages: [
    msg(0, 'customer', '天仪Pro和云锦的APF有什么区别？'),
    msg(1, 'agent', '这款可以申请国补，赶紧下单吧'),
    msg(2, 'customer', '现在有什么优惠券和补贴？')
  ] });
  assert.deepEqual(result.categories.map(item => item.id), ['product', 'promotion']);
  assert.deepEqual(result.categories[0].messageIds, [0]);
  assert.deepEqual(result.categories[1].messageIds, [2]);
});

test('agent scripts alone do not establish customer intent; unknown stays reviewable', () => {
  const result = classifyConversation({ messages: [msg(0, 'customer', '你好'), msg(1, 'agent', '宝，喜欢就赶紧下单吧')] });
  assert.deepEqual(result.categories.map(item => item.id), ['unknown']);
  assert.equal(checksForCategories(['unknown']).some(item => item.ruleId === 'claims'), true);
});

test('category checks activate relevant rules without treating unsupported claims as violations', () => {
  const product = checksForCategories(['product']);
  assert.equal(product.some(item => item.ruleId === 'claims' && item.mode === 'external'), true);
  assert.equal(product.some(item => item.ruleId === 'complaint'), false);
  const afterSales = checksForCategories(['after_sales']);
  assert.equal(afterSales.some(item => item.ruleId === 'process'), true);
  assert.equal(afterSales.some(item => item.ruleId === 'claims' && item.mode === 'external'), true);
});

test('analysis reports first response and repeated pressure as evidence, not automatic guilt', () => {
  const session = { messages: [
    { ...msg(0, 'customer', '这款价格多少？'), at: '2026-10-10 10:00:00' },
    { ...msg(1, 'agent', '宝，喜欢就赶紧下单吧'), at: '2026-10-10 10:02:30' },
    { ...msg(2, 'customer', '我再看看'), at: '2026-10-10 10:03:00' },
    { ...msg(3, 'agent', '宝，喜欢就赶紧下单吧'), at: '2026-10-10 10:03:10' }
  ] };
  const result = analyzeConversation(session);
  assert.equal(result.metrics.firstReplySeconds, 150);
  assert.equal(result.metrics.customerTurns, 2);
  assert.equal(result.metrics.agentTurns, 2);
  assert.deepEqual(result.signals.find(item => item.code === 'repeated-pressure').messageIds, [1, 3]);
  assert.equal(result.signals.every(item => item.verdict === null), true);
});

test('policy claims require external verification and never become a machine violation', () => {
  const result = analyzeConversation({ messages: [msg(0, 'customer', '天仪Pro保修多久？'), msg(1, 'agent', '这款十年质保，安装免费')] });
  assert.equal(result.categories[0].id, 'product');
  assert.equal(result.signals.find(item => item.code === 'policy-claim').ruleId, 'claims');
  assert.equal(result.signals.find(item => item.code === 'policy-claim').verification, 'external');
  assert.equal(result.signals.some(item => item.verdict === 'issue'), false);
});
