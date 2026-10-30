'use strict';

// 格力「产品参数一览表」→ 产品知识库记录。
//
// 这张表是横向矩阵：一列一个系列，一行一个参数。系统要「一台机器一条记录」，所以这里做转置。
// 三件事必须做对，否则客服拿到的数字是错的：
//   1. 一列可能对应两台机器（型号行里常写「1 匹 / 1.5 匹」两行，偶尔挤在同一行），参数要按位次拆；
//   2. 一格常塞两个值（制冷量 2650/3500），1 匹取前者、1.5 匹取后者，不能原样搬给顾客；
//   3. 「/」是不支持、「=DISPIMG(...)」是图片（内外机尺寸全在图片里），都不能当文字用。
//
// 这里只做「搬运和归位」，不判断哪条重要、也不改写内容。判断留给人，或者留给后面的建议模块。

const ExcelJS = require('exceljs');
const { groupById, cleanModel } = require('./groups');

// 一张表最多吃这么多型号，防止有人误传几十万行的东西把内存打满
const MAX_MODELS = 400;
// 单表最多读这么多列，正常最多 27 列
const MAX_COLS = 40;

// 行标签 → 字段。key 是表里第 2 列的原文，必须一字不差。
//   param    普通参数，值原样搬
//   num      数值参数，可能含「1匹值/1.5匹值」，要按型号位次拆
//   eff      能效，一格混了等级和 APF，要拆成两条
//   image    这一行是图片，文字里没有数据 —— 记下来告诉主管为什么缺
//   internal 内部评价（推荐理由），不能进对客口径
//   skip     型号行、表头等，不产生参数
const ROWS = {
  '外观': { kind: 'param', name: '颜色' },
  '面板工艺': { kind: 'param', name: '面板工艺' },
  '能效等级/APF值': { kind: 'eff' },
  '能效等级': { kind: 'eff' },
  '制冷量': { kind: 'num', name: '制冷量', unit: 'W' },
  '制热量': { kind: 'num', name: '制热量', unit: 'W' },
  '风量m³/h': { kind: 'num', name: '循环风量', unit: 'm³/h' },
  '电辅热功率（w）': { kind: 'num', name: '电辅热功率', unit: 'W' },
  '内机净重（KG）': { kind: 'num', name: '内机净重', unit: 'kg' },
  '外机净重（KG）': { kind: 'num', name: '外机净重', unit: 'kg' },
  '导风板类型': { kind: 'param', name: '导风板' },
  '出风口设计': { kind: 'param', name: '出风口设计' },
  '送风角度': { kind: 'param', name: '送风角度' },
  '制冷剂': { kind: 'param', name: '制冷剂' },
  '调温': { kind: 'param', name: '温度调节' },
  '智能WIFI': { kind: 'param', name: 'WiFi 智控' },
  '智能光敏护眠': { kind: 'param', name: '智能光敏' },
  '变频类型': { kind: 'param', name: '变频类型' },
  '冷酷外机': { kind: 'param', name: '冷酷外机' },
  '外机运行温度': { kind: 'param', name: '外机运行温度', unit: '℃' },
  '是否防直吹': { kind: 'param', name: '防直吹' },
  '独立除湿': { kind: 'param', name: '独立除湿' },
  '定时功能': { kind: 'param', name: '定时' },
  '内机噪音': { kind: 'param', name: '内机噪音' },
  '风速': { kind: 'param', name: '风速档位' },
  '风速档位': { kind: 'param', name: '风速档位' },
  '睡眠模式': { kind: 'param', name: '睡眠模式' },
  '清洁方式': { kind: 'param', name: '清洁方式' },
  '其他卖点': { kind: 'param', name: '其他卖点' },
  '制冷模式自主检测室温': { kind: 'param', name: '自主检测室温' },
  '保温模式': { kind: 'param', name: '保温模式' },
  '制热防冷风': { kind: 'param', name: '制热防冷风' },
  '节流部件（电子膨胀阀/毛细管）': { kind: 'param', name: '节流部件' },
  '铜管排数': { kind: 'param', name: '铜管排数' },
  '1匹内外机尺寸（宽x高x深）mm': { kind: 'image', name: '内外机尺寸' },
  '1.5匹内外机（宽x高x深）mm': { kind: 'image', name: '内外机尺寸' },
  '2匹内外机尺寸（宽x高x深）mm': { kind: 'image', name: '内外机尺寸' },
  '3匹内外机（宽x高x深度）mm': { kind: 'image', name: '内外机尺寸' },
  '3匹内外机（宽x高x深）mm': { kind: 'image', name: '内外机尺寸' },
  '吹风方式': { kind: 'image', name: '吹风方式' },
  '吹风模式': { kind: 'image', name: '吹风方式' },
  '进风口类型': { kind: 'image', name: '进风口类型' },
  '机器图片': { kind: 'image', name: '机器图片' },
  '价格/匹数': { kind: 'skip' },
  '型号': { kind: 'skip' },
  '推荐理由': { kind: 'internal' }
};

