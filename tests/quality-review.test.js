const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RULES } = require('../lib/quality/rules');
const { validateReview } = require('../lib/quality/review');
const { applicableRules, scoreReview } = require('../lib/quality/rules');

const complete = () => Object.fromEntries(RULES.map(rule => [rule.id, rule.kind === 'standard' ? 5 : 'pass']));
const evidence = [{ ruleId: 'response', messageIds: [0, 1] }, { ruleId: 'claims', messageIds: [2] }];

test('a draft can retain partial ratings but has no published score', () => {
  const review = validateReview({ ratings: { response: 'issue' }, decisions: { 0: 'issue' }, note: '待核对排班', finish: false }, evidence);
  assert.equal(review.score, null);
  assert.equal(review.status, 'draft');
});

test('a final review requires human decisions for every candidate and every rule', () => {
  assert.throws(() => validateReview({ ratings: complete(), decisions: { 0: 'issue' }, finish: true }, evidence), /请处理全部证据提示/);
  assert.throws(() => validateReview({ ratings: { response: 'pass' }, decisions: { 0: 'issue', 1: 'external' }, finish: true }, evidence), /请完成全部适用规则/);
  assert.throws(() => validateReview({ ratings: complete(), decisions: { 0: 'issue', 1: 'dismissed' }, finish: true }, evidence), /评分与已确认问题不一致/);
  const review = validateReview({ ratings: { ...complete(), response: 'issue', claims: 'na' }, decisions: { 0: 'issue', 1: 'external' }, note: '需核对活动规则', finish: true }, evidence);
  assert.equal(review.score, 30);
  assert.equal(review.status, 'reviewed');
});

test('product consultation requires product checks but does not force complaint or order scores', () => {
  const ids = applicableRules(['product']).map(rule => rule.id);
  assert.equal(ids.includes('claims'), true);
  assert.equal(ids.includes('process'), false);
  assert.equal(ids.includes('complaint'), false);
  const ratings = Object.fromEntries(applicableRules(['product']).map(rule => [rule.id, rule.kind === 'standard' ? 5 : 'pass']));
  assert.equal(scoreReview({ ratings, categoryIds: ['product'] }).score, 100);
  const result = validateReview({ ratings, decisions: {}, categoryIds: ['product'], finish: true }, []);
  assert.deepEqual(result.categoryIds, ['product']);
});

test('manual consultation categories reject invalid or ambiguous selections', () => {
  assert.throws(() => validateReview({ ratings: {}, categoryIds: ['product', 'unknown'], finish: false }), /咨询分类无效/);
  assert.throws(() => validateReview({ ratings: {}, categoryIds: ['made-up'], finish: false }), /咨询分类无效/);
});
