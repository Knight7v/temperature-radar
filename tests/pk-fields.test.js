'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractPkFields, draftReason, paramOf, machineType, PK_ROWS, MISSING } = require('../lib/product/pk-fields');

const base = {
  model: 'KFR-35GW/NhGt1BGj',
  series: '天仪Pro 35机',
  params: [
    { name: 'APF 能效比', value: '5.31' },
    { name: '循环风量', value: '760m³/h' },
    { name: '铜管排数', value: '1.6排' },
    { name: '外机运行温度', value: '-7~43℃' },
    { name: '清洁方式', value: '56℃净菌自洁' },
    { name: 'WiFi 智控', value: '支持' }
  ]
};

test('extractPkFields：带得出知识库里的参数', () => {
  const f = extractPkFields(base);
  assert.equal(f.apf, '5.31');
  assert.equal(f.air, '760m³/h');
  assert.equal(f.copper, '1.6排');
  assert.equal(f.temp, '-7~43℃');
  assert.equal(f.clean, '56℃净菌自洁');
  assert.equal(f.ctrl, '遥控 / App');
});

test('extractPkFields：知识库没有的一律「—」，不编造', () => {
  const f = extractPkFields({ model: 'X', params: [] });
  assert.equal(f.apf, MISSING);
  assert.equal(f.air, MISSING);
  assert.equal(f.eco, MISSING);
  assert.equal(f.kwh, MISSING);
  assert.equal(f.ctrl, MISSING);
});

test('extractPkFields：参数值为「无」视同缺失', () => {
  const f = extractPkFields({ params: [{ name: 'APF 能效比', value: '无' }] });
  assert.equal(f.apf, MISSING);
});

test('extractPkFields：APF 别名也能认（APF / APF能效比）', () => {
  const f = extractPkFields({ params: [{ name: 'APF', value: '5.4' }] });
  assert.equal(f.apf, '5.4');
});

test('draftReason：冷酷外机最优先', () => {
  const data = { params: [{ name: '冷酷外机', value: '支持' }, { name: 'APF 能效比', value: '5.1' }] };
  assert.equal(draftReason(data), '冷酷外机 更耐候');
});

test('draftReason：双排铜管其次', () => {
  const data = { params: [{ name: '铜管排数', value: '双排' }] };
  assert.equal(draftReason(data), '双排铜管 硬核高配');
});

test('draftReason：APF 高按能效说，风量大按风量说', () => {
  assert.equal(draftReason({ params: [{ name: 'APF 能效比', value: '5.36' }] }), '高能效 省电之选');
  assert.equal(draftReason({ params: [{ name: '循环风量', value: '810' }] }), '大风量 更舒适');
  assert.equal(draftReason({ params: [{ name: 'APF 能效比', value: '5.1' }] }), '高效节能 品质之选');
});

test('draftReason：推荐理由落在 5~15 字', () => {
  for (const params of [[], [{ name: 'APF 能效比', value: '5.36' }], [{ name: '循环风量', value: '810' }]]) {
    const reason = draftReason({ params });
    const len = reason.replace(/\s/g, '').length;
    assert.ok(len >= 5 && len <= 15, `长度 ${len} 越界：${reason}`);
  }
});

test('PK_ROWS：行顺序与底图行名一致', () => {
  assert.deepEqual(PK_ROWS.map(r => r.label),
    ['推荐理由', 'APF值', '循环风量', '铜管排数', '节能模式', '运行温度', '清洁方式', '控制方式', '电量查询']);
});

test('paramOf：找不到名字返回缺失标记', () => {
  assert.equal(paramOf({}, ['不存在']), MISSING);
});

test('extractPkFields：WiFi 智控有值就给「遥控 / App」（实际取值是「格力+APP」这类，不是「支持」）', () => {
  assert.equal(extractPkFields({ params: [{ name: 'WiFi 智控', value: '格力+APP' }] }).ctrl, '遥控 / App');
  assert.equal(extractPkFields({ params: [{ name: 'WiFi 智控', value: '格力+APP/京东小家/天猫精灵语音' }] }).ctrl, '遥控 / App');
  assert.equal(extractPkFields({ params: [{ name: 'WiFi 智控', value: '无' }] }).ctrl, MISSING);
});

test('machineType：挂机跟挂机比、柜机跟柜机比，不许混', () => {
  assert.equal(machineType({ name: '云轩变频冷暖大1匹1级能效挂机空调 KFR-26GNhHa1BAs' }), '挂机');
  assert.equal(machineType({ model: 'KFR-35GW/(35546)FNhAf-B1(WIFI)' }), '挂机');
  assert.equal(machineType({ model: 'KFR-26GNhHa1BAs' }), '挂机');          /* 缺 W 的 G 码也是挂机 */
  assert.equal(machineType({ model: 'KFR-72LW/(72555)FNhAd-B1(WIFI)' }), '柜机');
  assert.equal(machineType({ name: '优逸变频冷暖3匹1级能效柜机空调 KFR-72LW/(72555)FNhAd-B1' }), '柜机');
  assert.equal(machineType({ name: '天仪Pro 35机', model: 'KFR-35GW/NhGt1BGj' }), '挂机');
  assert.equal(machineType({ name: '云之舒72', model: '云之舒72' }), '');     /* 认不出就返回空，不许猜 */
  assert.equal(machineType({}), '');
});