// 已知错误修正。客服主管 2026-10-27 逐条确认过，改这里要同步告诉主管。
// key = 「挂机/柜机 + 系列名」，value = 正确的型号序列（顺序与表里 2 匹/3 匹一致）。
const SERIES_MODEL_OVERRIDE = {
  '柜机|云锦-III': ['KFR-50LW/NhBa1BAj', 'KFR-72LW/NhBa1BAj']
};

// 整列不能用的系列：表里只有零散卖点，型号和核心参数都是空的
const SERIES_SKIP = [{ sheet: '挂机', series: /^节能王子Pro/i, reason: '这一列只有零散卖点，没有型号和核心参数，等补齐后再导' }];

// 单型号写法修正：表里手抄造成的错字。
// 京韵3级漏打头部 K、云佳Pro 把 Nh 打成 h —— 两处都是客服主管 2026-10-27 确认的。
const MODEL_FIXUP = [
  { test: /^FR-\d/i, fix: text => `K${text}` },
  { test: /^KFR-26GW\/hMa1BG$/i, fix: () => 'KFR-26GW/NhMa1BG' }
];

// 匹数区间。型号里的两位数字是制冷量代号，26≈1 匹、35≈1.5 匹、50≈2 匹、72≈3 匹。
const CAPACITY_BANDS = [
  [23, 28, '1匹'],
  [30, 36, '1.5匹'],
  [44, 52, '2匹'],
  [56, 62, '2.5匹'],
  [66, 76, '3匹'],
  [78, 90, '4匹'],
  [100, 130, '5匹']
];

const YES_VALUES = new Set(['是', '有', '√', '支持', '带', '标配', '全系标配']);
const NO_VALUES = new Set(['否', '无', '×', '不支持', '不带', '没有']);

/** 表格单元格取值：兼容富文本、公式结果、超链接，统一成字符串 */
function cellText(ws, rowNumber, colNumber) {
  const value = ws.getRow(rowNumber).getCell(colNumber).value;
  if (value == null) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(item => item.text || '').join('').trim();
    if (value.text != null) return String(value.text).trim();
    if (value.result != null) return String(value.result).trim();
    if (value.hyperlink) return String(value.hyperlink).trim();
    return '';
  }
  return String(value).trim();
}

const isImageCell = text => /^=?\s*DISPIMG/i.test(String(text || ''));

/** 「1 匹 / 1.5 匹」两个型号：换行各一个，也可能挤在同一行里 */
function splitModels(raw) {
  const out = [];
  for (const line of String(raw || '').split(/[\r\n]+/)) {
    const text = line.trim();
    if (!text || text === '/' || text === '／' || isImageCell(text)) continue;
    // 同一格里挤了两个型号时，在第二个 KFR- 之前断开
    const chunks = text.split(/(?=KFR-)/i).map(item => item.trim()).filter(Boolean);
    for (const chunk of chunks) {
      const fixed = fixModel(chunk);
      if (fixed && !out.includes(fixed)) out.push(fixed);
    }
  }
  return out;
}

function fixModel(model) {
  let text = cleanModel(model);
  if (!text) return '';
  for (const rule of MODEL_FIXUP) {
    if (rule.test.test(text)) {
      text = rule.fix(text);
      break;
    }
  }
  return alignCapacityCode(text);
}

