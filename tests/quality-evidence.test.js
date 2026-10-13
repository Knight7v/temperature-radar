const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findEvidence } = require('../lib/quality/evidence');
const { RULES, scoreReview } = require('../lib/quality/rules');

test('evidence points to source messages without deciding a violation', () => {
  const session = { messages: [
    { id: 0, role: 'customer', at: '2026-03-25 23:57:00', text: '我要投诉，国补能用吗？' },
    { id: 1, role: 'agent', at: '2026-03-26 00:02:00', text: '这款享受国补，我稍后帮您核实。' }
  ] };
  const found = findEvidence(session);
  assert.deepEqual(found.map(item => item.ruleId), ['response', 'complaint', 'claims']);
  assert.deepEqual(found[0].messageIds, [0, 1]);
  assert.equal(found[0].waitSeconds, 300);
  assert.deepEqual(found[1].messageIds, [0]);
  assert.equal(found.every(item => item.verdict === null), true);
});

test('review score stays pending until a supervisor rates every applicable rule', () => {
  const result = scoreReview({ ratings: { etiquette: 'pass' } });
  assert.equal(result.ready, false);
  assert.equal(result.score, null);
  assert.ok(result.missing.includes('response'));
});

test('confirmed critical and standard ratings follow the 70/30 quality rubric', () => {
  const ratings = Object.fromEntries(RULES.map(rule => [rule.id, rule.kind === 'standard' ? 5 : 'pass']));
  assert.equal(scoreReview({ ratings }).score, 100);
  assert.equal(scoreReview({ ratings: { ...ratings, response: 'issue' } }).score, 30);
  assert.equal(scoreReview({ ratings: { ...ratings, redline: 'issue' } }).score, 0);
  assert.equal(scoreReview({ ratings: { ...ratings, expression: 3 } }).score, 94);
  assert.equal(scoreReview({ ratings: { ...ratings, expression: 3, initiative: 3 } }).score, 70);
});
