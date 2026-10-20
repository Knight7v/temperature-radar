const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeScore } = require('../lib/quality/ai/score');
const { normalize, verifyEvidence, normalizeJudgments } = require('../lib/quality/ai/verify');
const { conversationFacts, sensitiveMentions } = require('../lib/quality/ai/facts');
const { mask, renderTranscript } = require('../lib/quality/ai/prompt');
const { applicableCriteria, gradeOf, CRITERIA } = require('../lib/quality/ai/rubric');
const client = require('../lib/quality/ai/client');
const { analyzeSession } = require('../lib/quality/ai/analyze');

const session = {
  agent: '格力旗舰店售前-01',
  startedAt: '2026-03-25 10:00:00',
  endedAt: '2026-03-25 10:09:00',
  messages: [
    { id: 0, role: 'customer', at: '2026-03-25 10:00:00', text: '这个2匹的空调多少钱？' },
    { id: 1, role: 'agent', at: '2026-03-25 10:00:20', text: '亲，您好，这款 KFR-50LW 现在活动价 3999 元，您看的是哪一款呢' },
    { id: 2, role: 'customer', at: '2026-03-25 10:01:00', text: '就这个，能便宜点吗' },
    { id: 3, role: 'agent', at: '2026-03-25 10:01:30', text: '价格已经是最低了亲' },
    { id: 4, role: 'customer', at: '2026-03-25 10:04:30', text: '我要投诉，再不解决我就打315' }
  ]
};

const allPass = () =>
  CRITERIA.map(item => ({
    id: item.id,
    kind: item.kind,
    status: 'pass',
    score: item.kind === 'standard' ? 5 : null,
    confidence: 0.9,
    reason: 'ok'
  }));

test('全部合格得 100 分', () => {
  const result = computeScore({ criteria: allPass() });
  assert.equal(result.score, 100);
  assert.equal(result.grade, 'A+');
  assert.equal(result.fatalFail, false);
});

test('关键项一项不合格 → 70 分全扣，封顶 30 分', () => {
  const criteria = allPass().map(item => (item.id === 'etiquette' ? { ...item, status: 'fail' } : item));
  const result = computeScore({ criteria });
  assert.equal(result.criticalScore, 0);
  assert.equal(result.standardScore, 30);
  assert.equal(result.score, 30);
  assert.equal(result.grade, 'D');
  assert.equal(result.failItems.length, 1);
});

test('红线命中 → 整单 0 分', () => {
  const criteria = allPass().map(item => (item.id === 'redline_abuse' ? { ...item, status: 'fail' } : item));
  const result = computeScore({ criteria });
  assert.equal(result.fatalFail, true);
  assert.equal(result.score, 0);
  assert.equal(result.grade, 'D');
});

test('非关键项按 5 分制折算 30 分', () => {
  const standard = CRITERIA.filter(item => item.kind === 'standard');
  const criteria = allPass().map(item => (item.id === standard[0].id ? { ...item, score: 3 } : item));
  const result = computeScore({ criteria });
  // 6 项：5,3,5,5,5,5 → 28/30 → 28 分
  assert.equal(result.standardScore, 28);
  assert.equal(result.score, 98);
});

test('不适用项从分母里剔除', () => {
  const standard = CRITERIA.filter(item => item.kind === 'standard');
  const criteria = allPass().map(item => (item.id === standard[0].id ? { ...item, status: 'na', score: null } : item));
  const result = computeScore({ criteria });
  assert.equal(result.score, 100);
  assert.equal(result.counts.standardNa, 1);
  assert.equal(result.counts.standardScored, standard.length - 1);
});

test('关键项待复核不算不合格，但标记 provisional 并给出最坏情况', () => {
  const criteria = allPass().map(item => (item.id === 'response' ? { ...item, status: 'pending', confidence: 0.3 } : item));
  const result = computeScore({ criteria });
  assert.equal(result.score, 100);
  assert.equal(result.provisional, true);
  assert.equal(result.worstCase, 30);
  assert.equal(result.needsReview, true);
});