/**
 * 型号前缀和括号里的内机代号打架时，以内机代号为准。
 * 例：KFR-35GW/(26564)FNhAg-B1 —— 括号里 26564 是 1 匹的内机，前缀 35 是表里抄错的。
 * 这类错看着不起眼，但会让「1 匹」和「1.5 匹」两台机器记成同一个型号，后写的盖掉先写的。
 */
function alignCapacityCode(model) {
  const match = String(model || '').match(/^KFR-(\d{2})(?:GW|LW)\/\((\d{5})\)/i);
  if (!match) return model;
  if (match[1] === match[2].slice(0, 2)) return model;
  return model.replace(/^KFR-\d{2}/i, `KFR-${match[2].slice(0, 2)}`);
}

/**
 * 判重用的键：去掉「(含管)顶」这类备注后缀。
 * 注意不能把所有括号都去掉——云舒氧的（白）（绿）是两台不同颜色的机器。
 */
function dedupeKey(model) {
  return String(model || '')
    .replace(/[（(]含管[）)]\s*顶?$/u, '')
    .toUpperCase();
}

function capacityOf(model) {
  const match = String(model || '').match(/KFR-(\d{2,3})/i);
  if (!match) return '';
  const size = Number(match[1]);
  for (const [low, high, label] of CAPACITY_BANDS) {
    if (size >= low && size <= high) return label;
  }
  return '';
}

/**
 * 「2600/3500」这种一格两值的格式。
 * 值常带单位（2660W/3520W、710m3/h/800m3/h、24kg/27kg），所以两段都按「数字开头 + 短单位」认，
 * 不要求纯数字——否则带单位的型号会漏拆，客服问 1 匹制冷量，答案里还挂着 1.5 匹的数。
 * 只在数值类型（kind=num）的参数上调用，所以「皓雪白/侧面天鹅颈」这类颜色不会被误拆。
 */
const PAIR_RE = /^(\d[\w./%℃°³-]{0,8}?)\/(\d[\w./%℃°³-]{0,10})$/;

function splitPair(raw) {
  const text = String(raw || '').replace(/\s+/g, '');
  const match = text.match(PAIR_RE);
  if (!match) return null;
  return [match[1], match[2]];
}

/** 按型号位次取值：一台机器时原样返回，两台机器时各取一段 */
function pickByModel(raw, index, modelCount, { numeric = false } = {}) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (!numeric || modelCount <= 1) return text;
  const pair = splitPair(text);
  if (!pair) return text;
  return pair[Math.min(index, pair.length - 1)];
}

/** 单位写法归一：表里 m3/h、m³/h、M3/H 混着写，统一成一种 */
const UNIT_ALIAS = {
  'm3/h': 'm³/h',
  'm3h': 'm³/h',
  'm³/h': 'm³/h',
  '立方米/小时': 'm³/h',
  'w': 'W',
  'kg': 'kg',
  'db': 'dB',
  'db(a)': 'dB(A)'
};

function cleanUnit(unit) {
  const text = String(unit || '').trim();
  if (!text) return '';
  return UNIT_ALIAS[text.toLowerCase()] || text;
}

/**
 * 数字和单位分家：2660W → 2660 + W；710m3/h → 710 + m3/h。
 * 带「~」区间的（-35~60、18db~41db）不拆——那种整体才是值，硬拆会把上下限拆丢。
 */
function stripUnit(value, fallback) {
  // 少数格子写成「制冷量：3500W」或「11.5kg/」，前缀和尾巴都是手误，去掉再拆。
  // 单位段不允许出现「~」：-35~60、18db~41db 这种区间整体才是值，硬拆会把上下限拆丢。
  const text = String(value || '')
    .replace(/^[^：:\/]{1,6}[：:]\s*/, '')
    .replace(/[\/／]\s*$/, '');
  const match = text.match(/^([-+]?\d+(?:\.\d+)?)\s*([^\d~][^~]{0,7})?$/);
  if (!match) return { value: String(value || ''), unit: cleanUnit(fallback) };
  return { value: match[1], unit: cleanUnit(match[2] || fallback) };
}

