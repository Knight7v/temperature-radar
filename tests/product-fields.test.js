'use strict';

// 参数标准字段表：保证「打开任何型号，同一个字段永远在同一格」。
//
// 这套测试守的是四件事：
//   1. 字段表本身没写错（45 条、key 唯一、别名不打架、分段不漏字段）；
//   2. 库里现存的 45 个字段名 100% 能落到格子里 —— 有一个没命中，页面就会多出一个「未归类」段；
//   3. 位置绝对稳定：参数多少、顺序如何，同一字段的索引都不变；
//   4. 单位不重复、不擅自发明。

const test = require('node:test');
const assert = require('node:assert');
const {
  FIELDS,
  SECTIONS,
  MISSING_TEXT,
  PK_MISSING_TEXT,
  PK_FIELD_KEYS,
  resolveField,
  formatValue,
  alignParams,
  publicFields
} = require('../lib/product/fields');
const { extractPkFields, MISSING } = require('../lib/product/pk-fields');

// 2026-10-28 从库里导出的全部参数名（SELECT DISTINCT p->>'name'，共 45 个）。
// 导入映射或字段表谁改了都得让这份清单对得上 —— 对不上说明有一边漂了。
const DB_NAMES = [
  'APF 能效比', 'WiFi 智控', '保温模式', '其他卖点', '内机净重',
  '内机噪音', '内机尺寸(宽x高x深)', '内机装箱清单', '冷暖类型', '冷酷外机',
  '出风口设计', '制冷剂', '制冷功率', '制冷量', '制热功率',
  '制热量', '制热防冷风', '匹数', '变频类型', '外机净重',
  '外机噪音', '外机尺寸(宽x高x深)', '外机装箱清单', '外机运行温度', '定时',
  '导风板', '循环风量', '智能光敏', '清洁方式', '温度调节',
  '独立除湿', '电压/频率', '电辅热', '电辅热功率', '睡眠模式',
  '能效等级', '自主检测室温', '节流部件', '送风角度', '适用面积',
  '铜管排数', '防直吹', '面板工艺', '颜色', '风速档位'
];

function flatKeys(view) {
  return view.sections.flatMap(section => section.items.map(item => item.key));
}

function viewIndexOf(view, key) {
  return flatKeys(view).indexOf(key);
}

function paramsOf(pairs) {
  return pairs.map(([name, value, extra]) => ({ name, value, ...(extra || {}) }));
}

test('字段表：45 个字段、7 个分段，key 不重复', () => {
  assert.equal(FIELDS.length, 45);
  assert.equal(SECTIONS.length, 7);
  const keys = new Set(FIELDS.map(field => field.key));
  assert.equal(keys.size, 45, '有重复的 key');
  const pairs = publicFields().length;
  assert.equal(pairs, 45);
});

test('字段表：每个字段都归属于一个存在的分段，且段内不缺字段', () => {
  const ids = new Set(SECTIONS.map(section => section.id));
  for (const field of FIELDS) {
    assert.ok(ids.has(field.section), `${field.key} 的分段 ${field.section} 不存在`);
  }
  assert.equal(FIELDS.filter(field => field.section === 'core').length, 8);
  assert.equal(FIELDS.filter(field => field.section === 'power').length, 4);
  assert.equal(FIELDS.filter(field => field.section === 'air').length, 3);
  assert.equal(FIELDS.filter(field => field.section === 'comfort').length, 12);
  assert.equal(FIELDS.filter(field => field.section === 'hardware').length, 5);
  assert.equal(FIELDS.filter(field => field.section === 'size').length, 5);
  assert.equal(FIELDS.filter(field => field.section === 'misc').length, 8);
});

test('字段表：别名不占别人的坑（同一个名字只能指向一个字段）', () => {
  const seen = new Map();
  for (const field of FIELDS) {
    for (const name of [field.key, ...(field.aliases || [])]) {
      const hit = seen.get(name);
      assert.ok(!hit, `「${name}」同时属于 ${hit} 和 ${field.key}`);
      seen.set(name, field.key);
    }
  }
});

test('库里现存的 45 个字段名全部能落到格子上', () => {
  assert.equal(DB_NAMES.length, 45);
  const missed = DB_NAMES.filter(name => !resolveField(name));
  assert.deepEqual(missed, [], '这些字段名没登记，页面会多出「未归类参数」段');
});

