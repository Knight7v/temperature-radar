'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const {
  parseMasterWorkbook,
  parseShopDetail,
  matchKey,
  extractModel,
  statusOf,
  importableStatus
} = require('../lib/product/gree-master');

const MASTER_HEADERS = [
  '主数据编码', '物料编码', '主数据名称', '平台类目', '广告语', '产品型号', '创建时间', '类目品牌',
  '外机质量（kg）', '内机质量（kg）', '外机尺寸（宽x高x深）mm', '外机装箱清单',
  '内机尺寸（宽x高x深）mm', '内机装箱清单', '电压/频率（V/Hz）', '颜色',
  '循环风量(m³/h)', '外机噪音dB（A）', '内机噪音dB（A）', '电辅加热功率（W）', '是否电辅加热',
  '制热功率(W)', '制冷剂', '制热量(W)', '制冷功率（W）', '制冷量（W）',
  '能源消耗效率', '适用面积（平方米）', '能效/水效', '定频/变频', '匹数', '单冷/冷暖', '挂机/柜机', '品牌', '内机商品69码'
];

function masterRow(overrides) {
  const row = new Array(MASTER_HEADERS.length).fill('');
  const byName = name => MASTER_HEADERS.indexOf(name);
  row[byName('平台类目')] = '空调/家用空调/挂式空调';
  row[byName('品牌')] = '格力';
  for (const [name, value] of Object.entries(overrides)) row[byName(name)] = value;
  return row;
}

async function buildMaster(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('挂式空调-852');
  ws.addRow(MASTER_HEADERS);
  for (const row of rows) ws.addRow(row);
  return wb.xlsx.writeBuffer();
}

test('从主数据名称抠型号：全角颜色括号、【状态】前缀都挡在外面', () => {
  assert.equal(
    extractModel('【#已会签】晶弘致享家变频冷暖正1.5匹1级能效挂机空调 KFR-35GW/JHFNhAb1Bt(皓雪白）'),
    'KFR-35GW/JHFNhAb1Bt'
  );
  assert.equal(extractModel('【#已会签】冷静王 KFR-35GW/(35549)FNhAc-B1(WIFI)'), 'KFR-35GW/(35549)FNhAc-B1(WIFI)');
  assert.equal(extractModel('【已淘汰】老款机器，没有型号'), '');
});

test('匹配键：剥颜色括号和「顶」，不剥 (WIFI)、(26598) 这类型号本体', () => {
  assert.equal(matchKey('KFR-72LW/NhBa1BAj顶(皓雪白)'), 'KFR-72LW/NHBA1BAJ');
  assert.equal(matchKey('KFR-35GW/NhAn1BAj(珊瑚玉)'), matchKey('KFR-35GW/NhAn1BAj'));
  assert.equal(matchKey('KFR-26GW/(26598)FNhAa-B1(WIFI)'), 'KFR-26GW/(26598)FNHAA-B1(WIFI)');
});

test('状态过滤：已会签/未会签导入，已淘汰/需处理/老国标判死不导；未会签的来源带标注', async () => {
  const buffer = await buildMaster([
    masterRow({ 主数据名称: '【#已会签】云佳 KFR-35GW/NhAa1BAj(皓雪白）', 物料编码: 'KB001' }),
    masterRow({ 主数据名称: '【未会签，请评估使用】新品 KFR-99GW/NhTest1AA', 物料编码: 'KB002' }),
    masterRow({ 主数据名称: '【需处理】待定 KFR-98GW/NhTest2AA', 物料编码: 'KB003' }),
    masterRow({ 主数据名称: '【已淘汰】老款 KFR-97GW/NhTest3AA', 物料编码: 'KB004' })
  ]);
  const out = await parseMasterWorkbook(buffer);
  assert.equal(out.products.length, 2);
  assert.equal(out.stats.skippedStatus['需处理'], 1);
  assert.equal(out.stats.skippedStatus['已淘汰'], 1, '2026-10-28 起已淘汰不再入库（用户拍板清洗）');
  const draft = out.products.find(p => matchKey(p.model) === matchKey('KFR-99GW/NhTest1AA'));
  assert.ok(draft, '未会签=草稿但活着，2026-10-28 起也入库');
  assert.equal(draft.source.name, '格力官方主数据（未会签）');
});

