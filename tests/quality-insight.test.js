const { test } = require('node:test');
const assert = require('node:assert/strict');

const { VERSION, TOPICS, GAP_TYPES, TOPIC_MAP, GAP_MAP } = require('../lib/quality/insight/taxonomy');
const { normalizeInsight } = require('../lib/quality/insight/verify');
const { aggregate } = require('../lib/quality/insight/aggregate');
const { compactFacts } = require('../lib/quality/insight/report');
const { buildMessages } = require('../lib/quality/insight/prompt');

const session = {
  agent: '格力旗舰店售前-婷婷',
  startedAt: '2026-03-25 15:33:21',
  endedAt: '2026-03-25 15:40:14',
  messages: [
    { id: 0, role: 'customer', at: '2026-03-25 15:33:21', text: '天仪跟云佳什么区别' },
    { id: 1, role: 'agent', at: '2026-03-25 15:34:00', text: '您好~欢迎光临京东格力旗舰店~' },
    { id: 2, role: 'agent', at: '2026-03-25 15:34:32', text: '云佳PRO有wifi，天仪只能遥控器' },
    { id: 3, role: 'customer', at: '2026-03-25 15:35:12', text: '那国补能补多少，我手机号 13812345678' },
    { id: 4, role: 'customer', at: '2026-03-25 15:36:12', text: '在吗' }
  ]
};

const goodRaw = () => ({
  stage: 'pre_sale',
  outcome: 'pending',
  mood: 'neutral',
  questions: [
    { text: '天仪和云佳有什么区别', messageId: 0, topic: 'selection', stage: 'pre_sale', repeat: false, answered: 'yes', gapTypes: [], gapDetail: '', evidenceMessageId: 2 },
    { text: '国补能补多少钱', messageId: 3, topic: 'subsidy', stage: 'pre_sale', repeat: false, answered: 'no', gapTypes: ['no_reply'], gapDetail: '顾客问了补贴金额，客服没有再回复', evidenceMessageId: 4 }
  ],
  concerns: ['subsidy', 'price'],
  summary: '顾客比较两款机型并询问国补额度，后半段无人应答',
  coaching: '顾客问补贴时要以会话结束前的明确答复收口'
});

test('口径版本与枚举自洽', () => {
  assert.equal(VERSION, 'consumer-insight-v1');
  const ids = TOPICS.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const gap of GAP_TYPES) assert.ok(['high', 'medium', 'low'].includes(gap.severity));
  assert.ok(TOPIC_MAP.has('subsidy'));
  assert.ok(GAP_MAP.has('no_reply'));
});

test('正常输出被完整保留并统计', () => {
  const result = normalizeInsight(goodRaw(), session);
  assert.equal(result.stage, 'pre_sale');
  assert.equal(result.questions.length, 2);
  assert.equal(result.stats.questionCount, 2);
  assert.equal(result.stats.unresolvedCount, 1);
  assert.deepEqual(result.stats.gapTypes, ['no_reply']);
  assert.equal(result.skipped, false);
  assert.equal(result.questions[1].evidenceMessageId, 4);
});

test('顾客原文里的手机号被等长脱敏', () => {
  const raw = goodRaw();
  raw.questions[1].text = '国补能补多少，我的号码13812345678';
  const result = normalizeInsight(raw, session);
  assert.ok(!JSON.stringify(result).includes('13812345678'));
  assert.ok(result.questions[1].text.includes('***********'));
});

test('messageId 不存在时回落到真实顾客消息，绝不凭空造问题', () => {
  const raw = goodRaw();
  raw.questions[0].messageId = 999;
  const result = normalizeInsight(raw, session);
  const ids = session.messages.filter(item => item.role === 'customer').map(item => item.id);
  for (const question of result.questions) assert.ok(ids.includes(question.messageId));
});

test('答了一半但没给缺陷类型时落到“未说明不足”并标记待复核', () => {
  const raw = goodRaw();
  raw.questions[0].answered = 'partial';
  raw.questions[0].gapTypes = [];
  const result = normalizeInsight(raw, session);
  const first = result.questions.find(item => item.topic === 'selection');
  assert.deepEqual(first.gapTypes, ['unclassified']);
  assert.equal(first.needsReview, true);
  assert.equal(result.stats.unresolvedCount, 2);
});

test('未知主题与未知缺陷被清洗，不污染统计', () => {
  const raw = goodRaw();
  raw.questions[0].topic = 'made_up_topic';
  raw.questions[1].gapTypes = ['made_up_gap'];
  const result = normalizeInsight(raw, session);
  assert.equal(result.questions[0].topic, 'other');
  assert.deepEqual(result.questions[1].gapTypes, ['unclassified']);
});

