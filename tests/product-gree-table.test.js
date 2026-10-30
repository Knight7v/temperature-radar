'use strict';
/* 格力参数表 → 产品知识：转置、双值拆分、能效解析、已知错误修正。
 * 这张表是横向矩阵，一格常塞「1 匹/1.5 匹」两个值。拆错了客服拿到的数字就是错的，
 * 所以重点测「什么时候该拆、什么时候绝不能拆」「认不出来的宁可标待核实也不猜」。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
  splitModels,
  splitPair,
  pickByModel,
  parseEfficiency,
  normalizeValue,
  seriesKey,
  splitFeatures,
  featureCat,
  splitTitle,
  capacityOf,
  fixModel,
  stripUnit,
  parseWorkbook
} = require('../lib/product/gree-table');

test('型号从一格两行里拆出来，跳过 / 和图片，同一行挤两个型号也能断开', () => {
  assert.deepEqual(
    splitModels('KFR-26GW/NhMb1BG\nKFR-35GW/NhMb1BG'),
    ['KFR-26GW/NhMb1BG', 'KFR-35GW/NhMb1BG']
  );
  assert.deepEqual(
    splitModels('KFR-35GW/NhHf1BAj（白）KFR-35GW/NhHg1BAj（绿）'),
    ['KFR-35GW/NhHf1BAj(白)', 'KFR-35GW/NhHg1BAj(绿)']
  );
  assert.deepEqual(splitModels('/'), []);
  assert.deepEqual(splitModels('=DISPIMG("ID_123",1)'), []);
  assert.deepEqual(splitModels(''), []);
});

test('双值拆分：带单位的拆，颜色和文案绝不拆', () => {
  assert.deepEqual(splitPair('2660W/3520W'), ['2660W', '3520W']);
  assert.deepEqual(splitPair('710m3/h/800m3/h'), ['710m3/h', '800m3/h']);
  assert.deepEqual(splitPair('24kg/27kg'), ['24kg', '27kg']);
  assert.deepEqual(splitPair('2600/3500'), ['2600', '3500']);
  assert.equal(splitPair('皓雪白/侧面天鹅颈'), null);
  assert.equal(splitPair('格力+APP/京东小家APP/天猫精灵语音'), null);
  assert.equal(splitPair('56度净菌自洁/外机除尘'), null);
  assert.equal(splitPair('5.28'), null);
  assert.equal(splitPair('-35~60'), null);
});

test('按型号位次取值：只有数值型才拆，其他类型一台机器也原样', () => {
  assert.equal(pickByModel('2660W/3520W', 0, 2, { numeric: true }), '2660W');
  assert.equal(pickByModel('2660W/3520W', 1, 2, { numeric: true }), '3520W');
  assert.equal(pickByModel('710m3/h/800m3/h', 1, 2, { numeric: true }), '800m3/h');
  assert.equal(pickByModel('皓雪白/侧面天鹅颈', 1, 2, { numeric: false }), '皓雪白/侧面天鹅颈');
  assert.equal(pickByModel('2660W/3520W', 0, 1, { numeric: true }), '2660W/3520W');
});

test('能效一格混三样：等级、APF 字样、一到两个数值', () => {
  assert.deepEqual(parseEfficiency('5.28'), { level: '', apfs: ['5.28'] });
  assert.deepEqual(parseEfficiency('一级5.31/'), { level: '一级', apfs: ['5.31'] });
  assert.deepEqual(parseEfficiency('一级/APF5.28/5.27'), { level: '一级', apfs: ['5.28', '5.27'] });
  assert.deepEqual(parseEfficiency('一级/APF值5.35/5.32'), { level: '一级', apfs: ['5.35', '5.32'] });
  assert.deepEqual(parseEfficiency('三级/APF4.21'), { level: '三级', apfs: ['4.21'] });
  assert.deepEqual(parseEfficiency('一级'), { level: '一级', apfs: [] });
  assert.equal(parseEfficiency('/'), null);
});

test('是/否翻译成顾客能听懂的话；/ 和 — 表示没填，不留进库', () => {
  assert.equal(normalizeValue('是'), '支持');
  assert.equal(normalizeValue('√'), '支持');
  assert.equal(normalizeValue('否'), '不支持');
  assert.equal(normalizeValue('×'), '不支持');
  assert.equal(normalizeValue('/'), '');
  assert.equal(normalizeValue('—'), '');
  assert.equal(normalizeValue('全直流变频'), '全直流变频');
  assert.equal(normalizeValue('宽电压 童锁\n一键凉感'), '宽电压 童锁 一键凉感');
});

test('匹数从型号代号推：26=1匹 35=1.5匹 50=2匹 72=3匹', () => {
  assert.equal(capacityOf('KFR-26GW/NhMb1BG'), '1匹');
  assert.equal(capacityOf('KFR-35GW/NhMb1BG'), '1.5匹');
  assert.equal(capacityOf('KFR-50GW/NhKe1BAj'), '2匹');
  assert.equal(capacityOf('KFR-72LW/NhAg1BAj'), '3匹');
  assert.equal(capacityOf('BCD-531'), '');
});

test('已确认的抄写错误：漏 K、Nh 打成 h、内机代号和前缀打架', () => {
  assert.equal(fixModel('FR-72GW/Nhle3BAj'), 'KFR-72GW/Nhle3BAj');
  assert.equal(fixModel('KFR-26GW/hMa1BG'), 'KFR-26GW/NhMa1BG');
  assert.equal(fixModel('KFR-35GW/(26564)FNhAg-B1'), 'KFR-26GW/(26564)FNhAg-B1');
  assert.equal(fixModel('KFR-35GW/(35564)FNhAg-B1'), 'KFR-35GW/(35564)FNhAg-B1');
  assert.equal(fixModel('KFR-35GW/NhMb1BG'), 'KFR-35GW/NhMb1BG');
});

test('数字与单位分家：2660W → 2660+W，区间和文本不动，单位写法归一', () => {
  assert.deepEqual(stripUnit('2660W', 'W'), { value: '2660', unit: 'W' });
  assert.deepEqual(stripUnit('710m3/h', 'm³/h'), { value: '710', unit: 'm³/h' });
  assert.deepEqual(stripUnit('640立方米/小时', 'm³/h'), { value: '640', unit: 'm³/h' });
  assert.deepEqual(stripUnit('11.5kg/', 'kg'), { value: '11.5', unit: 'kg' });
  assert.deepEqual(stripUnit('制冷量：3500W', 'W'), { value: '3500', unit: 'W' });
  assert.deepEqual(stripUnit('-35~60', '℃'), { value: '-35~60', unit: '℃' });
  assert.deepEqual(stripUnit('18db~41db（超强风档）', ''), { value: '18db~41db（超强风档）', unit: '' });
});

test('系列名归一：去掉括号补充和挂机/柜机后缀，两张表才能对上', () => {
  assert.equal(seriesKey('云锦-II（畅销款）'), '云锦-II');
  assert.equal(seriesKey('云锦-II挂'), '云锦-II');
  assert.equal(seriesKey('云佳Pro（2025）'), '云佳PRO');
  assert.equal(seriesKey('云舒氧'), '云舒氧');
  assert.equal(seriesKey(''), '');
});

test('卖点拆条：【标签】当标题，京东素材码和宣传标题丢弃', () => {
  const items = splitFeatures('2025新品云佳Pro\n【省电】高能效系统设计，APF值5.31 #E-s66\n【舒适】海洋风800m³/h<br/>媲美小2匹');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '省电');
  assert.equal(items[0].detail, '高能效系统设计，APF值5.31');
  assert.equal(items[1].detail, '海洋风800m³/h 媲美小2匹');
});

test('卖点排版噪音：圈码编号、「5：」前缀、店铺备注都不是卖点内容', () => {
  const items = splitFeatures([
    '①新风科技，高效过滤',
    '5：节能：新一级能效，续航绿色低碳生活',
    '云舒氧挂机（店铺不销售）',
    '云佳1.5匹一级',
    'KFR-35GW/NhAa1BAj'
  ].join('\n'));
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '新风科技');
  assert.equal(items[1].title, '节能：新一级能效');
});

test('卖点标题不再截断成 18 字：整句进说明，标题只取到第一个标点', () => {
  const items = splitFeatures('典雅配色金秋白，以时尚绚烂生活如皎皎秋月，清朗俊秀');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '典雅配色金秋白');
  assert.ok(items[0].detail.includes('皎皎秋月'));
  // 没有标点的短句：整句就是标题，说明留空
  const one = splitFeatures('噪音低至22分贝');
  assert.equal(one[0].title, '噪音低至22分贝');
  assert.equal(one[0].detail, '');
});

test('卖点标题和说明一字不差时只留标题，不重复占一行', () => {
  const items = splitFeatures('【WiFi】WiFi\n【省电】省电，省到年底');
  assert.equal(items[0].title, 'WiFi');
  assert.equal(items[0].detail, '');
  assert.equal(items[1].title, '省电');
  assert.equal(items[1].detail, '省电，省到年底');
});

test('卖点七类归类：撞词决定展示分组，撞不上归「其他」', () => {
  assert.equal(featureCat('新一级能效 节能高效'), 'energy');
  assert.equal(featureCat('5档风速 大风量'), 'climate');
  assert.equal(featureCat('内机56°净菌自清洁'), 'health');
  assert.equal(featureCat('格力+APP 远程操控'), 'smart');
  assert.equal(featureCat('噪音低至22分贝 睡眠模式'), 'comfort');
  assert.equal(featureCat('典雅配色金秋白'), 'look');
  assert.equal(featureCat('冷静王是属于时光绘的升级款'), 'other');
});

/** 造一张最小参数表：两列系列 × 几行参数，验证转置主线 */
async function buildSheet(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('挂机');
  ws.addRow(['格力挂机空调型号功能参数一览表']);
  ws.addRow(['分类', '分类', '测试系列A', '测试系列B（2025）']);
  ws.addRow(['产品外观', '型号', 'KFR-26GW/NhZz1AA\nKFR-35GW/NhZz1AA', 'KFR-26GW/NhZy1AA\nKFR-35GW/NhZy1AA']);
  for (const row of rows) ws.addRow(row);
  return wb.xlsx.writeBuffer();
}

