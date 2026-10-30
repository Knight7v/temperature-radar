'use strict';
/* 详情页 → 产品知识：清洗、解析、核验、合并。
 * 这一层错了后果很实在：参数写错会被拿去纠正客服，等于用错数据教人。
 * 所以重点测「什么情况下宁可丢弃」「合并时什么不能覆盖」。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanSource,
  guessModel,
  parseParams,
  parseFallback,
  verifyExtraction,
  mergeProduct,
  normalizeForSave,
  productFacts
} = require('../lib/product/extract');
const { cleanModel, normalizeModel, isGenericKeyword, isParamNoise } = require('../lib/product/groups');

const SOURCE = `格力（GREE）云锦Ⅱ 新一级能效 变频冷暖 壁挂式空调挂机 KFR-35GW/NhAa1BAj 珍珠白
产品型号：KFR-35GW/NhAa1BAj
匹数：1.5匹
能效等级：新一级能效
制冷量：3500W
室内噪音：21-41dB(A)
颜色：珍珠白
客服电话：4008365315
产品特点
· 56℃净菌自清洁：蒸发器高温杀菌，减少异味与霉味
· 分布式送风防直吹：冷风贴天花板走，卧室不直吹人
服务承诺
整机保修：6 年`;

test('型号：比较时统一大写，展示保留厂家写法', () => {
  assert.equal(cleanModel(' kfr-35gw / nhaa1baj '), 'kfr-35gw/nhaa1baj');
  assert.equal(normalizeModel(' kfr-35gw / nhaa1baj '), 'KFR-35GW/NHAA1BAJ');
  assert.equal(guessModel(SOURCE, 'gree-ac'), 'KFR-35GW/NhAa1BAj');
  assert.equal(guessModel('海尔冰箱 BCD-501WGHFD14S8U1 十字对开门', 'haier-fridge'), 'BCD-501WGHFD14S8U1');
});

test('清洗：去标签、还原换行、重复行只留一次，且不改写文字', () => {
  const cleaned = cleanSource('<div>标题 KFR-35GW/NhAa1BAj</div><ul><li>制冷量：3500W</li><li>制冷量：3500W</li></ul>');
  assert.ok(cleaned.text.includes('标题 KFR-35GW/NhAa1BAj'));
  assert.ok(cleaned.text.includes('制冷量：3500W'));
  assert.equal(cleaned.text.split('制冷量：3500W').length - 1, 1);
  assert.equal(cleaned.isHtml, true);
  // 引文核验依赖原文，清洗不能把全角符号或数字改掉
  assert.ok(cleaned.text.includes('3500W'));
});

test('参数解析：过滤客服电话这类噪声，拆出单位', () => {
  const params = parseParams(SOURCE);
  const names = params.map(item => item.name);
  assert.ok(names.includes('制冷量'));
  assert.ok(!names.includes('客服电话'));
  assert.equal(params.find(item => item.name === '制冷量').unit, 'W');
  assert.equal(isParamNoise('客服电话'), true);
  assert.equal(isParamNoise('制冷量'), false);
});

test('规则兜底：卖点只认关键词行，参数照旧', () => {
  const product = parseFallback(SOURCE, 'gree-ac');
  assert.equal(product.model, 'KFR-35GW/NhAa1BAj');
  assert.ok(product.features.length >= 2);
  assert.ok(product.features.some(item => item.title.includes('自清洁')));
  assert.ok(product.params.length >= 3);
  // 通用词不能当关键词，否则每段对话都能命中
  for (const feature of product.features) {
    for (const keyword of feature.keywords) assert.equal(isGenericKeyword(keyword), false);
  }
});

test('核验：原文找不到的参数丢弃，卖点保留但标待复核', () => {
  const raw = {
    model: 'KFR-35GW/NHAA1BAJ',
    name: '格力云锦Ⅱ',
    features: [
      { title: '自清洁', detail: '蒸发器高温杀菌', keywords: ['自清洁'], stage: 'pre_sale', evidence: '56℃净菌自清洁' },
      { title: '新风系统', detail: '带新风换气', keywords: ['新风'], stage: 'pre_sale', evidence: '新风换气功能' }
    ],
    params: [
      { name: '制冷量', value: '3500', unit: 'W', evidence: '制冷量：3500W' },
      { name: '制热量', value: '5000', unit: 'W', evidence: '制热量：5000W' }
    ],
    service: [{ name: '整机保修', value: '6 年', evidence: '整机保修：6 年' }],
    appearance: [{ label: '颜色', value: '珍珠白' }, { label: '面板', value: '拉丝钢' }]
  };
  const checked = verifyExtraction(raw, { source: SOURCE, groupId: 'gree-ac' });
  const titles = checked.product.features.map(item => item.title);
  assert.ok(titles.includes('自清洁'));
  // 「新风换气功能」原文没有 → 保留但标待复核
  const wind = checked.product.features.find(item => item.title === '新风系统');
  assert.equal(wind.needsReview, true);

  const paramNames = checked.product.params.map(item => item.name);
  assert.ok(paramNames.includes('制冷量'));
  assert.ok(!paramNames.includes('制热量'), '原文没有的数字不能留下');

  assert.equal(checked.product.appearance.length, 1, '原文没有的外观项要丢掉');
  // 型号大小写按详情页写法，不在台账里显示成全大写
  assert.equal(checked.product.model, 'KFR-35GW/NhAa1BAj');
  assert.equal(checked.warnings.some(text => /制热量|参数/.test(text)), true);
});

test('合并：参数以新导入为准，卖点只增不删，人工改过的不覆盖', () => {
  const existing = normalizeForSave({
    group: 'gree-ac',
    model: 'KFR-35GW/NhAa1BAj',
    name: '旧标题',
    params: [{ name: '制冷量', value: '3400', unit: 'W' }],
    features: [
      { title: '自清洁', detail: '人工改写过的说明', manual: true },
      { title: '静音', detail: '21dB' }
    ]
  });
  const incoming = normalizeForSave({
    group: 'gree-ac',
    model: 'kfr-35gw/nhaa1baj',
    name: '新标题',
    params: [
      { name: '制冷量', value: '3500', unit: 'W' },
      { name: '制热量', value: '5000', unit: 'W' }
    ],
    features: [
      { title: '自清洁', detail: '机器抓的说明' },
      { title: '防直吹', detail: '冷风贴天花板' }
    ]
  });
  const merged = mergeProduct(existing, incoming);
  assert.equal(merged.data.model, 'kfr-35gw/nhaa1baj');
  assert.equal(merged.data.params.find(item => item.name === '制冷量').value, '3500');
  assert.ok(merged.data.params.some(item => item.name === '制热量'));
  assert.equal(merged.data.features.find(item => item.title === '自清洁').detail, '人工改写过的说明');
  assert.ok(merged.data.features.some(item => item.title === '防直吹'));
  assert.ok(merged.data.features.some(item => item.title === '静音'), '旧卖点不能被新导入冲掉');
  assert.equal(merged.added.params, 1);
  assert.equal(merged.added.features, 1);
});

test('入库清洗：空条目丢掉、同名去重、超长截断', () => {
  const data = normalizeForSave({
    group: 'haier-fridge',
    model: ' bcd-501wghfd14s8u1 ',
    features: [
      { title: '零度保鲜', detail: 'x'.repeat(400) },
      { title: '零度保鲜', detail: '重复条目' },
      { title: '', detail: '没有名字' }
    ],
    params: [
      { name: '容积', value: '501', unit: 'L' },
      { name: '容积', value: '502', unit: 'L' },
      { name: '噪音', value: '' }
    ]
  });
  assert.equal(data.model, 'bcd-501wghfd14s8u1');
  assert.equal(data.features.length, 1);
  assert.ok(data.features[0].detail.length <= 150);
  assert.equal(data.params.length, 1);
  assert.equal(data.params[0].value, '501');
});

test('事实拍平：参数带单位、卖点带关键词，供会话对照使用', () => {
  const product = normalizeForSave({
    group: 'gree-ac',
    model: 'KFR-35GW/NhAa1BAj',
    params: [{ name: '噪音', value: '21', unit: 'dB(A)' }],
    features: [{ title: '自清洁', detail: '蒸发器高温杀菌', keywords: ['自清洁', '霉味'] }],
    service: [{ name: '整机保修', value: '6 年' }]
  });
  const facts = productFacts(product);
  const noise = facts.find(item => item.label === '噪音');
  assert.equal(noise.value, '21dB(A)');
  const clean = facts.find(item => item.label === '自清洁');
  assert.ok(clean.keywords.includes('霉味'));
  assert.ok(facts.some(item => item.label === '整机保修' && item.kind === 'service'));
});