test('同一问题重复输出只留一条，且最多 6 条', () => {
  const raw = goodRaw();
  raw.questions = [
    ...raw.questions,
    { text: '天仪和云佳有什么区别', messageId: 0, topic: 'selection', stage: 'pre_sale', answered: 'yes', gapTypes: [] },
    ...Array.from({ length: 8 }, (_, index) => ({ text: `问题${index}`, messageId: 3, topic: 'price', stage: 'pre_sale', answered: 'yes', gapTypes: [] }))
  ];
  const result = normalizeInsight(raw, session);
  assert.ok(result.questions.length <= 6);
  assert.equal(result.questions.filter(item => item.text === '天仪和云佳有什么区别').length, 1);
});

test('没有顾客发言的会话标为跳过，不产生问题', () => {
  const silent = { agent: 'x', messages: [{ id: 0, role: 'agent', text: '您好' }] };
  const result = normalizeInsight(goodRaw(), silent);
  assert.equal(result.skipped, true);
  assert.equal(result.stage, 'none');
  assert.equal(result.questions.length, 0);
});

test('模型答不出问题时用顾客原话兜底，会话不会凭空消失', () => {
  const linkOnly = {
    agent: 'x',
    messages: [
      { id: 0, role: 'customer', text: 'https://item.jd.com/10193268054866.html' },
      { id: 1, role: 'agent', text: '您好，这款有货' }
    ]
  };
  const result = normalizeInsight({ questions: [] }, linkOnly);
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].answered, 'unknown');
  assert.equal(result.questions[0].messageId, 0);
});

test('汇总：阶段、主题、缺陷、按客服都算对', () => {
  const rows = [
    { sessionId: 'a', agent: '小A', startedAt: '2026-03-25 10:00:00', data: normalizeInsight(goodRaw(), session) },
    {
      sessionId: 'b',
      agent: '小B',
      startedAt: '2026-03-25 11:00:00',
      data: normalizeInsight(
        {
          stage: 'after_sale',
          outcome: 'unresolved',
          mood: 'angry',
          questions: [
            { text: '安装师傅什么时候上门', messageId: 3, topic: 'install_booking', stage: 'after_sale', answered: 'no', gapTypes: ['no_close', 'slow'], gapDetail: '只说会反馈，没说时间', evidenceMessageId: 4 }
          ],
          concerns: ['timing'],
          summary: '顾客催安装进度'
        },
        session
      )
    }
  ];
  const stats = aggregate(rows);

  assert.equal(stats.sessions, 2);
  assert.equal(stats.questions.total, 3);
  assert.equal(stats.questions.unresolved, 2);
  assert.equal(stats.questions.partial, 0);
  assert.equal(stats.questions.no, 2);
  assert.equal(stats.questions.unresolvedRate, 66.7);
  assert.equal(stats.stages.find(item => item.id === 'pre_sale').sessions, 1);
  assert.equal(stats.stages.find(item => item.id === 'after_sale').sessions, 1);
  assert.equal(stats.topics.find(item => item.id === 'subsidy').label, '国补与以旧换新');
  assert.equal(stats.topics.find(item => item.id === 'install_booking').questions, 1);
  assert.equal(stats.sessionsWithGap, 2);
  assert.equal(stats.gaps.find(item => item.id === 'no_close').severity, 'high');
  assert.equal(stats.agents.length, 2);
  assert.equal(stats.open.length, 2);
  assert.equal(stats.open[0].gapTypes[0], 'no_close');
  assert.ok(stats.signature);
});

test('汇总：空数据不报错，比例为空而不是 0', () => {
  const stats = aggregate([]);
  assert.equal(stats.sessions, 0);
  assert.equal(stats.questions.unresolvedRate, null);
  assert.deepEqual(stats.topics, []);
  assert.equal(stats.openTotal, 0);
});

test('给模型的输入包含分类口径与原文编号', () => {
  const built = buildMessages({ session });
  const user = built.messages[1].content;
  assert.ok(user.includes('subsidy = 国补与以旧换新'));
  assert.ok(user.includes('no_reply = 未回复'));
  assert.ok(user.includes('[#3][顾客]'));
  assert.equal(built.messages[0].role, 'system');
});

test('总结只喂统计数据，原文样本有上限', () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    sessionId: `s${index}`,
    agent: '小A',
    startedAt: '2026-03-25 10:00:00',
    data: normalizeInsight(goodRaw(), session)
  }));
  const stats = aggregate(rows);
  const facts = compactFacts(stats, { scope: 'date=all' });
  assert.equal(facts.sessions, 40);
  assert.ok(facts.topics.length <= 12);
  assert.ok(facts.openSamples.length <= 15);
  assert.ok(facts.topics.every(item => item.samples.length <= 2));
});
