'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { parseDistributionWorkbook, seriesName } = require('../lib/product/gree-distribution');
const { formatSeries } = require('../lib/product/series-format');

const HEADERS = ['序号', '产品类型', '成品码', '机型', '分销机型档次', '挂/柜机', '系列名称'];

async function buildSheet(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('机型清单（全）');
  ws.addRow(['2026年格力线上零售分销家用空调机型清单']);
  ws.addRow(HEADERS);
  for (const row of rows) ws.addRow(row);
  return wb.xlsx.writeBuffer();
}

test('系列名称：剥掉变频/定频、分体/柜机、能效级数和尾部括号', () => {
  assert.equal(seriesName('云佳变频分体3级'), '云佳');
  assert.equal(seriesName('云锦-Ⅲ变频柜机1级'), '云锦-Ⅲ');
  assert.equal(seriesName('风赏变频分体1级（UVC)'), '风赏');
  assert.equal(seriesName('臻新风变频柜机1级（双向新风、语音)'), '臻新风');
  assert.equal(seriesName('冷静王+变频分体1级'), '冷静王+');
  assert.equal(seriesName('移动空调'), '移动空调');
  assert.equal(seriesName('格力帐篷空调\n（蓝牙音箱）'), '格力帐篷空调');
});

test('解析清单：表头在第 2 行、表尾说明行跳过、成品码统一大写', async () => {
  const buffer = await buildSheet([
    ['1', '云佳变频分体3级', 'KB542040400', '26机系列化(珊瑚玉)', '引流机', '挂机', '云佳三级26机'],
    ['2', '云锦Pro变频柜机1级', 'kb698000100', '26机', '中端机', '柜机', '云锦Pro26机'],
    [null, { richText: [{ text: '  说明：适用时间为2026年3月1日-12月31日' }] }, '', '', '', '', ''],
    ['3', '天仪变频分体1级', 'KB649040400', '26机系列化(皓雪白)', '', '挂机', '']
  ]);
  const { items, skipped } = await parseDistributionWorkbook(buffer);
  assert.equal(items.length, 2);
  assert.equal(skipped, 2);
  assert.deepEqual(items[0], {
    type: '云佳变频分体3级', code: 'KB542040400', machine: '26机系列化(珊瑚玉)',
    tier: '引流机', kind: '挂机', series: '云佳三级26机'
  });
  assert.equal(items[1].code, 'KB698000100');
  assert.equal(items[1].series, '云锦Pro26机');
});

test('系列名称：优先 G 列核定写法，G 列缺了再用产品类型剥后缀兜底', async () => {
  const buffer = await buildSheet([
    ['1', '云佳变频分体3级', 'KB001', '26机', '引流机', '挂机', ''],
    ['2', '云佳变频分体3级', 'KB002', '35机', '引流机', '挂机', '云佳三级35机']
  ]);
  const { items } = await parseDistributionWorkbook(buffer);
  assert.equal(items[0].series, '云佳');
  assert.equal(items[1].series, '云佳三级35机');
});

test('档位只认四档：未知档位的行当脏数据跳过', async () => {
  const buffer = await buildSheet([
    ['1', '云佳变频分体1级', 'KB001', '26机', '特价机', '挂机', ''],
    ['2', '云佳变频分体1级', 'KB002', '26机', '高端机', '挂机', '']
  ]);
  const { items } = await parseDistributionWorkbook(buffer);
  assert.equal(items.length, 1);
  assert.equal(items[0].tier, '高端机');
});

test('系列名统一格式：用户的月亮女神样例原样复现', () => {
  const { series } = formatSeries(
    '月亮女神变频冷暖正1.5匹1级能效挂机空调 KFR-35GW/(35579)FNhCc-B1(WIFI)(珊瑚玉)',
    'KFR-35GW/(35579)FNhCc-B1(WIFI)'
  );
  assert.equal(series, '月亮女神35机(珊瑚玉)');
});

test('系列名统一格式：1级删、3级转「三级」、2级转「二级」，匹数和型号串全清', () => {
  assert.equal(
    formatSeries('云逸3级能效 2匹', 'KFR-50LW/NhGm3BAj').series, '云逸三级50机');
  assert.equal(
    formatSeries('云逸1级能效 2匹', 'KFR-50LW/NhGm1BAj').series, '云逸50机');
  assert.equal(
    formatSeries('画时代变频冷暖2匹2级能效挂机空调 KFR-50GW/(50444)FNhCa-B2(WIFI)(珍珠黑)', 'KFR-50GW/(50444)FNhCa-B2(WIFI)').series,
    '画时代二级50机(珍珠黑)');
});

test('系列名统一格式：颜色从括号/裸写/「顶 白色」里挑，修饰词不当颜色', () => {
  assert.equal(formatSeries('明珠（高端） 3匹', 'KFR-72LW/(72502)FNhCc-B1(WIFI)(珊瑚玉)').series, '明珠72机(珊瑚玉)');
  assert.equal(formatSeries('凉之夏（线下款式） 1.5匹', 'KFR-35GW/(35564)FNhAg-B1(WIFI)').series, '凉之夏35机');
  assert.equal(formatSeries('冷静悦变频冷暖大1匹3级能效挂机空调 KFR-26GW/(26575)FNCa-A3 奢华金', 'KFR-26GW/(26575)FNCa-A3').series, '冷静悦三级26机(奢华金)');
  assert.equal(formatSeries('绿嘉园定频冷暖2匹1级能效挂机空调 KFR-50GW/(50556)NhAb-1(含管) 顶 白色', 'KFR-50GW/(50556)NhAb-1').series, '绿嘉园50机(白色)');
  assert.equal(formatSeries('格力•汉白玉变频冷暖大1匹1级能效挂机空调 KFR-26GW/(26566)FNhDa-B1(WIFI)(皓雪白)', 'KFR-26GW/(26566)FNhDa-B1(WIFI)').series, '汉白玉26机(皓雪白)');
});