test('等级阈值', () => {
  assert.equal(gradeOf(100).grade, 'A+');
  assert.equal(gradeOf(95).grade, 'A+');
  assert.equal(gradeOf(94.9).grade, 'A');
  assert.equal(gradeOf(85).grade, 'A');
  assert.equal(gradeOf(70).grade, 'B');
  assert.equal(gradeOf(69.9).grade, 'C');
  assert.equal(gradeOf(40).grade, 'C');
  assert.equal(gradeOf(39.9).grade, 'D');
  assert.equal(gradeOf(null).grade, '—');
});

test('证据校验：真实引文通过，编造引文被拒', () => {
  const byId = new Map(session.messages.map(item => [item.id, item]));
  const good = verifyEvidence([{ messageId: 1, quote: '活动价 3999 元' }], byId);
  assert.equal(good.valid.length, 1);
  assert.equal(good.rejected.length, 0);

  const bad = verifyEvidence([{ messageId: 1, quote: '这款空调明天免费送货上门' }], byId);
  assert.equal(bad.valid.length, 0);
  assert.equal(bad.rejected[0].reason, '引文与该消息原文不一致');

  const ghost = verifyEvidence([{ messageId: 99, quote: '随便' }], byId);
  assert.equal(ghost.valid.length, 0);
  assert.equal(ghost.rejected[0].reason, '消息编号不存在');
});

test('证据校验容忍空格与标点差异', () => {
  const byId = new Map(session.messages.map(item => [item.id, item]));
  const result = verifyEvidence([{ messageId: 1, quote: '亲 您好 这款KFR-50LW现在活动价3999元' }], byId);
  assert.equal(result.valid.length, 1);
});

test('不合格但没有有效证据 → 降级为待复核，不扣分', () => {
  const criteria = applicableCriteria(['pre_sale']);
  const raw = {
    categories: ['pre_sale'],
    criteria: [
      { id: 'etiquette', verdict: 'fail', confidence: 0.9, reason: '态度差', evidence: [{ messageId: 3, quote: '根本不存在的原话' }] }
    ]
  };
  const normalized = normalizeJudgments(raw, session, criteria);
  const item = normalized.criteria.find(entry => entry.id === 'etiquette');
  assert.equal(item.status, 'pending');
  assert.match(item.note, /未给出可核实的原文证据/);
  assert.equal(item.rejectedEvidence.length, 1);
});

test('不合格且证据有效 → 记为不合格', () => {
  const criteria = applicableCriteria(['complaint']);
  const raw = {
    criteria: [
      {
        id: 'complaint',
        verdict: 'fail',
        confidence: 0.92,
        reason: '顾客提到 315 未安抚',
        evidence: [{ messageId: 4, quote: '我要投诉，再不解决我就打315' }]
      }
    ]
  };
  const normalized = normalizeJudgments(raw, session, criteria);
  const item = normalized.criteria.find(entry => entry.id === 'complaint');
  assert.equal(item.status, 'fail');
  assert.equal(item.evidence.length, 1);
});

test('置信度不足的不合格也转人工', () => {
  const criteria = applicableCriteria(['complaint']);
  const raw = {
    criteria: [
      { id: 'complaint', verdict: 'fail', confidence: 0.4, reason: '可能未安抚', evidence: [{ messageId: 4, quote: '我要投诉' }] }
    ]
  };
  const normalized = normalizeJudgments(raw, session, criteria);
  assert.equal(normalized.criteria.find(entry => entry.id === 'complaint').status, 'pending');
});

test('可选会话的质检项按咨询类型裁剪', () => {
  const preSale = applicableCriteria(['pre_sale']).map(item => item.id);
  const logistics = applicableCriteria(['logistics']).map(item => item.id);
  assert.ok(preSale.includes('probing'));
  assert.ok(!logistics.includes('probing'));
  assert.ok(logistics.includes('process'));
  // 无分类时全部适用
  assert.equal(applicableCriteria(null).length, CRITERIA.length);
});