test('空参数的机器也铺满 45 格，全部显示「待补充」', () => {
  const view = alignParams([]);
  assert.equal(view.total, 45);
  assert.equal(view.filled, 0);
  assert.equal(view.pending, 45);
  const items = view.sections.flatMap(section => section.items);
  assert.equal(items.length, 45);
  assert.ok(items.every(item => item.missing));
  assert.ok(items.every(item => item.display === MISSING_TEXT));
  assert.deepEqual(view.unregistered, []);
});

test('位置绝对稳定：参数从 1 条变成 45 条，同一字段的索引不变', () => {
  const full = paramsOf(DB_NAMES.map(name => [name, '1']));
  const sparse = paramsOf([['制冷量', '3500'], ['品牌', '忽略我']]);
  const shuffled = paramsOf([...DB_NAMES].reverse().map(name => [name, '1']));

  const a = alignParams(full);
  const b = alignParams([]);
  const c = alignParams(sparse);
  const d = alignParams(shuffled);

  for (const key of FIELDS.map(field => field.key)) {
    const at = viewIndexOf(a, key);
    assert.ok(at >= 0, `${key} 在满参数里找不到`);
    assert.equal(viewIndexOf(b, key), at, `${key} 在空参数里挪位了`);
    assert.equal(viewIndexOf(c, key), at, `${key} 在稀疏参数里挪位了`);
    assert.equal(viewIndexOf(d, key), at, `${key} 在乱序参数里挪位了`);
  }
});

test('缺失与有值在同一位置：有值的格子不会挤走后面的字段', () => {
  const onlyFirst = alignParams(paramsOf([['匹数', '1.5匹']]));
  const withLongValue = alignParams(paramsOf([
    ['匹数', '1.5匹'],
    ['其他卖点', '一键凉感+童锁+出风口可拆洗+智能电辅热+宽电压运行+自清洁']
  ]));
  assert.equal(viewIndexOf(onlyFirst, '其他卖点'), viewIndexOf(withLongValue, '其他卖点'));
  assert.equal(onlyFirst.filled, 1);
  assert.equal(withLongValue.filled, 2);
  assert.equal(onlyFirst.pending, 44);
});

test('别名归并：历史/外部写法的名字落到标准格子', () => {
  const view = alignParams(paramsOf([
    ['APF能效比', '5.31'],
    ['导风板类型', '单导风板'],
    ['智能WIFI', '格力+APP'],
    ['调温', '0.5度'],
    ['风速', '7档可调'],
    ['内机尺寸', '890×299×198'],
    ['外观', '肤感白'],
    ['冷媒', 'R32']
  ]));
  const byKey = new Map(view.sections.flatMap(s => s.items).map(item => [item.key, item]));
  assert.equal(byKey.get('APF 能效比').display, '5.31');
  assert.equal(byKey.get('导风板').display, '单导风板');
  assert.equal(byKey.get('WiFi 智控').display, '格力+APP');
  assert.equal(byKey.get('温度调节').display, '0.5度');
  assert.equal(byKey.get('风速档位').display, '7档可调');
  assert.equal(byKey.get('颜色').display, '肤感白');
  assert.equal(byKey.get('制冷剂').display, 'R32');
  assert.equal(view.filled, 8);
});

test('单位：尾部已有的单位剥掉再拼，不出现 kg kg', () => {
  assert.equal(formatValue({ unit: 'kg' }, '35/42kg'), '35/42 kg');
  assert.equal(formatValue({ unit: 'kg' }, '9.5'), '9.5 kg');
  assert.equal(formatValue({ unit: 'W' }, '2660'), '2660 W');
  assert.equal(formatValue({ unit: 'W' }, '1000(85-1500)'), '1000(85-1500) W');
  assert.equal(formatValue({ unit: 'dB(A)' }, '16db'), '16 dB(A)');
  assert.equal(formatValue({ unit: 'dB(A)' }, '高风档45'), '高风档45 dB(A)');
  assert.equal(formatValue({ unit: 'mm' }, '1072x325x245'), '1072x325x245 mm');
  assert.equal(formatValue({ unit: 'm³/h' }, '710'), '710 m³/h');
  assert.equal(formatValue({ unit: '℃' }, '-7~43'), '-7~43 ℃');
});

test('单位：字段本身没有单位记录的，不许自己发明', () => {
  assert.equal(formatValue({ unit: '' }, '1.5匹'), '1.5匹');
  assert.equal(formatValue({ unit: '' }, '10-15'), '10-15');
  assert.equal(formatValue({ unit: '' }, '220V～/50Hz'), '220V～/50Hz');
  assert.equal(formatValue({ unit: '' }, '冷暖'), '冷暖');
});