/** 把「是/否」翻译成顾客能听懂的话，其余原样保留 */
function normalizeValue(raw) {
  const text = String(raw || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return '';
  if (text === '/' || text === '／' || text === '-' || text === '—') return '';
  if (YES_VALUES.has(text)) return '支持';
  if (NO_VALUES.has(text)) return '不支持';
  return text;
}

/** 能效一格混三样东西：等级、APF 值（可能两个）、有的还带「APF」字样 */
function parseEfficiency(raw) {
  const text = String(raw || '').trim();
  if (!text || text === '/' || text === '／') return null;
  const levelMatch = text.match(/(新?[一二三])级/);
  const level = levelMatch ? `${levelMatch[1]}级` : '';
  const apfs = text.match(/\d\.\d{1,2}/g) || [];
  return { level, apfs };
}

function seriesOf(ws, headerRow, colNumber) {
  return cellText(ws, headerRow, colNumber);
}

/** 找到「分类」那一行：它是整张表的行头起点，不写死行号，防主管插行 */
function findHeaderRow(ws) {
  const limit = Math.min(8, ws.rowCount || 0);
  for (let row = 1; row <= limit; row += 1) {
    if (cellText(ws, row, 1) === '分类') return row;
  }
  return 0;
}

/** 型号行：紧跟分类行、第 2 列写「型号」的那几行（通常 2 行） */
function findModelRows(ws, headerRow) {
  const rows = [];
  const limit = Math.min(headerRow + 4, ws.rowCount || 0);
  for (let row = headerRow + 1; row <= limit; row += 1) {
    if (cellText(ws, row, 2) === '型号') rows.push(row);
  }
  return rows;
}

/**
 * 解析一张参数表（挂机或柜机）。
 * 返回每个系列转置后的参数袋，再由上层按型号拆成一条条记录。
 */
function parseParamsSheet(ws, { sheetKind }) {
  const headerRow = findHeaderRow(ws);
  if (!headerRow) return { columns: [], imageFields: new Set(), warnings: [] };

  const modelRows = findModelRows(ws, headerRow);
  if (!modelRows.length) return { columns: [], imageFields: new Set(), warnings: [`${ws.name} 没找到型号行，已跳过`] };

  const width = Math.min(ws.columnCount || 0, MAX_COLS);
  const columns = [];
  for (let col = 3; col <= width; col += 1) {
    const series = seriesOf(ws, headerRow, col);
    if (!series) continue;
    const models = [];
    for (const row of modelRows) {
      for (const model of splitModels(cellText(ws, row, col))) {
        if (!models.includes(model)) models.push(model);
      }
    }
    columns.push({ col, series, models });
  }

  const imageFields = new Set();
  const warnings = [];

  /* 逐行读参数，先按「系列列」暂存原值，等知道每列有几个型号之后再决定怎么拆 */
  const lastRow = Math.min(ws.rowCount || 0, headerRow + 80);
  for (let row = headerRow + 1; row <= lastRow; row += 1) {
    const label = cellText(ws, row, 2);
    if (!label) continue;
    const field = ROWS[label];
    if (!field) {
      warnings.push(`没认出来的参数行「${label}」，已跳过`);
      continue;
    }
    if (field.kind === 'skip' || field.kind === 'internal') continue;
    if (field.kind === 'image') {
      imageFields.add(field.name);
      continue;
    }
    for (const column of columns) {
      const raw = cellText(ws, row, column.col);
      if (!raw) continue;
      if (isImageCell(raw)) {
        imageFields.add(field.name);
        continue;
      }
      column.cells = column.cells || [];
      column.cells.push({ field, raw });
    }
  }

  return { columns, imageFields, warnings };
}

/** 把一个系列列变成 N 条产品记录（N = 该列的型号数） */
function buildProducts(column, { sheetKind, group }) {
  const target = groupById(group) || {};
  const { series, models, cells } = column;
  const products = [];

  const override = SERIES_MODEL_OVERRIDE[`${sheetKind}|${series}`];
  const finalModels = override ? override.slice() : models.slice();

  finalModels.forEach((model, index) => {
    const capacity = capacityOf(model);
    const params = [];
    const internal = [];

    for (const { field, raw } of cells || []) {
      if (field.kind === 'eff') {
        const eff = parseEfficiency(pickByModel(raw, index, finalModels.length));
        if (!eff) continue;
        if (eff.level) params.push({ name: '能效等级', value: eff.level, unit: '' });
        const apf = eff.apfs.length ? (eff.apfs[index] || eff.apfs[eff.apfs.length - 1]) : '';
        if (apf) params.push({ name: 'APF 能效比', value: apf, unit: '' });
        continue;
      }
      const picked = pickByModel(raw, index, finalModels.length, { numeric: field.kind === 'num' });
      const value = normalizeValue(picked);
      if (!value) continue;

      let split;
      let review = false;
      if (field.kind === 'num') {
        if (finalModels.length === 1 && splitPair(value)) {
          /* 这一列只有一台机器，格子里却写了两个值（另一台在别的列）。
             不知道哪个属于它，原样留着并标「待核实」，让人来定——猜错比缺着更糟。 */
          split = { value, unit: '' };
          review = true;
        } else {
          split = stripUnit(value, field.unit);
        }
      } else {
        split = { value, unit: field.unit || '' };
      }
      params.push({ name: field.name, value: split.value, unit: split.unit, needsReview: review || undefined });
    }

    products.push({
      group,
      model,
      name: [series, capacity].filter(Boolean).join(' '),
      brand: target.brand || '格力',
      category: target.category || '空调',
      appearance: [],
      features: [],
      params,
      service: [],
      summary: '',
      source: { type: 'table', name: `${sheetKind}参数表`, chars: params.length, aiUsed: false },
      meta: { sheet: sheetKind, series, capacity, internal }
    });
  });

  return products;
}

/* ---------------- 卖点：从「产品功能卖点」那张表按系列挂过来 ---------------- */

/** 系列名归一：去掉括号补充、去掉挂机/柜机后缀，只留主体，用于两张表对齐 */
function seriesKey(name) {
  return String(name || '')
    .replace(/[（(][^）)]{0,20}[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/(挂机|柜机|挂|柜)$/u, '')
    .toUpperCase();
}

/* 66 个型号 500 多条卖点的共性：讲来说去就是七件事。
   分类只决定「展示时归到哪一组」，不改内容、不丢条目。 */
const FEATURE_CATS = [
  { id: 'energy', name: '节能能效', re: /能效|省电|节能|变频|APF|耗电|电费|低碳/ },
  { id: 'climate', name: '冷暖风感', re: /制冷|制热|冷暖|风量|风速|送风|导风|防直吹|出风|进风|风口|除湿|换气|气流|暖屏|冷风|冷酷/ },
  { id: 'health', name: '清洁健康', re: /自洁|自清洁|净菌|杀菌|除菌|抗菌|过滤|新风|健康|除尘|蒸发器|UVC|紫外|净荷|烘干/ },
  { id: 'smart', name: '智能操控', re: /wifi|WiFi|WIFI|app|APP|智能|蓝牙|语音|遥控|远程|操控|智控|天猫精灵|小度|屏显/ },
  { id: 'comfort', name: '舒适静音', re: /噪音|静音|睡眠|光敏|舒适|温控|精准|恒温|分贝|防冷风|童锁/ },
  { id: 'look', name: '外观工艺', re: /配色|外观|面板|圆柱|工艺|颜值|曲线|机身|材质|设计|金秋|时尚/ }
];
const CAT_NAMES = {
  energy: '节能能效',
  climate: '冷暖风感',
  health: '清洁健康',
  smart: '智能操控',
  comfort: '舒适静音',
  look: '外观工艺',
  other: '其他'
};

/** 卖点归哪一类：按上面的顺序撞词，撞不上归「其他」 */
function featureCat(title) {
  const text = String(title || '');
  for (const cat of FEATURE_CATS) {
    if (cat.re.test(text)) return cat.id;
  }
  return 'other';
}

/** 标题取到第一个标点为止（最长 24 字），整句留在说明里 —— 标题管「是什么」，说明管「怎么说」。
    第一个标点切出来太短（如「节能：」只切到 2 个字）就往后挪一个标点再切。 */
function splitTitle(text) {
  const marks = [...text.matchAll(/[，。；,;：:]/g)].map(match => match.index);
  let end = marks.length ? marks[0] : text.length;
  for (const index of marks) {
    if (index >= 4) { end = index; break; }
  }
  const cut = text.slice(0, end).trim();
  if (cut.length < 4) return text.slice(0, 40);
  return cut.length > 24 ? cut.slice(0, 24) : cut;
}

/** 卖点话术拆条：一行一条，带【标签】的把标签当标题 */
function splitFeatures(raw) {
  const clean = String(raw || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/#E-[a-z]\d+/gi, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '')
    .trim();
  const out = [];
  for (const line of clean.split(/[\r\n]+/)) {
    let text = line
      /* 表里的圈码编号（①②③）和「5：」是排版噪音，不是卖点内容 */
      .replace(/^(?:[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF])+/u, '')
      .replace(/^[\s\-—·•●○]+/, '')
      .replace(/^\d+\s*[.、)）：:]\s*/, '')
      .trim();
    text = text.replace(/\s{2,}/g, ' ');
    if (text.length < 4) continue;
    // 「2025新品云佳Pro」这类是宣传标题，不是卖点，收进来只会让评价时误判「已讲到」
    if (/^\d{4}\s*新(款|品)/.test(text)) continue;
    // 「店铺不销售」是内部备注
    if (/店铺不销售/.test(text)) continue;
    // 纯型号行、短促销碎片（「云佳1.5匹一级」）是排版，不是卖点
    if (/^KFR/i.test(text)) continue;
    if (text.length <= 12 && !/[，。；,;：:]/.test(text) && /(匹|级|挂机|柜机)$/.test(text)) continue;
    const tagged = text.match(/^[【\[{〔]\s*([^\】\]}〕]{2,12})\s*[】\]}〕]\s*(.*)$/);
    let title = '';
    let detail = '';
    if (tagged) {
      title = tagged[1].trim();
      detail = tagged[2].trim().replace(/^[：:]\s*/, '');
    } else {
      title = splitTitle(text);
      detail = text.length > title.length ? text : '';
    }
    // 「{WiFi} 格力+app链接WiFi」：标题和说明一字不差就只留标题
    if (detail.replace(/\s+/g, '') === title.replace(/\s+/g, '')) detail = '';
    if (!title) continue;
    out.push({ title, detail, cat: featureCat(title) });
  }
  return out;
}

