'use strict';

const { RULES, RULE_VERSION, scoreReview } = require('./rules');
const { CATEGORIES } = require('./intent');

function fail(message) { throw Object.assign(Error(message), { status: 422 }); }

function validateReview(input, evidence = []) {
  if (!input || typeof input !== 'object') fail('复核内容无效');
  const ratings = input.ratings || {}, decisions = input.decisions || {}, note = String(input.note || '').trim();
  const categoryIds = input.categoryIds === undefined ? ['unknown'] : input.categoryIds;
  const allowedCategories = new Set([...CATEGORIES.map(category => category.id), 'unknown']);
  if (!Array.isArray(categoryIds) || !categoryIds.length || categoryIds.some(id => !allowedCategories.has(id)) || new Set(categoryIds).size !== categoryIds.length || (categoryIds.includes('unknown') && categoryIds.length > 1)) fail('咨询分类无效');
  if (note.length > 2000) fail('复核备注最多 2000 字');
  if (typeof ratings !== 'object' || Array.isArray(ratings) || typeof decisions !== 'object' || Array.isArray(decisions)) fail('复核内容无效');
  const rules = new Map(RULES.map(rule => [rule.id, rule]));
  for (const [id, value] of Object.entries(ratings)) {
    const rule = rules.get(id);
    if (!rule || !(rule.kind === 'standard' ? [5, 3, 1, 'na'].includes(value) : ['pass', 'issue', 'na'].includes(value))) fail('规则评分无效');
  }
  for (const [index, value] of Object.entries(decisions)) {
    if (!/^\d+$/.test(index) || Number(index) >= evidence.length || !['issue', 'dismissed', 'external'].includes(value)) fail('证据处理结果无效');
  }
  if (!input.finish) return { ratings, decisions, categoryIds, note, status: 'draft', score: null, ruleVersion: RULE_VERSION };
  const result = scoreReview({ ratings, categoryIds });
  if (!result.ready) fail('请完成全部适用规则评分');
  if (evidence.some((_, index) => !decisions[index])) fail('请处理全部证据提示');
  for (const [index, item] of evidence.entries()) {
    if (decisions[index] !== 'issue') continue;
    const rule = rules.get(item.ruleId), rating = ratings[item.ruleId];
    if (!rule || (rule.kind === 'standard' ? !(typeof rating === 'number' && rating < 5) : rating !== 'issue')) fail('评分与已确认问题不一致');
  }
  return { ratings, decisions, categoryIds, note, status: 'reviewed', score: result.score, ruleVersion: RULE_VERSION };
}

module.exports = { validateReview };