test('单位：值是「支持/不支持」这类判断词时不挂单位', () => {
  assert.equal(formatValue({ unit: 'W' }, '支持'), '支持');
  assert.equal(formatValue({ unit: 'kg' }, '不支持'), '不支持');
  assert.equal(formatValue({ unit: 'W' }, '待核实'), '待核实');
});

test('单位：噪音值自己带 db 时不再挂 dB(A)，避免「db dB(A)」', () => {
  /* 库里真实值：18db-45db（超强风档），单位夹在句子中间，尾部剥离够不着 */
  assert.equal(formatValue({ unit: 'dB(A)' }, '18db-45db（超强风档）'), '18db-45db（超强风档）');
  assert.equal(formatValue({ unit: 'dB(A)' }, '16db'), '16 dB(A)');
  assert.equal(formatValue({ unit: 'dB(A)' }, '51'), '51 dB(A)');
});

test('未登记的字段名单独成段，不静默丢掉', () => {
  const view = alignParams(paramsOf([
    ['制冷量', '3500'],
    ['噪音等级', '一级静音'],
    ['品牌', '格力']
  ]));
  assert.deepEqual(view.unregistered, ['噪音等级', '品牌']);
  const extra = view.sections.find(section => section.id === 'unregistered');
  assert.ok(extra, '没生成未归类段');
  assert.equal(extra.items.length, 2);
  /* 未归类段不算进 45 项里，进度条只统计标准字段 */
  assert.equal(view.total, 45);
  assert.equal(view.filled, 1);
  assert.equal(view.pending, 44);
});

test('同名字段重复出现只认第一条（库里实测 0 例，防将来导入出岔子）', () => {
  const view = alignParams(paramsOf([['制冷量', '3500'], ['制冷量', '7200']]));
  const cell = view.sections.flatMap(s => s.items).find(item => item.key === '制冷量');
  assert.equal(cell.display, '3500 W');
  assert.equal(view.filled, 1);
});

test('待核实 / 人工标记原样带到格子上', () => {
  const view = alignParams(paramsOf([
    ['制冷量', '3500', { needsReview: true }],
    ['铜管排数', '1.6排', { manual: true }]
  ]));
  const cells = new Map(view.sections.flatMap(s => s.items).map(item => [item.key, item]));
  assert.equal(cells.get('制冷量').needsReview, true);
  assert.equal(cells.get('铜管排数').manual, true);
  assert.equal(cells.get('匹数').needsReview, false);
});

test('分段进度：每段 filled 与段内有值格子数一致', () => {
  const view = alignParams(paramsOf([['匹数', '3匹'], ['制冷量', '7200'], ['铜管排数', '双排']]));
  const core = view.sections.find(section => section.id === 'core');
  assert.equal(core.filled, 2);
  assert.equal(core.total, 8);
  const hardware = view.sections.find(section => section.id === 'hardware');
  assert.equal(hardware.filled, 1);
  assert.equal(hardware.total, 5);
  assert.equal(view.sections.reduce((sum, s) => sum + s.filled, 0), view.filled);
});

test('前端定义（publicFields）够渲染用：key/label/section/别名都在', () => {
  const fields = publicFields();
  const apf = fields.find(field => field.key === 'APF 能效比');
  assert.ok(apf);
  assert.equal(apf.section, 'core');
  assert.ok(apf.aliases.includes('APF能效比'));
  const size = fields.find(field => field.key === '内机尺寸(宽x高x深)');
  assert.equal(size.label, '内机尺寸', '展示名不该带括号后缀，否则格子里塞不下');
  assert.equal(size.unit, 'mm');
  /* 全部字段等宽：只要有一个字段独占整行，它右边就会留个空洞、还会把后面的字段推走 */
  assert.ok(fields.every(field => !field.wide), '不应有独占整行的字段');
});

/* ---------------- 机型性能PK 缺格高亮 ---------------- */

test('PK 字段清单：11 项，全部能在字段表里找到，且只有它们带 pk 标记', () => {
  assert.equal(PK_FIELD_KEYS.length, 11);
  for (const key of PK_FIELD_KEYS) {
    assert.ok(resolveField(key), `${key} 不在字段表里`);
  }
  /* pk 标记不许挂在未登记的名字上，也不许重复 */
  assert.equal(new Set(PK_FIELD_KEYS).size, 11);
  const marked = FIELDS.filter(field => field.pk).map(field => field.key);
  assert.deepEqual(marked.sort(), [...PK_FIELD_KEYS].sort());
  assert.equal(publicFields().filter(field => field.pk).length, 11, '前端要拿到同一份 pk 标记');
});

