'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  GRADE_ORDER,
  DEFAULT_SIZE,
  buildSample,
  summarize,
  describe,
  normalizeGrade,
  gradeIndex
} = require('../lib/quality/calibration');

const session = (id, grade, score) => ({
  session_id: id,
  grade,
  score,
  agent: '格力旗舰店售前-01',
  started_at: '2026-03-25 10:00:00',
  ai_summary: ''
});

// 造 n 条同档会话，id 带前缀便于断言
const makePool = (prefix, grade, score, n) =>
  Array.from({ length: n }, (_, i) => session(`${prefix}-${String(i + 1).padStart(3, '0')}`, grade, score));

test('档位归一：分数反推与大小写容错', () => {
  assert.equal(normalizeGrade('A+', null), 'A+');
  assert.equal(normalizeGrade('a', null), 'A');
  assert.equal(normalizeGrade('', 95), 'A+');
  assert.equal(normalizeGrade('', 85), 'A');
  assert.equal(normalizeGrade('', 84.9), 'B');
  assert.equal(normalizeGrade('', 70), 'B');
  assert.equal(normalizeGrade('', 40), 'C');
  assert.equal(normalizeGrade('', 39.9), 'D');
  assert.equal(normalizeGrade('', null), '');
  assert.equal(normalizeGrade('', 'abc'), '');
  assert.deepEqual(GRADE_ORDER, ['A+', 'A', 'B', 'C', 'D']);
  assert.equal(gradeIndex('D'), 4);
});

test('分层抽样按配额取数，每层都不超配额', () => {
  const pool = [
    ...makePool('ap', 'A+', 98, 30),
    ...makePool('a', 'A', 90, 300),
    ...makePool('b', 'B', 78, 100),
    ...makePool('c', 'C', 55, 40),
    ...makePool('d', 'D', 20, 120)
  ];
  const result = buildSample(pool);
  assert.equal(result.picked, DEFAULT_SIZE);
  assert.equal(result.shortage, 0);
  const count = {};
  for (const item of result.items) count[item.grade] = (count[item.grade] || 0) + 1;
  assert.equal(count['A+'], 5);
  assert.equal(count.A, 20);
  assert.equal(count.B, 10);
  assert.equal(count.C, 5);
  assert.equal(count.D, 20);
});

test('同一批候选永远抽出同一批样本，且与输入顺序无关', () => {
  const pool = [
    ...makePool('ap', 'A+', 98, 12),
    ...makePool('a', 'A', 90, 200),
    ...makePool('d', 'D', 20, 80)
  ];
  const first = buildSample(pool, { size: 40, seed: 'fixed' });
  const shuffled = [...pool].reverse();
  const second = buildSample(shuffled, { size: 40, seed: 'fixed' });
  assert.deepEqual(
    first.items.map(item => item.session_id).sort(),
    second.items.map(item => item.session_id).sort()
  );
  // 换种子应该换一批（否则等于每次都考同一套卷）
  const third = buildSample(pool, { size: 40, seed: 'another' });
  assert.notDeepEqual(
    first.items.map(item => item.session_id).sort(),
    third.items.map(item => item.session_id).sort()
  );
});

test('样本顺序被打散，不能从排列顺序反推 AI 档位', () => {
  const pool = [
    ...makePool('a', 'A', 90, 60),
    ...makePool('d', 'D', 20, 60)
  ];
  const result = buildSample(pool, { size: 40 });
  const grades = result.items.map(item => item.grade);
  // 若按档位排序，会是连续 20 个 A 再 20 个 D
  const switches = grades.filter((grade, index) => index > 0 && grade !== grades[index - 1]).length;
  assert.ok(switches > 4, `样本应按哈希打散，实际切换次数 ${switches}`);
});

test('某层候选不足时，名额优先补给低分档', () => {
  const pool = [
    ...makePool('a', 'A', 90, 200),
    ...makePool('d', 'D', 20, 25)
  ];
  const result = buildSample(pool, { size: 60 });
  assert.equal(result.picked, 60);
  const count = {};
  for (const item of result.items) count[item.grade] = (count[item.grade] || 0) + 1;
  // D 层配额 20 吃满后，多出来的 5 条仍在补名额时被优先取走
  assert.equal(count.D, 25);
  // A+ / B / C 三层的空缺由 A 档补足
  assert.equal(count.A, 35);
  assert.ok(result.missing.some(item => item.grade === 'C'));
});

test('候选不足目标条数时，抽出全部并如实报告缺口', () => {
  const pool = makePool('a', 'A', 90, 15);
  const result = buildSample(pool, { size: 60 });
  assert.equal(result.picked, 15);
  assert.equal(result.shortage, 45);
});

