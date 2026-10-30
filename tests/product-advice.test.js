'use strict';
/* 卖点 ↔ 会话匹配 + 修正建议。
 * 匹配错了会给另一台机器提建议，建议错了等于用错数据教客服，所以这里重点测边界：
 * 客服话术里的通用词不算、顾客没提到的卖点不能硬扯、重复卖点只留一条。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { modelTokens, scoreSession, matchSessions, withSessionText } = require('../lib/product/match');
const {
  numbersIn,
  buildSkeleton,
  verifyAdvice,
  fallbackAdvice
} = require('../lib/product/advice');

const product = {
  group: 'gree-ac',
  model: 'KFR-35GW/NhAa1BAj',
  name: '格力 云锦Ⅱ 1.5匹 挂机',
  features: [
    { title: '自清洁', detail: '蒸发器高温杀菌，减少异味', keywords: ['自清洁', '霉味'] },
    { title: '防直吹', detail: '冷风贴天花板走', keywords: ['防直吹', '直吹'] }
  ],
  params: [{ name: '噪音', value: '21', unit: 'dB(A)' }],
  service: [{ name: '整机保修', value: '6 年' }]
};

const session = messages => ({ id: 's1', agent: '格力旗舰店售前-阿伟', startedAt: '2026-10-26 10:00:00', messages });

test('型号分词：整型号与片段都能匹配', () => {
  const tokens = modelTokens(product);
  assert.ok(tokens.includes('KFR-35GW/NHAA1BAJ'));
  assert.ok(tokens.includes('KFR35GW'));
  assert.ok(tokens.includes('NHAA1BAJ'));
});

test('匹配只看顾客说的话：客服话术里的卖点不算命中', () => {
  // 客服照着标准话术念了全部卖点，顾客只问价格 → 不应该算「在问这台机器」
  const script = session([
    { id: 1, role: 'customer', text: '这个多少钱' },
    { id: 2, role: 'agent', text: '这款带自清洁和防直吹，一级能效，21分贝静音' }
  ]);
  const scored = scoreSession(script, product);
  assert.equal(scored.score, 0);

  const realAsk = session([{ id: 1, role: 'customer', text: '这款有防直吹吗？冬天吹着冷吗' }]);
  assert.ok(scoreSession(realAsk, product).score >= 2);
});

test('型号命中直接算强关联，两个卖点关键词才过门槛', () => {
  const byModel = session([{ id: 1, role: 'customer', text: 'KFR-35GW/NhAa1BAj 有货吗' }]);
  assert.equal(scoreSession(byModel, product).modelHit, true);
  assert.ok(scoreSession(byModel, product).score >= 12);

  const weak = session([{ id: 1, role: 'customer', text: '有除湿吗' }]);
  assert.ok(scoreSession(weak, product).score < 4);

  const matched = matchSessions(withSessionText([byModel, weak]), [{ id: 'p1', ...product }]);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].sessionId, 's1');
});

test('会话摘要跳过纯链接消息', () => {
  const withLink = session([
    { id: 1, role: 'customer', text: 'https://item.jd.com/123456.html' },
    { id: 2, role: 'customer', text: '这款是防直吹的吗' }
  ]);
  const matched = matchSessions(withSessionText([withLink]), [{ id: 'p1', ...product }]);
  assert.equal(matched[0].excerpt, '这款是防直吹的吗');
});

test('骨架：顾客问到、客服没答到 → 记没答到', () => {
  const messages = [
    { id: 1, role: 'customer', text: '这款噪音大吗' },
    { id: 2, role: 'agent', text: '这款很安静的哦' }
  ];
  const skeleton = buildSkeleton({ messages, product });
  assert.equal(skeleton.items.length, 1);
  assert.equal(skeleton.items[0].facts[0].label, '噪音');
  assert.equal(skeleton.items[0].facts[0].covered, false);
  assert.equal(skeleton.stats.coverage, 0);

  const covered = buildSkeleton({
    messages: [
      { id: 1, role: 'customer', text: '这款噪音大吗' },
      { id: 2, role: 'agent', text: '室内噪音 21dB(A)，夜里基本听不到' }
    ],
    product
  });
  assert.equal(covered.items[0].facts[0].covered, true);
});

test('建议核验：顾客原话没提到的卖点，硬扯的建议一律丢掉', () => {
  const messages = [
    { id: 1, role: 'customer', text: '漏电保护器需要多少A' },
    { id: 2, role: 'agent', text: '2匹变频柜挂机需要耦合插座' }
  ];
  const skeleton = buildSkeleton({ messages, product });
  const raw = {
    summary: '测试',
    items: [
      { messageId: 1, factRef: '自清洁', verdict: 'missing', why: '没讲自清洁', suggestedReply: '这款带自清洁', severity: 'medium' }
    ]
  };
  const verified = verifyAdvice(raw, { session: { messages }, product, skeleton });
  assert.equal(verified.items.length, 0);
  assert.ok(verified.warnings.some(text => /硬扯/.test(text)));
});

test('建议核验：同一卖点只留一条；资料里没有的数字标待核实', () => {
  const messages = [
    { id: 1, role: 'customer', text: '噪音多少分贝' },
    { id: 2, role: 'agent', text: '很安静的' },
    { id: 3, role: 'customer', text: '那噪音到底多大，保修几年' },
    { id: 4, role: 'agent', text: '就是不吵' }
  ];
  const skeleton = buildSkeleton({ messages, product });
  const raw = {
    summary: '噪音没给数值',
    items: [
      { messageId: 1, factRef: '噪音', verdict: 'vague', why: '没说数值', suggestedReply: '室内噪音 21dB(A)', severity: 'high' },
      { messageId: 3, factRef: '噪音', verdict: 'vague', why: '还是没数值', suggestedReply: '室内噪音 21dB(A)', severity: 'high' },
      { messageId: 3, factRef: '整机保修', verdict: 'missing', why: '没提保修期', suggestedReply: '整机保修 8 年，用着放心', severity: 'low' }
    ]
  };
  const verified = verifyAdvice(raw, { session: { messages }, product, skeleton });
  assert.equal(verified.items.length, 2, '噪音只留一条，保修那条保留');
  assert.equal(verified.items.filter(item => item.factRef === '噪音').length, 1);
  const warranty = verified.items.find(item => item.factRef === '整机保修');
  assert.equal(warranty.needsReview, true, '8 年不在资料里，必须标待核实');
  assert.ok(verified.warnings.some(text => /待核实|8/.test(text)));
});

test('兜底建议：没有 AI 也能指出没答到的参数，但不编内容', () => {
  const messages = [
    { id: 1, role: 'customer', text: '噪音多少分贝' },
    { id: 2, role: 'agent', text: '很安静的' }
  ];
  const skeleton = buildSkeleton({ messages, product });
  const result = fallbackAdvice({ skeleton, product, messages });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].factRef, '噪音');
  assert.ok(result.items[0].suggestedReply.includes('21'));
  assert.equal(result.aiUsed, false);
});

test('数字提取：只认数字本身，用于核对建议里有没有编参数', () => {
  assert.deepEqual([...numbersIn('21dB(A)，保修6 年')].sort(), ['21', '6']);
  assert.deepEqual([...numbersIn('没有数字')], []);
});