test('参数映射：尺寸/净重带单位，匹数去掉「正」，APF 剥掉括号说明，是否电辅热翻译成支持', async () => {
  const buffer = await buildMaster([
    masterRow({
      主数据名称: '【#已会签】云佳 KFR-35GW/NhAa1BAj(皓雪白）',
      物料编码: 'KB001',
      广告语: '循环大风量，56℃高温自洁，6年包修',
      颜色: '皓雪白',
      '外机质量（kg）': '25',
      '内机质量（kg）': '9',
      '外机尺寸（宽x高x深）mm': '802×555×350',
      '循环风量(m³/h)': '740',
      是否电辅加热: '是',
      '制热量(W)': '5010(150～6630)',
      能源消耗效率: '5.27(全年能源消耗效率）',
      匹数: '正1.5匹',
      '定频/变频': '变频'
    })
  ]);
  const out = await parseMasterWorkbook(buffer);
  const product = out.products[0];
  const get = name => product.params.find(p => p.name === name);
  assert.deepEqual(get('外机净重'), { name: '外机净重', value: '25', unit: 'kg' });
  assert.deepEqual(get('外机尺寸(宽x高x深)'), { name: '外机尺寸(宽x高x深)', value: '802×555×350', unit: 'mm' });
  assert.equal(get('APF 能效比').value, '5.27');
  assert.equal(get('匹数').value, '1.5匹');
  assert.equal(get('电辅热').value, '支持');
  /* 带区间的数不能装成纯数字配单位 */
  assert.equal(get('制热量').value, '5010(150～6630)');
  assert.equal(get('制热量').unit, '');
  assert.equal(product.materialCode, 'KB001');
  assert.deepEqual(product.appearance, [{ label: '颜色', value: '皓雪白' }]);
  assert.equal(product.features[0].title, '官方广告语');
  assert.equal(product.brand, '格力');
});

test('同型号多行（不同颜色）：参数取非空的补齐，颜色合并，物料编码不丢', async () => {
  const buffer = await buildMaster([
    masterRow({ 主数据名称: '【#已会签】云佳 KFR-35GW/NhAa1BAj(皓雪白）', 物料编码: 'KB001', 颜色: '皓雪白', '制冷量（W）': '3500' }),
    masterRow({ 主数据名称: '【#已会签】云佳 KFR-35GW/NhAa1BAj(珊瑚玉）', 物料编码: 'KB001', 颜色: '珊瑚玉', '循环风量(m³/h)': '710' })
  ]);
  const out = await parseMasterWorkbook(buffer);
  assert.equal(out.products.length, 1);
  assert.equal(out.products[0].colors === undefined, true);
  assert.deepEqual(out.products[0].appearance.map(a => a.value), ['皓雪白', '珊瑚玉']);
  const names = out.products[0].params.map(p => p.name);
  assert.ok(names.includes('制冷量') && names.includes('循环风量'));
  assert.equal(out.products[0].materialCode, 'KB001');
});

test('在售明细：同型号去重，同型号两个编码记冲突，非 KFR 写法保留', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['产品系列', '物料编码', '型号', '机型档次']);
  ws.addRow(['云佳Pro26', 'KB673000400', 'KFR-26GW/NhMa1BG', '普通机']);
  ws.addRow(['云佳Pro26', 'KB673000400', 'KFR-26GW/NhMa1BG', '普通机']);
  ws.addRow(['云锦Ⅲ', 'KB634000400', 'KFR-35GW/NhAe1BAj', '普通机']);
  ws.addRow(['云锦Ⅲ', 'KB634000800', 'KFR-35GW/NhAe1BAj', '普通机']);
  ws.addRow(['云恬26机X', 'KB394002400', '云恬26机X', '普通机']);
  const out = await parseShopDetail(await wb.xlsx.writeBuffer());
  assert.equal(out.items.length, 3);
  assert.equal(out.conflicts.length, 1);
  const tianyi = out.items.find(item => item.series === '云恬26机X');
  assert.equal(tianyi.model, '云恬26机X');
  assert.equal(tianyi.tier, '普通机');
});

test('statusOf / importableStatus：前缀识别', () => {
  assert.equal(statusOf('【#已会签】x'), '#已会签');
  assert.equal(statusOf('无前缀'), '');
  assert.equal(importableStatus('已会签'), true);
  assert.equal(importableStatus('老国标-已会签'), true);
  assert.equal(importableStatus('已淘汰'), false, '2026-10-28 起已淘汰不再入库');
  assert.equal(importableStatus('需处理'), false);
  assert.equal(importableStatus('未会签，请评估使用'), true, '未会签=草稿但活着，2026-10-28 起导入');
  assert.equal(importableStatus('老国标-待处理'), false);
  assert.equal(importableStatus(''), true, '没有状态前缀的行默认导');
});
