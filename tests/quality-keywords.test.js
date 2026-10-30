const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  shortReplyStats,
  detectKeywordSignals,
  renderKeywordBriefing,
  stripToChinese
} = require('../lib/quality/ai/keywords');

function session(messages, agent = '格力旗舰店售前-01') {
  return {
    agent,
    startedAt: '2026-10-20 10:00:00',
    endedAt: '2026-10-20 10:10:00',
    messages: messages.map((item, index) => ({ id: index, ...item }))
  };
}

// ---------- 单字回复 ----------

test('单字回复：识别"嗯/好/在"等纯单字敷衍', () => {
  const stats = shortReplyStats(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '在吗' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '在' },
    { role: 'customer', at: '2026-10-20 10:00:20', text: '有货吗' },
    { role: 'agent', at: '2026-10-20 10:00:30', text: '有。' },
    { role: 'customer', at: '2026-10-20 10:00:40', text: '能便宜吗' },
    { role: 'agent', at: '2026-10-20 10:00:50', text: '嗯' }
  ]));
  assert.equal(stats.total, 3);
  assert.equal(stats.singleCount, 3);
  assert.equal(stats.count, 3);
  assert.equal(stats.ratio, 1);
});

test('单字回复："稍等/收到"是流程用语，不算敷衍', () => {
  const stats = shortReplyStats(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '帮我查下物流' },
    { role: 'agent', at: '2026-10-20 10:00:05', text: '稍等' },
    { role: 'agent', at: '2026-10-20 10:00:30', text: '收到，正在为您查询，预计今天发出' }
  ]));
  assert.equal(stats.singleCount, 0);
  assert.equal(stats.briefCount, 0);
  assert.equal(stats.count, 0);
});

test('单字回复：两字敷衍"好的/是的"计入，带后续解释的长句不计入', () => {
  const stats = shortReplyStats(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '能开发票吗' },
    { role: 'agent', at: '2026-10-20 10:00:05', text: '好的' },
    { role: 'customer', at: '2026-10-20 10:00:30', text: '多久到' },
    { role: 'agent', at: '2026-10-20 10:00:40', text: '好的，电子发票下单后 48 小时内发到您手机短信里' }
  ]));
  assert.equal(stats.singleCount, 0);
  assert.equal(stats.briefCount, 1);
  assert.equal(stats.count, 1);
  assert.equal(stats.ratio, 0.5);
});

test('单字回复：标点与表情被剥离后再判断长度', () => {
  assert.equal(stripToChinese('嗯。'), '嗯');
  assert.equal(stripToChinese('好的！'), '好的');
  assert.equal(stripToChinese('👍'), '');
  const stats = shortReplyStats(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '好看吗' },
    { role: 'agent', at: '2026-10-20 10:00:05', text: '👍' }
  ]));
  assert.equal(stats.count, 0, '纯表情不计入单字回复，交给语言表达项判断');
});

// ---------- 好评返现 ----------

test('好评返现：好评词与金钱词同条出现 → 强信号', () => {
  const signals = detectKeywordSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '这台多少钱' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '亲，晒图评价返红包 30 元，五星好评再加 20' }
  ]));
  assert.equal(signals.reviewCash.length, 1);
  assert.equal(signals.moneyOnly.length, 0);
  assert.deepEqual(signals.reviewCash[0].reviewWords.sort(), ['五星', '好评', '晒图', '评价'].sort());
  assert.ok(signals.reviewCash[0].moneyWords.includes('返红包'));
});

test('好评返现：只出现"返现"不判强信号，进弱信号池', () => {
  const signals = detectKeywordSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '这个价格还能优惠吗' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '目前有活动，下单后可以给您返现 20 元' }
  ]));
  assert.equal(signals.reviewCash.length, 0);
  assert.equal(signals.moneyOnly.length, 1);
  assert.equal(signals.scenes.discount, true, '顾客问优惠 → 识别为优惠语境');
});

test('好评返现：售后索赔语境被识别为补偿场景', () => {
  const signals = detectKeywordSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '机器漏水了，你们要赔我损失' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '实在抱歉给您添麻烦了，这边给您补偿 100 元' }
  ]));
  assert.equal(signals.reviewCash.length, 0);
  assert.equal(signals.moneyOnly.length, 1);
  assert.equal(signals.scenes.compensation, true);
});

test('好评返现：顾客自己说给好评，客服只说谢谢 → 不进强信号', () => {
  const signals = detectKeywordSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '用得好我给你们五星好评' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '谢谢您，有问题随时找我' }
  ]));
  assert.equal(signals.reviewCash.length, 0);
  assert.equal(signals.moneyOnly.length, 0);
  assert.equal(signals.total, 0);
});

// ---------- 站外导流 ----------

test('站外导流：加我/私我/扫码 被识别', () => {
  const signals = detectKeywordSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '这个能便宜吗' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '加我微信，私下给您走个内部价' }
  ]));
  assert.equal(signals.offsite.length, 1);
  assert.ok(signals.offsite[0].words.includes('加我'));
});

test('站外导流：客服明确拒绝站外方式 → 不命中', () => {
  const signals = detectKeywordSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '我加你微信吧' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '不好意思不能加微信，咱们在平台内沟通，售后也有保障' }
  ]));
  assert.equal(signals.offsite.length, 0, '否定语境（不能加微信）不构成导流信号');
});

test('站外导流：顾客说的话不计入，只统计客服', () => {
  const signals = detectKeywordSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '我加你微信吧，发我个视频' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '安装视频在详情页里有，您可以点开看' }
  ]));
  assert.equal(signals.offsite.length, 0);
});

// ---------- 简报 ----------

test('简报：无线索时明确写"未检出"，避免模型自己瞎找', () => {
  const briefing = renderKeywordBriefing(detectKeywordSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '什么时候能到' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '预计明天下午送达，您注意收货' }
  ])));
  assert.match(briefing, /未检出关键词线索/);
});

test('简报：强信号带消息编号与原文片段，便于模型取证', () => {
  const briefing = renderKeywordBriefing(detectKeywordSignals(session([
    { role: 'customer', at: '2026-10-20 10:00:00', text: '好' },
    { role: 'agent', at: '2026-10-20 10:00:10', text: '好评返现 50 元哦' }
  ])));
  assert.match(briefing, /消息#1/);
  assert.match(briefing, /强信号/);
});
