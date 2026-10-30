/**
 * 格力「线上零售分销家用空调机型清单」解析
 *
 * 表结构（表头在第 2 行，第 1 行是合并标题）：
 *   序号 | 产品类型 | 成品码 | 机型 | 分销机型档次 | 挂/柜(机) | 系列名称
 *
 * 约定：
 *  - 成品码 = 知识库里的物料编码（同一含义，用户 2026-10-28 确认）；
 *  - 表尾的「说明」行（富文本、无档位）自动跳过；
 *  - 系列名称优先取 G 列（2026-10-28 主管手工核定的写法，如「云佳三级26机」），
 *    没有再用产品类型剥后缀兜底（云佳变频分体3级 → 云佳）。
 */

const TIER_SET = new Set(['引流机', '普通机', '中端机', '高端机']);

/** 单元格取纯文本（富文本 / 公式结果 / 超链接都摊平） */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    return '';
  }
  return String(value);
}

/** 产品类型 → 系列名称：剥「变频分体N级 / 变频柜机N级」及之后的括号说明 */
function seriesName(type) {
  let s = String(type || '').replace(/\s+/g, '');
  s = s.replace(/[变定]频(?:分体|柜机)\d级.*$/, '');
  s = s.replace(/[（(][^（）()]*[）)]$/, '');
  return s.trim();
}

/**
 * 解析机型清单。
 * @param {Buffer} buffer xlsx 文件内容
 * @returns {{items:Array<{type:string,code:string,machine:string,tier:string,kind:string,series:string}>, skipped:number}}
 */
async function parseDistributionWorkbook(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('清单文件里没有工作表');

  const headers = {};
  ws.getRow(2).eachCell((cell, col) => { headers[col] = cellText(cell.value).trim(); });
  const colOf = name => {
    const hit = Object.keys(headers).find(c => headers[c] === name);
    return hit ? Number(hit) : 0;
  };
  /* 「挂/柜机」表头有「挂/柜」「挂/柜机」两种写法；「系列名称」是 2026-10-28 主管手工核定的 G 列 */
  const colLike = prefix => {
    const hit = Object.keys(headers).find(c => headers[c].startsWith(prefix));
    return hit ? Number(hit) : 0;
  };
  const cols = {
    type: colOf('产品类型'),
    code: colOf('成品码'),
    machine: colOf('机型'),
    tier: colOf('分销机型档次'),
    kind: colLike('挂/柜'),
    series: colOf('系列名称')
  };
  if (!cols.code || !cols.tier) {
    throw new Error('表头没有找到「成品码」或「分销机型档次」列，确认导的是分销机型清单');
  }

  const items = [];
  let skipped = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const type = cellText(row.getCell(cols.type).value).replace(/\s+/g, '');
    const code = cellText(row.getCell(cols.code).value).trim().toUpperCase();
    const machine = cellText(row.getCell(cols.machine).value).trim();
    const tier = cellText(row.getCell(cols.tier).value).trim();
    const kind = cols.kind ? cellText(row.getCell(cols.kind).value).trim() : '';
    const seriesRaw = cols.series ? cellText(row.getCell(cols.series).value).replace(/\s+/g, '') : '';
    /* 成品码得像编码（字母+数字，且含数字）：挡掉表尾说明文字串进来的行 */
    const looksLikeCode = /^[A-Z0-9]+$/.test(code) && /\d/.test(code);
    if (!looksLikeCode) { if (type || tier || machine) skipped += 1; continue; }
    if (!TIER_SET.has(tier)) { skipped += 1; continue; }
    items.push({
      type, code, machine, tier, kind,
      /* 系列名称：优先 G 列主管核定的写法，缺了再用产品类型剥后缀兜底 */
      series: seriesRaw || seriesName(type)
    });
  }
  return { items, skipped };
}

module.exports = { parseDistributionWorkbook, seriesName, TIER_SET, cellText };