test('候选里没有分数也没有档位的条目直接跳过', () => {
  const result = buildSample([{ session_id: 'x-1' }, session('x-2', '', null), session('x-3', 'A', 90)], { size: 10 });
  assert.deepEqual(result.items.map(item => item.session_id), ['x-3']);
});

test('一致率：完全一致、差一档、差两档以上分别计数', () => {
  const summary = summarize([
    { aiGrade: 'A', aiScore: 90, humanGrade: 'A' },
    { aiGrade: 'A', aiScore: 90, humanGrade: 'B' },
    { aiGrade: 'A', aiScore: 90, humanGrade: 'D' },
    { aiGrade: 'D', aiScore: 20, humanGrade: 'A+' }
  ]);
  assert.equal(summary.marked, 4);
  assert.equal(summary.exact, 1);
  assert.equal(summary.exactRate, 0.25);
  assert.equal(summary.close, 2);
  assert.equal(summary.far, 2);
  // AI 说良好、人说不及格 = 漏判
  assert.equal(summary.severeMiss, 1);
  // AI 说不合格、人说优秀 = 误伤
  assert.equal(summary.severeAlarm, 1);
  assert.equal(summary.confusion.A.D, 1);
  assert.equal(summary.confusion.D['A+'], 1);
});

test('平均分差：AI 偏松时为正数', () => {
  const summary = summarize([
    { aiGrade: 'A', aiScore: 90, humanGrade: 'B' },
    { aiGrade: 'A', aiScore: 90, humanGrade: 'B' }
  ]);
  // 主管档位折算 77.5，AI 给 90 → 平均差 -12.5（AI 偏高 12.5 分）
  assert.equal(summary.avgBias, -12.5);
});

test('空输入不崩，各项为 0 或 null', () => {
  const summary = summarize([]);
  assert.equal(summary.marked, 0);
  assert.equal(summary.exactRate, null);
  assert.equal(summary.avgBias, null);
  assert.equal(summary.byGrade.length, 5);
  assert.equal(describe(summary).level, 'empty');
});

test('缺人工档位的条目不参与统计', () => {
  const summary = summarize([
    { aiGrade: 'A', aiScore: 90, humanGrade: '' },
    { aiGrade: 'A', aiScore: 90, humanGrade: 'A' }
  ]);
  assert.equal(summary.marked, 1);
  assert.equal(summary.exactRate, 1);
});

test('加权还原：按全体各档占比折算总体一致率', () => {
  // A 档抽 2 条全错，D 档抽 2 条全对；全体 90 条 A、10 条 D
  const summary = summarize(
    [
      { aiGrade: 'A', aiScore: 90, humanGrade: 'B' },
      { aiGrade: 'A', aiScore: 90, humanGrade: 'C' },
      { aiGrade: 'D', aiScore: 20, humanGrade: 'D' },
      { aiGrade: 'D', aiScore: 20, humanGrade: 'D' }
    ],
    { population: { 'A+': 0, A: 90, B: 0, C: 0, D: 10 } }
  );
  assert.equal(summary.exactRate, 0.5);
  // 0.9×0 + 0.1×1 = 0.1
  assert.equal(summary.weightedExactRate, 0.1);
  assert.equal(summary.weightedCoverage, 1);
});

test('结论话术：有漏判就判风险，一致率高判可放心用', () => {
  const risky = describe(summarize([{ aiGrade: 'A', aiScore: 90, humanGrade: 'D' }]));
  assert.equal(risky.level, 'risk');
  assert.ok(risky.details.some(text => text.includes('漏判')));

  const good = describe(
    summarize(Array.from({ length: 40 }, () => ({ aiGrade: 'A', aiScore: 90, humanGrade: 'A' })))
  );
  assert.equal(good.level, 'ok');
  assert.ok(good.headline.includes('放心'));

  const few = describe(summarize(Array.from({ length: 5 }, () => ({ aiGrade: 'A', aiScore: 90, humanGrade: 'A' }))));
  assert.ok(few.details.some(text => text.includes('样本偏少')));
});

test('结论话术：少数漏判不该被判成「不可采信」', () => {
  // 20 条里 1 条漏判（5%），一致率 95% —— 属于要盯但可用的水平
  const marks = Array.from({ length: 20 }, (_, i) => ({
    aiGrade: 'A',
    aiScore: 90,
    humanGrade: i === 0 ? 'D' : 'A'
  }));
  const verdict = describe(summarize(marks));
  assert.equal(verdict.level, 'watch');
  assert.ok(verdict.details.some(text => text.includes('比例不高')));

  // 比例超过 10% 才升级为风险
  const many = Array.from({ length: 20 }, (_, i) => ({
    aiGrade: 'A',
    aiScore: 90,
    humanGrade: i < 4 ? 'D' : 'A'
  }));
  assert.equal(describe(summarize(many)).level, 'risk');
});
