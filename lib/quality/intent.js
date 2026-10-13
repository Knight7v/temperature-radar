'use strict';

// Only customer messages establish consultation intent. A keyword is a lead for review,
// not a verdict about the quality or correctness of an agent response.
const CATEGORIES = Object.freeze([
  { id: 'product', label: '产品选购', pattern: /(?:型号|参数|APF|能效|耗电|尺寸|匹数|制冷|制热|天仪|云锦|云佳|哪款|区别|推荐)/i },
  { id: 'promotion', label: '价格优惠', pattern: /(?:价格|多少钱|贵|便宜|优惠|折扣|补贴|国补|券|活动|满减)/ },
  { id: 'order', label: '订单物流', pattern: /(?:订单|发货|物流|快递|签收|下单|配送|到货|付款)/ },
  { id: 'after_sales', label: '安装售后', pattern: /(?:安装|维修|退货|退款|换货|售后|质保|保修|故障|坏了|收费)/ },
  { id: 'complaint', label: '投诉争议', pattern: /(?:投诉|消协|工商|维权|举报|媒体曝光|欺骗|态度差)/ }
]);

const COMMON_CHECKS = Object.freeze([
  { ruleId: 'redline', label: '高压线', mode: 'human', guidance: '核对辱骂、隐私及严重违规行为。' },
  { ruleId: 'response', label: '回应时间', mode: 'objective', guidance: '核对首次回复和顾客等待时间，结合排班判断。' },
  { ruleId: 'etiquette', label: '服务礼仪', mode: 'human', guidance: '结合上下文判断礼貌、耐心及重复催单。' },
  { ruleId: 'information', label: '答复完整性', mode: 'human', guidance: '核对是否回答顾客实际问题。' },
  { ruleId: 'logic', label: '沟通逻辑', mode: 'human', guidance: '核对答复是否前后一致。' }
]);

const SPECIFIC_CHECKS = Object.freeze({
  product: [{ ruleId: 'claims', label: '产品参数与型号', mode: 'external', guidance: '需按型号和咨询日期核对产品资料；资料缺失时只标记待核实。' }],
  promotion: [{ ruleId: 'claims', label: '价格与优惠承诺', mode: 'external', guidance: '需按咨询日期核对活动、订单和价格政策。' }],
  order: [{ ruleId: 'process', label: '订单与物流流程', mode: 'external', guidance: '需核对订单及物流记录。' }],
  after_sales: [{ ruleId: 'process', label: '安装售后流程', mode: 'external', guidance: '需核对安装、售后及处理记录。' }, { ruleId: 'claims', label: '质保与收费承诺', mode: 'external', guidance: '需按产品与日期核对质保、安装收费政策。' }],
  complaint: [{ ruleId: 'complaint', label: '投诉接待与升级', mode: 'human', guidance: '核对安抚、处理进度及必要升级。' }]
});

function classifyConversation(session) {
  const customers = (Array.isArray(session?.messages) ? session.messages : []).filter(message => message.role === 'customer' && message.text);
  const categories = CATEGORIES.map(category => ({ id: category.id, label: category.label, messageIds: customers.filter(message => category.pattern.test(message.text)).map(message => message.id) }))
    .filter(category => category.messageIds.length);
  return { categories: categories.length ? categories : [{ id: 'unknown', label: '待分类', messageIds: [] }], source: 'customer-keywords', provisional: true };
}

function checksForCategories(ids) {
  const selected = Array.isArray(ids) && ids.length ? ids : ['unknown'];
  const specific = selected.includes('unknown') ? Object.values(SPECIFIC_CHECKS).flat() : selected.flatMap(id => SPECIFIC_CHECKS[id] || []);
  const checks = [...COMMON_CHECKS];
  for (const check of specific) if (!checks.some(item => item.ruleId === check.ruleId && item.label === check.label)) checks.push(check);
  return checks;
}

function analyzeConversation(session) {
  const messages = Array.isArray(session?.messages) ? session.messages.filter(message => message && message.text) : [];
  const classification = classifyConversation({ messages });
  const categoryIds = classification.categories.map(category => category.id);
  let customerTurns = 0, agentTurns = 0, lastRole = null;
  for (const message of messages) {
    if (message.role !== 'customer' && message.role !== 'agent') continue;
    if (message.role !== lastRole) {
      if (message.role === 'customer') customerTurns++;
      else agentTurns++;
      lastRole = message.role;
    }
  }
  const firstCustomerIndex = messages.findIndex(message => message.role === 'customer');
  const firstCustomer = messages[firstCustomerIndex];
  const firstAgent = firstCustomerIndex < 0 ? null : messages.slice(firstCustomerIndex + 1).find(message => message.role === 'agent');
  const parseTime = value => Date.parse(String(value || '').replace(' ', 'T') + '+08:00');
  const elapsed = firstCustomer && firstAgent ? Math.round((parseTime(firstAgent.at) - parseTime(firstCustomer.at)) / 1000) : NaN;
  const firstReplySeconds = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
  const signals = [];
  const pressure = messages.filter(message => message.role === 'agent' && /(?:赶紧|赶快|抓紧|马上).{0,12}(?:下单|购买|拍下)/.test(message.text));
  if (pressure.length >= 2) signals.push({ code: 'repeated-pressure', ruleId: 'etiquette', title: '出现多次催单话术，请结合顾客反应核对是否过度催促', messageIds: pressure.map(message => message.id), verification: 'human', verdict: null });
  const claims = messages.filter(message => message.role === 'agent' && /(?:APF|能效|耗电|尺寸|质保|保修|安装费|免费安装|国补|补贴|优惠券|折扣)/i.test(message.text));
  if (claims.length) signals.push({ code: 'policy-claim', ruleId: 'claims', title: '产品参数或政策承诺需对照当时有效资料核实', messageIds: claims.slice(0, 5).map(message => message.id), verification: 'external', verdict: null });
  return { ...classification, checks: checksForCategories(categoryIds), metrics: { messageCount: messages.length, customerTurns, agentTurns, firstReplySeconds }, signals };
}

module.exports = { CATEGORIES, classifyConversation, checksForCategories, analyzeConversation };