test('整表转置：双值按型号位次拆开，两台机器各拿各的数', async () => {
  const buffer = await buildSheet([
    ['产品参数', '制冷量', '2600/3500', '2660W/3520W'],
    ['产品参数', '制热量', '4500/5000', '5020W/4560W'],
    ['产品外观', '外观', '皓雪白', '肤感白/极地白'],
    ['产品参数', '能效等级/APF值', '一级/APF5.28/5.27', '一级5.31/'],
    ['产品功能卖点', '智能WIFI', '/', '格力+APP'],
    ['产品功能卖点', '独立除湿', '是', '是'],
    ['产品参数', '推荐理由', '内部评价不进库', '内部评价不进库'],
    ['核心配件参数', '节流部件（电子膨胀阀/毛细管）', '电子膨胀阀', '毛细管']
  ]);
  const out = await parseWorkbook(buffer, { group: 'gree-ac' });
  assert.deepEqual(out.stats.imageFields, []);
  assert.equal(out.products.length, 4);

  const a = out.products.find(item => item.model === 'KFR-26GW/NhZz1AA');
  assert.equal(a.name, '测试系列A 1匹');
  assert.equal(a.params.find(item => item.name === '制冷量').value, '2600');
  assert.equal(a.params.find(item => item.name === '制冷量').unit, 'W');
  assert.equal(a.params.find(item => item.name === 'APF 能效比').value, '5.28');
  assert.equal(a.params.find(item => item.name === '独立除湿').value, '支持');
  assert.equal(a.params.find(item => item.name === 'WiFi 智控'), undefined, '「/」是不支持也不是没填，不留下误导');
  assert.equal(a.params.find(item => item.name === '推荐理由'), undefined, '内部评价不进对客口径');
  assert.equal(a.params.find(item => item.name === '节流部件').value, '电子膨胀阀');

  const b1 = out.products.find(item => item.model === 'KFR-26GW/NhZy1AA');
  const b2 = out.products.find(item => item.model === 'KFR-35GW/NhZy1AA');
  assert.equal(b1.name, '测试系列B（2025） 1匹');
  assert.equal(b1.params.find(item => item.name === '制冷量').value, '2660');
  assert.equal(b2.params.find(item => item.name === '制冷量').value, '3520');
  assert.equal(b1.params.find(item => item.name === 'APF 能效比').value, '5.31');
  assert.equal(b2.params.find(item => item.name === 'APF 能效比').value, '5.31');
  assert.equal(b1.params.find(item => item.name === '颜色').value, '肤感白/极地白', '颜色不是数值，整段保留');
});