/** 读「产品功能卖点」表：系列 → 卖点数组 */
function parseFeatureSheet(ws) {
  const map = new Map();
  if (!ws) return map;
  const width = Math.min(ws.columnCount || 0, 6);
  let seriesCol = 0;
  let textCol = 0;

  for (let row = 1; row <= Math.min(3, ws.rowCount || 0); row += 1) {
    for (let col = 1; col <= width; col += 1) {
      const text = cellText(ws, row, col);
      if (!seriesCol && /^系列$/.test(text)) seriesCol = col;
      if (!textCol && /卖点/.test(text)) textCol = col;
    }
  }
  if (!seriesCol || !textCol) return map;

  for (let row = 1; row <= (ws.rowCount || 0); row += 1) {
    const series = cellText(ws, row, seriesCol);
    const text = cellText(ws, row, textCol);
    if (!series || !text) continue;
    const key = seriesKey(series);
    if (!key) continue;
    const items = map.get(key) || [];
    items.push(...splitFeatures(text));
    map.set(key, items);
  }
  return map;
}

/** 参数表系列 ↔ 卖点表系列：先精确对，再退一步「一方包含另一方且只对上一个人」 */
function attachFeatures(products, featureMap) {
  const byKey = products.map(product => seriesKey(product.meta.series));
  const exact = new Map();
  const contains = new Map();

  for (const key of new Set(byKey)) {
    if (!key) continue;
    if (featureMap.has(key)) {
      exact.set(key, key);
      continue;
    }
    const candidates = [...featureMap.keys()].filter(other => other.length >= 2 && (other.includes(key) || key.includes(other)));
    if (candidates.length === 1) contains.set(key, candidates[0]);
  }

  let matched = 0;
  for (const product of products) {
    const key = seriesKey(product.meta.series);
    const source = exact.get(key) || contains.get(key);
    if (!source) continue;
    const items = featureMap.get(source) || [];
    if (!items.length) continue;
    /* 同一系列的两个型号（1 匹 / 1.5 匹）挂同一套卖点，去重后最多 30 条 */
    const seen = new Set();
    for (const item of items) {
      const title = String(item.title || '').trim().slice(0, 40);
      if (!title) continue;
      // 整行就是系列名或纯型号（「云佳挂机」「KFR-26GW/…」）：是排版不是卖点
      if (/^KFR/i.test(title) || seriesKey(title) === key) continue;
      const dedupe = title.toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      product.features.push({
        title,
        detail: String(item.detail || '').slice(0, 150),
        cat: item.cat || featureCat(title),
        keywords: [],
        stage: /保修|安装|收费|售后|清洗|维修/.test(title) ? 'after_sale' : 'pre_sale',
        evidence: '',
        needsReview: false,
        manual: false
      });
      if (product.features.length >= 24) break;
    }
    matched += 1;
  }
  return matched;
}

