'use strict';

const RULE_VERSION = 'text-chat-v2';
const RULES = Object.freeze([
  { id: 'redline', label: '高压线', kind: 'fatal', help: '仅在明确存在辱骂、泄露隐私或严重违规承诺时判定问题。' },
  { id: 'resolution', label: '一次解决', kind: 'fatal', help: '仅在本可当次解决且因客服原因未解决时判定问题；信息不足可选不适用。' },
  { id: 'etiquette', label: '服务礼仪', kind: 'critical', help: '核对称呼、尊重和沟通礼貌。' },
  { id: 'response', label: '回应客户时间', kind: 'critical', help: '结合排班、自动消息及会话状态核对响应间隔。' },
  { id: 'information', label: '信息处理完整性', kind: 'critical', help: '核对问题、方案、时间承诺和必要备注是否完整。' },
  { id: 'claims', label: '产品与活动信息', kind: 'critical', categories: ['product', 'promotion', 'after_sales'], help: '商品参数、价格、国补与安装承诺应结合当时的政策或订单核实。' },
  { id: 'process', label: '业务流程', kind: 'critical', categories: ['order', 'after_sales'], help: '订单、售后及升级流程需与外部业务记录核对。' },
  { id: 'complaint', label: '投诉接待', kind: 'critical', categories: ['complaint'], help: '核对安抚及必要的主管升级记录。' },
  { id: 'logic', label: '沟通逻辑', kind: 'critical', help: '核对需求理解与答复是否前后一致。' },
  { id: 'expression', label: '语言表达', kind: 'standard', help: '按 5、3、1 分评价表达清晰度，无法判断时选不适用。' },
  { id: 'initiative', label: '服务主动性', kind: 'standard', help: '按 5、3、1 分评价是否主动补充相关解决方案。' }
]);

function applicableRules(categoryIds = ['unknown']) {
  if (!Array.isArray(categoryIds) || !categoryIds.length || categoryIds.includes('unknown')) return RULES;
  return RULES.filter(rule => !rule.categories || rule.categories.some(category => categoryIds.includes(category)));
}

function scoreReview(review) {
  const ratings = review?.ratings || {}, missing = [];
  const activeRules = applicableRules(review?.categoryIds);
  for (const rule of activeRules) {
    const value = ratings[rule.id], valid = rule.kind === 'standard' ? [5, 3, 1, 'na'].includes(value) : ['pass', 'issue', 'na'].includes(value);
    if (!valid) missing.push(rule.id);
  }
  if (missing.length) return { ready: false, score: null, missing };
  const applicableCritical = activeRules.filter(rule => rule.kind === 'critical' && ratings[rule.id] !== 'na');
  const standard = activeRules.filter(rule => rule.kind === 'standard' && ratings[rule.id] !== 'na').map(rule => ratings[rule.id]);
  if (!applicableCritical.length || !standard.length) return { ready: false, score: null, missing: ['至少保留一项关键项和一项非关键项'] };
  if (activeRules.some(rule => rule.kind === 'fatal' && ratings[rule.id] === 'issue')) return { ready: true, score: 0, missing: [] };
  const critical = applicableCritical.some(rule => ratings[rule.id] === 'issue') ? 0 : 70;
  const standardPoints = standard.filter(value => value < 5).length >= 2 ? 0 : standard.reduce((sum, value) => sum + value, 0) / standard.length / 5 * 30;
  return { ready: true, score: Math.round((critical + standardPoints) * 100) / 100, missing: [] };
}

module.exports = { RULE_VERSION, RULES, applicableRules, scoreReview };