test('单型号的列遇到双值：原样保留并标待核实，不替人猜', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('柜机');
  ws.addRow(['t']);
  ws.addRow(['分类', '分类', '单型号系列']);
  ws.addRow(['产品外观', '型号', 'KFR-72LW/NhZx1AA']);
  ws.addRow(['产品参数', '外机净重（KG）', '35/42kg']);
  const out = await parseWorkbook(await wb.xlsx.writeBuffer(), { group: 'gree-ac' });
  assert.equal(out.products.length, 1);
  const weight = out.products[0].params.find(item => item.name === '外机净重');
  assert.equal(weight.value, '35/42kg');
  assert.equal(weight.unit, '');
  assert.equal(weight.needsReview, true);
});

test('同型号在两张表里都出现：保留参数多的那条，不重复入库', async () => {
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet('挂机');
  ws1.addRow(['t']);
  ws1.addRow(['分类', '分类', '系列一']);
  ws1.addRow(['产品外观', '型号', 'KFR-26GW/NhZw1AA']);
  ws1.addRow(['产品参数', '制冷量', '2600']);
  const ws2 = wb.addWorksheet('柜机');
  ws2.addRow(['t']);
  ws2.addRow(['分类', '分类', '系列一柜']);
  ws2.addRow(['产品外观', '型号', 'KFR-26GW/NhZw1AA']);
  ws2.addRow(['产品参数', '制冷量', '2600']);
  ws2.addRow(['产品参数', '制热量', '4500']);
  const out = await parseWorkbook(await wb.xlsx.writeBuffer(), { group: 'gree-ac' });
  assert.equal(out.products.length, 1);
  assert.equal(out.products[0].params.length, 2, '留下参数全的那条');
});

test('认不出来的行不静默丢弃：给警告；不是参数表的文件直接说明原因', async () => {
  const buffer = await buildSheet([
    ['产品参数', '神秘新参数', '123', '456']
  ]);
  const out = await parseWorkbook(buffer, { group: 'gree-ac' });
  assert.ok(out.warnings.some(item => item.includes('神秘新参数')));

  const empty = await parseWorkbook(await new ExcelJS.Workbook().xlsx.writeBuffer(), { group: 'gree-ac' });
  assert.equal(empty.products.length, 0);
  assert.ok(empty.warnings[0].includes('没找到挂机/柜机参数表'));
});