test('客观事实：首次响应与最长等待', () => {
  const facts = conversationFacts(session);
  assert.equal(facts.messageCount, 5);
  assert.equal(facts.customerTurns, 3);
  assert.equal(facts.agentTurns, 2);
  assert.equal(facts.firstAgentReplySeconds, 20);
  assert.equal(facts.maxGapSeconds, 30);
  assert.equal(facts.slowGaps.length, 0);
  assert.deepEqual(facts.unanswered, { messageId: 4, seconds: 270 });
  assert.equal(facts.hasTimestamp, true);
  assert.deepEqual(sensitiveMentions(session), [4]);
});

test('脱敏保留长度，普通文本不受影响', () => {
  assert.equal(mask('联系我13812345678'), '联系我***********');
  assert.equal(mask('这款 3999 元'), '这款 3999 元');
  const byId = new Map(session.messages.map(item => [item.id, item]));
  const result = verifyEvidence([{ messageId: 1, quote: '活动价 3999 元' }], byId);
  assert.equal(result.valid.length, 1);
});

test('长会话渲染时会截断中段并标注', () => {
  const many = { messages: Array.from({ length: 120 }, (_, i) => ({ id: i, role: i % 2 ? 'agent' : 'customer', at: '2026-03-25 10:00:00', text: '消息' + i })) };
  const rendered = renderTranscript(many);
  assert.equal(rendered.truncated, true);
  assert.match(rendered.text, /中间 40 条消息已省略/);
});

test('编排：模型输出经校验后算出分数，并累计 token 用量', async () => {
  const original = client.chatWithRetry;
  const replies = [
    { content: JSON.stringify({ categories: ['pre_sale'] }), usage: { promptTokens: 100, completionTokens: 10 }, model: 'deepseek-chat' },
    {
      content: JSON.stringify({
        categories: ['pre_sale'],
        summary: '顾客咨询价格，客服报价并拒绝让价',
        criteria: applicableCriteria(['pre_sale']).map(item => ({
          id: item.id,
          verdict: item.id === 'probing' ? 'pass' : 'pass',
          score: item.kind === 'standard' ? 5 : undefined,
          confidence: 0.9,
          reason: 'ok',
          evidence: item.kind === 'standard' ? [] : [{ messageId: 1, quote: '活动价 3999 元' }]
        })),
        overall: '主动确认面积与匹数需求'
      }),
      usage: { promptTokens: 900, completionTokens: 400 },
      model: 'deepseek-chat'
    }
  ];
  let call = 0;
  client.chatWithRetry = async () => replies[call++];
  try {
    const analysis = await analyzeSession(session);
    assert.equal(analysis.score.score, 100);
    assert.equal(analysis.usage.promptTokens, 1000);
    assert.equal(analysis.usage.completionTokens, 410);
    assert.equal(analysis.usage.calls, 2);
    assert.deepEqual(analysis.categories, ['pre_sale']);
    assert.equal(analysis.applicableCount, applicableCriteria(['pre_sale']).length);
  } finally {
    client.chatWithRetry = original;
  }
});

test('编排：分类失败不阻断，退化为全规则并给出提示', async () => {
  const original = client.chatWithRetry;
  let call = 0;
  client.chatWithRetry = async () => {
    call += 1;
    if (call === 1) throw Object.assign(Error('分类超时'), { code: 'AI_TIMEOUT' });
    return {
      content: JSON.stringify({
        categories: [],
        criteria: applicableCriteria(null).map(item => ({ id: item.id, verdict: 'pass', score: item.kind === 'standard' ? 5 : undefined, confidence: 0.9, reason: 'ok' }))
      }),
      usage: { promptTokens: 800, completionTokens: 300 },
      model: 'deepseek-chat'
    };
  };
  try {
    const analysis = await analyzeSession(session);
    assert.equal(analysis.score.score, 100);
    assert.equal(analysis.warnings.length >= 1, true);
    assert.match(analysis.warnings[0], /分类调用失败/);
    assert.equal(analysis.applicableCount, CRITERIA.length);
  } finally {
    client.chatWithRetry = original;
  }
});

test('编排：空会话直接报错', async () => {
  await assert.rejects(() => analyzeSession({ messages: [] }), /没有可分析的消息/);
});

test('归一化忽略大小写与标点', () => {
  assert.equal(normalize('亲，您好！'), normalize('亲 您好'));
});
