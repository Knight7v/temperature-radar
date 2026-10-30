/**
 * 格力官方主数据表解析（系统导出的《挂式空调-*.xlsx》）。
 *
 * 表结构：一行一个主数据（SKU 级），35 列。关键点：
 *  - 「产品型号」列是空的，型号只能从「主数据名称」里抠（KFR-35GW/xxx(颜色））；
 *  - 名称前面有【】状态标记：已会签=可用，已淘汰=老机型（顾客还会问），未会签/需处理=草稿不导；
 *  - 内外机尺寸、装箱清单都是文字 —— 正好补上参数表里图片读不到的那块。
 *
 * 同型号多行（不同颜色）：参数取第一份非空的，颜色合并进外观，物料编码取第一份。
 */

const ExcelJS = require('exceljs');

/* 【】里的状态 → 是否值得入库 */
function statusOf(name) {
  const match = String(name || '').match(/^【([^】]+)】/);
  return match ? match[1].trim() : '';
}

function importableStatus(status) {
  if (!status) return true; // 没有状态前缀的行不做限制
  /* 未会签 = 草稿但活着（2026-10-28 用户确认要导，云锦Pro 等在售主力就是这状态）；
     已淘汰 / 需处理 / 老国标-待处理 是判死行（2026-10-28 用户拍板已从库里清洗），不导；
     老国标-已会签不算判死 */
  return /已会签|未会签/.test(status) && !/需处理|老国标-待处理|已淘汰/.test(status);
}

/** 从主数据名称抠型号：停在中文上，去掉结尾孤立的括号 */
function extractModel(name) {
  const text = String(name || '').replace(/^【[^】]*】/, '');
  const match = text.match(/KFR[-]?[0-9A-Za-z\/()\-]+/i);
  if (!match) return '';
  let model = match[0].replace(/\(+$/u, '');
  if (!/^KFR-?\d{2}/i.test(model) || model.length < 10) return '';
  return model;
}

/**
 * 匹配用的键：大写、去空格、去掉结尾的颜色括号（（珊瑚玉）/(珊瑚玉)/(皓雪白)）和「顶」。
 * 颜色不是型号差异，参数除了颜色都一样；颜色进外观字段。
 * 注意 (WIFI)、(26598) 这类是型号本体，不能剥 —— 只剥含中文的括号。
 */
function matchKey(model) {
  let text = String(model || '').toUpperCase().replace(/\s+/g, '');
  for (;;) {
    const stripped = text
      .replace(/[（(][\u4e00-\u9fa5]+[)）]$/u, '')
      .replace(/顶$/u, '');
    if (stripped === text) break;
    text = stripped;
  }
  return text;
}

/** 「正1.5匹」→「1.5匹」，其余原样 */
function cleanHorsepower(value) {
  return String(value || '').replace(/^[正大小额]\s*/u, '').trim();
}

/** 「5.27(全年能源消耗效率）」→「5.27」 */
function cleanApf(value) {
  return String(value || '').replace(/[（(][^）)]*能源[^）)]*[)）]/gu, '').trim();
}

const PARAM_FIELDS = [
  { col: '外机质量（kg）', name: '外机净重', unit: 'kg', numericOnly: true },
  { col: '内机质量（kg）', name: '内机净重', unit: 'kg', numericOnly: true },
  { col: '外机尺寸（宽x高x深）mm', name: '外机尺寸(宽x高x深)', unit: 'mm', unitAlways: true },
  { col: '内机尺寸（宽x高x深）mm', name: '内机尺寸(宽x高x深)', unit: 'mm', unitAlways: true },
  { col: '电压/频率（V/Hz）', name: '电压/频率', unit: '' },
  { col: '循环风量(m³/h)', name: '循环风量', unit: 'm³/h', numericOnly: true },
  { col: '外机噪音dB（A）', name: '外机噪音', unit: 'dB(A)' },
  { col: '内机噪音dB（A）', name: '内机噪音', unit: 'dB(A)' },
  { col: '电辅加热功率（W）', name: '电辅热功率', unit: 'W', numericOnly: true },
  { col: '是否电辅加热', name: '电辅热', unit: '', yesNo: true },
  { col: '制热功率(W)', name: '制热功率', unit: 'W', numericOnly: true },
  { col: '制冷剂', name: '制冷剂', unit: '' },
  { col: '制热量(W)', name: '制热量', unit: 'W', numericOnly: true },
  { col: '制冷功率（W）', name: '制冷功率', unit: 'W', numericOnly: true },
  { col: '制冷量（W）', name: '制冷量', unit: 'W', numericOnly: true },
  { col: '能源消耗效率', name: 'APF 能效比', unit: '', clean: cleanApf },
  { col: '适用面积（平方米）', name: '适用面积', unit: '㎡', numericOnly: false },
  { col: '能效/水效', name: '能效等级', unit: '' },
  { col: '定频/变频', name: '变频类型', unit: '' },
  { col: '匹数', name: '匹数', unit: '', clean: cleanHorsepower },
  { col: '单冷/冷暖', name: '冷暖类型', unit: '' },
  { col: '内机装箱清单', name: '内机装箱清单', unit: '' },
  { col: '外机装箱清单', name: '外机装箱清单', unit: '' }
];

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(part => part.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value.hyperlink) return String(value.hyperlink);
    return '';
  }
  return String(value).trim();
}