test('反向校验：45 个字段全填上，PK 取值不该再剩「—」（新增取值字段必须同步字段表）', () => {
  const all = paramsOf(FIELDS.map(field => [field.key, field.key.includes('WiFi') ? '格力+APP' : '99']));
  const got = extractPkFields({ model: 'TEST', params: all });
  const holes = Object.entries(got)
    .filter(([, value]) => value === MISSING)
    .map(([key]) => key);
  /* eco（节能模式）/ kwh（电量查询）在知识库里还没有对应参数字段，
     所以永远取不到值 —— 这是已知缺口，不是漏标。真要能填，得先加字段。 */
  assert.deepEqual(holes.sort(), ['eco', 'kwh']);
});

test('零参数的机器：11 个 PK 字段全部标成「请尽快填写」，其他格子只算待补充', () => {
  const view = alignParams([]);
  assert.equal(view.pkTotal, 11);
  assert.equal(view.pkMissing, 11);
  assert.equal(view.pkMissingLabels.length, 11);
  const items = view.sections.flatMap(section => section.items);
  assert.equal(items.filter(item => item.pkMissing).length, 11);
  /* 34 个非 PK 字段空白时不催填 —— 否则「请尽快填写」满屏，等于没提示 */
  assert.equal(items.filter(item => item.missing && !item.pkMissing).length, 34);
  assert.ok(items.filter(item => item.pkMissing).every(item => item.missing));
});

test('PK 缺格只标没值的：有值的不标，缺口数随之减少', () => {
  const view = alignParams(paramsOf([
    ['APF 能效比', '5.31'],
    ['循环风量', '710'],
    ['铜管排数', '双排']
  ]));
  assert.equal(view.pkMissing, 8);
  assert.deepEqual(
    [...view.pkMissingLabels].sort(),
    ['WiFi 智控', '外机运行温度', '导风板', '温度调节', '智能光敏', '清洁方式', '睡眠模式', '送风角度'].sort()
  );
  const apf = view.sections.flatMap(s => s.items).find(item => item.key === 'APF 能效比');
  assert.equal(apf.pk, true);
  assert.equal(apf.pkMissing, false);
  assert.equal(apf.display, '5.31');
});

test('PK 字段全部有值时 pkMissing 归零（页面据此换成「都齐了」）', () => {
  const view = alignParams(paramsOf(PK_FIELD_KEYS.map(key => [key, '99'])));
  assert.equal(view.pkMissing, 0);
  assert.deepEqual(view.pkMissingLabels, []);
  assert.equal(view.pkTotal, 11);
});

test('分段也带 pkMissing：看得出哪一段在拖 PK 的后腿', () => {
  const view = alignParams(paramsOf([['APF 能效比', '5.31']]));
  const hardware = view.sections.find(section => section.id === 'hardware');
  /* 硬件用料 5 项里，铜管排数、外机运行温度会影响 PK */
  assert.equal(hardware.pkMissing, 2);
  const core = view.sections.find(section => section.id === 'core');
  assert.equal(core.pkMissing, 0);
  const comfort = view.sections.find(section => section.id === 'comfort');
  /* 舒适功能 12 项里有 5 项要进 PK / 选购指南：温度调节、睡眠模式、导风板、送风角度、智能光敏 */
  assert.equal(comfort.pkMissing, 5);
});

test('PK 高亮不许动位置：标了 pk 的格子索引与空参数完全一致', () => {
  const sparse = alignParams(paramsOf([['循环风量', '710']]));
  const empty = alignParams([]);
  for (const key of FIELDS.map(field => field.key)) {
    assert.equal(viewIndexOf(sparse, key), viewIndexOf(empty, key), `${key} 因为加高亮挪位了`);
  }
});

test('未归类参数不参与 PK 统计，也不会被误标催填', () => {
  const view = alignParams(paramsOf([['噪音等级', '一级静音'], ['品牌', '格力']]));
  const extra = view.sections.find(section => section.id === 'unregistered');
  assert.ok(extra.items.every(item => !item.pk && !item.pkMissing));
  assert.equal(view.pkMissing, 11);
});

test('催填文案只有一处定义，前后端取同一句', () => {
  assert.equal(PK_MISSING_TEXT, '请尽快填写');
});