/* ---------------- 主入口 ---------------- */

/**
 * 解析整份工作簿。
 * @param {Buffer} buffer xlsx 文件内容
 * @param {{group?:string}} options group 决定这批记录进哪个分组，默认格力空调
 */
async function parseWorkbook(buffer, { group = 'gree-ac' } = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const warnings = [];
  const skipped = [];
  const products = [];
  const imageFields = new Set();
  const sheetStats = [];

  let paramSheets = 0;
  for (const ws of workbook.worksheets) {
    const headerRow = findHeaderRow(ws);
    if (!headerRow) continue; // 百问百答、卖点对比、冰箱表都不是这个结构

    const sheetKind = /柜机/.test(ws.name) ? '柜机' : /挂机/.test(ws.name) ? '挂机' : '';
    if (!sheetKind) {
      warnings.push(`「${ws.name}」看着像参数表，但分不清是挂机还是柜机，已跳过`);
      continue;
    }
    paramSheets += 1;

    const parsed = parseParamsSheet(ws, { sheetKind });
    for (const name of parsed.imageFields) imageFields.add(name);
    for (const item of parsed.warnings) warnings.push(`「${ws.name}」${item}`);

    let count = 0;
    for (const column of parsed.columns) {
      const skipRule = SERIES_SKIP.find(rule => rule.sheet === sheetKind && rule.series.test(column.series));
      if (skipRule) {
        skipped.push({ sheet: sheetKind, series: column.series, reason: skipRule.reason });
        continue;
      }
      if (!column.models.length) {
        skipped.push({ sheet: sheetKind, series: column.series, reason: '这一列没有型号，无法入库' });
        continue;
      }
      const built = buildProducts(column, { sheetKind, group });
      products.push(...built);
      count += built.length;
    }
    sheetStats.push({ sheet: ws.name, series: parsed.columns.length, models: count });
  }

  if (!paramSheets) warnings.push('这个文件里没找到挂机/柜机参数表。请确认是「格力产品参数一览表」，或换用详情页导入。');

  const featureMatched = attachFeatures(products, parseFeatureSheet(workbook.getWorksheet('产品功能卖点')));

  /* 同一型号出现两次（两张表都写了）：保留参数多的那条，避免后写的覆盖先写的。
     「(含管)顶」这类备注不算不同型号——否则同一台机器会记两条。 */
  const unique = new Map();
  const merged = [];
  for (const product of products) {
    const key = dedupeKey(product.model);
    const prev = unique.get(key);
    if (!prev) {
      unique.set(key, product);
      continue;
    }
    merged.push({ kept: product.params.length >= prev.params.length ? product.model : prev.model, dropped: product.params.length >= prev.params.length ? prev.model : product.model });
    if (product.params.length > prev.params.length) unique.set(key, product);
  }
  for (const item of merged) {
    warnings.push(`「${item.dropped}」和「${item.kept}」是同一台机器（只有备注不同），已合并成一条`);
  }
  const finalProducts = [...unique.values()].slice(0, MAX_MODELS);

  const params = finalProducts.reduce((sum, item) => sum + item.params.length, 0);
  const features = finalProducts.reduce((sum, item) => sum + item.features.length, 0);

  return {
    products: finalProducts,
    warnings: [...new Set(warnings)],
    skipped,
    stats: {
      sheets: sheetStats,
      models: finalProducts.length,
      params,
      features,
      featureMatched,
      dropped: products.length - finalProducts.length,
      imageFields: [...imageFields]
    }
  };
}

module.exports = {
  parseWorkbook,
  // 给测试用
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
  dedupeKey
};