function buildParams(row) {
  const params = [];
  for (const field of PARAM_FIELDS) {
    let value = cellText(row[field.col]);
    if (!value || value === '/' || value === '—' || value === '-') continue;
    if (field.clean) value = field.clean(value);
    if (field.yesNo) {
      value = /是|有|支持/.test(value) ? '支持' : /否|无|不/.test(value) ? '不支持' : '';
      if (!value) continue;
    }
    const pure = /^\d+(?:\.\d+)?$/.test(value);
    /* 「5010(150～6630)」这种数字+括号区间的写法也算数值，只是不带单位 */
    const numericLike = pure || /^\d+(?:\.\d+)?[（(][^）)]+[)）]$/.test(value);
    /* numericOnly 的字段只要数值形态；其余字段数字或含中文都收 */
    const acceptable = field.numericOnly ? numericLike : numericLike || /^\d/.test(value) || /[\u4e00-\u9fff]/.test(value);
    if (!acceptable) continue;
    const withUnit = pure || field.unitAlways;
    params.push({ name: field.name, value, unit: withUnit ? field.unit || '' : '' });
  }
  return params;
}

/**
 * 解析官方主数据表。opts.skipObsolete=true 时不导「已淘汰」。
 * 返回 { products, stats }；products 已同型号去重合并。
 */
async function parseMasterWorkbook(buffer, opts = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('表里没有工作表');

  const headers = [];
  ws.getRow(1).eachCell((cell, col) => { headers[col] = cellText(cell.value); });

  const stats = { rows: 0, noModel: 0, skippedStatus: {}, importedRows: 0 };
  const byKey = new Map();

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = {};
    let any = false;
    for (let c = 1; c <= headers.length; c++) {
      const value = cellText(ws.getRow(r).getCell(c).value);
      if (value) any = true;
      row[headers[c] || ''] = value;
    }
    if (!any) continue;
    stats.rows += 1;

    const status = statusOf(row['主数据名称']);
    if (status && !importableStatus(status)) {
      stats.skippedStatus[status] = (stats.skippedStatus[status] || 0) + 1;
      continue;
    }
    if (opts.skipObsolete && /已淘汰/.test(status)) {
      stats.skippedStatus[status] = (stats.skippedStatus[status] || 0) + 1;
      continue;
    }

    const model = extractModel(row['主数据名称']);
    if (!model) { stats.noModel += 1; continue; }
    const key = matchKey(model);
    if (!key) { stats.noModel += 1; continue; }
    stats.importedRows += 1;

    const displayName = String(row['主数据名称'] || '').replace(/^【[^】]*】\s*/, '').trim();
    const color = cellText(row['颜色']);
    const adText = String(row['广告语'] || '').trim();

    let product = byKey.get(key);
    if (!product) {
      product = {
        group: 'gree-ac',
        model,
        name: displayName.slice(0, 80),
        brand: cellText(row['品牌']) || cellText(row['类目品牌']) || '格力',
        category: String(row['平台类目'] || '').split('/').pop().slice(0, 12),
        materialCode: cellText(row['物料编码']),
        masterCode: cellText(row['主数据编码']),
        params: buildParams(row),
        colors: color ? [color] : [],
        adText,
        draft: /未会签/.test(status),
        source: { type: 'file', name: '格力官方主数据', chars: 0, aiUsed: false }
      };
      byKey.set(key, product);
      continue;
    }
    /* 同型号再出现（多颜色）：补空参数、并颜色，物料编码空才补；出过非草稿行就不算草稿 */
    if (!/未会签/.test(status)) product.draft = false;
    if (!product.materialCode) product.materialCode = cellText(row['物料编码']);
    if (!product.masterCode) product.masterCode = cellText(row['主数据编码']);
    if (color && !product.colors.includes(color)) product.colors.push(color);
    if (!product.adText && adText) product.adText = adText;
    for (const param of buildParams(row)) {
      if (!product.params.some(item => item.name === param.name)) product.params.push(param);
    }
  }

  const products = [...byKey.values()].map(product => ({
    group: product.group,
    model: product.model,
    name: product.name,
    brand: product.brand,
    category: product.category,
    materialCode: product.materialCode,
    masterCode: product.masterCode,
    draft: Boolean(product.draft),
    appearance: product.colors.map(color => ({ label: '颜色', value: color })),
    params: product.params,
    features: product.adText
      ? [{ title: '官方广告语', detail: product.adText.slice(0, 150), keywords: [], stage: 'pre_sale', evidence: '', needsReview: false, cat: 'other' }]
      : [],
    service: [],
    source: product.draft ? { ...product.source, name: '格力官方主数据（未会签）' } : product.source
  }));

  return { products, stats };
}

/**
 * 解析在售产品明细表（产品系列/物料编码/型号/机型档次）。
 * 返回按型号匹配键去重后的条目；同键不同编码或档位的进 conflicts。
 */
async function parseShopDetail(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('表里没有工作表');

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const series = cellText(ws.getRow(r).getCell(1).value);
    const code = cellText(ws.getRow(r).getCell(2).value);
    const model = cellText(ws.getRow(r).getCell(3).value);
    const tier = cellText(ws.getRow(r).getCell(4).value);
    if (!series && !code && !model) continue;
    rows.push({ series, code, model, tier });
  }

  const byKey = new Map();
  const conflicts = [];
  for (const row of rows) {
    const key = matchKey(row.model);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, row); continue; }
    if (prev.code === row.code && prev.tier === row.tier) continue;
    /* 同型号写了不同编码：留档位出现次数多的那个，冲突记下来给人看 */
    conflicts.push({ model: row.model, kept: prev.code, dropped: row.code, tier: row.tier });
    if ((prev.tierCount || 1) < 2) { prev.tierCount = 2; }
  }
  return { items: [...byKey.values()], conflicts, rowCount: rows.length };
}

module.exports = { parseMasterWorkbook, parseShopDetail, matchKey, extractModel, statusOf, importableStatus };
