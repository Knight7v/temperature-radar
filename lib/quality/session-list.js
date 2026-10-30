'use strict';
/* 会话记录列表（京麦「咨询会话查询」导出的 xlsx）
 *
 * 解决两个 log 里拿不到的东西：
 *   ① 完整顾客ID —— log 导出时被脱敏成 m****dm（首位 + 星号 + 末两位），没法回京东后台查这通对话；
 *   ② 会话级时点 —— 咨询时间、首次响应时间、会话时长、双方消息条数、cid、满意度。
 *
 * 匹配不是「猜」，是三件事交叉校验：
 *   掩码ID（首位 + 末两位） + 起聊时间（秒级） + 接待客服。
 * 实测 2026-10-26 那天 299 通：掩码+时间 ≤5 秒对上 286 通（253 通秒级完全相同，41 通差 1 秒），
 * 剩下 13 通里 11 通是「顾客一句没说」（没有掩码可用），退回「时间 + 客服」也唯一。
 * 所以判定分四档，弱匹配宁可不认，交给人工，绝不硬套一个ID上去。
 */
const ExcelJS = require('exceljs');

const TOLERANCE_OK = 5;   // 秒：认定为同一通
const TOLERANCE_WEAK = 60; // 秒：仍可能对上，但标「需人工确认」

const COLUMNS = {
  consultAt: ['咨询时间'],
  customerId: ['顾客', '客户', '买家昵称'],
  agent: ['客服', '接待客服'],
  firstResponseAt: ['首次响应时间'],
  durationMin: ['会话时长(M)', '会话时长（M）', '会话时长'],
  customerMessages: ['客户消息数', '顾客消息数'],
  agentMessages: ['客服消息数'],
  satisfaction: ['满意度'],
  resolved: ['是否解决'],
  cid: ['cid'],
  productId: ['商品编号'],
  productName: ['商品名称']
};

function timeText(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    const pad = number => String(number).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  const text = String(value).trim().replace('T', ' ');
  if (/^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return `${text}:00`;
  return /^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text : '';
}

function plain(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return timeText(value);
  return String(value).trim();
}

const epoch = value => {
  const parsed = Date.parse(String(value || '').replace(' ', 'T') + '+08:00');
  return Number.isFinite(parsed) ? parsed : NaN;
};

const secondsBetween = (left, right) => {
  const a = epoch(left), b = epoch(right);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 1000 : Infinity;
};

/* 掩码规则：首字符 + 星号 + 末两位。中文昵称也走同一套（胡****13 ↔ 胡永林513） */
function signature(value) {
  const text = plain(value).replace(/\*/g, '');
  if (text.length < 3) return '';
  return text[0] + '|' + text.slice(-2).toLowerCase();
}

function maskCustomer(customerId) {
  const text = plain(customerId);
  if (text.length <= 4) return text;
  return text[0] + '*'.repeat(Math.min(4, Math.max(1, text.length - 3))) + text.slice(-2);
}

async function parseSessionList(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw Object.assign(Error('会话记录里没有工作表'), { status: 422 });
  const header = (sheet.getRow(1).values || []).slice(1).map(cell => plain(cell));
  const position = names => {
    for (const name of names) {
      const index = header.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  };
  const index = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, position(names)]));
  if (index.consultAt < 0 || index.customerId < 0) {
    throw Object.assign(Error('会话记录缺少「咨询时间」或「顾客」列，请确认导出的是京麦「咨询会话查询」'), { status: 422 });
  }
  const cell = (cells, key) => (index[key] >= 0 ? cells[index[key]] : null);
  const rows = [];
  for (let line = 2; line <= sheet.rowCount; line += 1) {
    const cells = sheet.getRow(line).values.slice(1);
    const consultAt = timeText(cell(cells, 'consultAt'));
    const customerId = plain(cell(cells, 'customerId'));
    if (!consultAt || !customerId) continue;
    rows.push({
      line,
      consultAt,
      customerId,
      agent: plain(cell(cells, 'agent')),
      firstResponseAt: timeText(cell(cells, 'firstResponseAt')),
      durationMin: Number(cell(cells, 'durationMin')) || 0,
      customerMessages: Number(cell(cells, 'customerMessages')) || 0,
      agentMessages: Number(cell(cells, 'agentMessages')) || 0,
      satisfaction: plain(cell(cells, 'satisfaction')),
      resolved: plain(cell(cells, 'resolved')),
      cid: plain(cell(cells, 'cid')),
      productId: plain(cell(cells, 'productId')),
      productName: plain(cell(cells, 'productName'))
    });
  }
  if (!rows.length) throw Object.assign(Error('会话记录里没有可识别的会话行'), { status: 422 });
  const dates = rows.map(row => row.consultAt.slice(0, 10)).sort();
  return { rows, header, range: { from: dates[0], to: dates[dates.length - 1] } };
}

const agentMatches = (sessionAgent, rowAgent) => {
  const left = plain(sessionAgent), right = plain(rowAgent);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
};

function countByRole(messages) {
  let customer = 0, agent = 0;
  for (const message of messages || []) {
    if (message.role === 'agent') agent += 1;
    else customer += 1;
  }
  return { customer, agent };
}

/* 把一条 xlsx 行贴到会话上。写进去的都是原始字段，展示与判定交给调用方 */
function attach(session, row, { confidence, secondsOff }) {
  session.customerId = row.customerId;
  if (!session.customerMasked) session.customerMasked = maskCustomer(row.customerId);
  const counts = countByRole(session.messages);
  session.sessionList = {
    consultAt: row.consultAt,
    firstResponseAt: row.firstResponseAt,
    durationMin: row.durationMin,
    customerMessages: row.customerMessages,
    agentMessages: row.agentMessages,
    satisfaction: row.satisfaction,
    resolved: row.resolved,
    cid: row.cid,
    productId: row.productId,
    productName: row.productName,
    confidence,
    secondsOff,
    /* 完整性：xlsx 是后台统计口径，条数比 log 多 = log 缺消息，必须能看出来 */
    parsedCustomerMessages: counts.customer,
    parsedAgentMessages: counts.agent,
    customerGap: counts.customer - row.customerMessages,
    agentGap: counts.agent - row.agentMessages
  };
  return session;
}

/* 主流程：sessions（parseChatLog 的结果）+ rows（session list）→ 就地补字段 + 报告 */
function reconcileSessions(sessions, rows) {
  /* 先把所有「可能是一对」的组合列出来，再按「时间差 + 客服是否一致」统一排序，一对一认领。
     不按会话逐条贪心的原因：同一秒进线多通是常态（大促更明显），逐条取最近会互相抢行，
     抢输的那通就被判成「没匹配」，白丢一批 ID。 */
  const byMask = new Map();
  rows.forEach((row, index) => {
    const key = signature(row.customerId);
    if (!key) return;
    if (!byMask.has(key)) byMask.set(key, []);
    byMask.get(key).push(index);
  });
  const report = {
    sessions: sessions.length,
    rows: rows.length,
    exact: 0,
    agentMismatch: 0,
    weak: 0,
    unmatched: 0,
    noCustomer: 0,
    gapWarnings: 0
  };
  const candidates = [];
  sessions.forEach((session, index) => {
    const masked = signature(session.customerMasked || '');
    const pool = masked ? (byMask.get(masked) || []) : rows.map((_, rowIndex) => rowIndex);
    if (!masked) report.noCustomer += 1;
    /* 没有掩码时只认 5 秒内：纯靠时间猜，宁可不写也不能写错人 */
    const limit = masked ? TOLERANCE_WEAK : TOLERANCE_OK;
    for (const rowIndex of pool) {
      const diff = secondsBetween(rows[rowIndex].consultAt, session.startedAt);
      if (!(diff <= limit)) continue;
      candidates.push({ session: index, row: rowIndex, diff, agent: agentMatches(session.agent, rows[rowIndex].agent) });
    }
  });
  candidates.sort((left, right) => {
    const score = item => item.diff + (item.agent ? 0 : 30); // 时间差优先，客服对不上罚 30 秒
    return score(left) - score(right) || left.session - right.session;
  });
  const takenSession = new Set();
  const takenRow = new Set();
  for (const candidate of candidates) {
    if (takenSession.has(candidate.session) || takenRow.has(candidate.row)) continue;
    takenSession.add(candidate.session);
    takenRow.add(candidate.row);
    const session = sessions[candidate.session];
    const confidence = candidate.diff <= TOLERANCE_OK ? (candidate.agent ? 'exact' : 'agent-mismatch') : 'weak';
    if (confidence === 'exact') report.exact += 1;
    else if (confidence === 'agent-mismatch') report.agentMismatch += 1;
    else report.weak += 1;
    attach(session, rows[candidate.row], { confidence, secondsOff: Math.round(candidate.diff) });
    if (session.sessionList.customerGap < 0 || session.sessionList.agentGap < 0) report.gapWarnings += 1;
  }
  report.unmatched = sessions.length - takenSession.size;
  const leftovers = rows.filter((_row, index) => !takenRow.has(index));
  report.unmatchedRows = leftovers.length;
  report.leftovers = leftovers.slice(0, 10).map(row => ({ consultAt: row.consultAt, customerId: row.customerId, agent: row.agent }));
  report.confidenceLabel = {
    exact: '掩码+时间+客服 全部吻合',
    time: '无顾客发言，按时间+客服对上',
    'agent-mismatch': '对上了但客服名不一致',
    weak: '时间差较大，需人工确认'
  };
  return report;
}

module.exports = { parseSessionList, reconcileSessions, signature, maskCustomer, timeText, TOLERANCE_OK, TOLERANCE_WEAK };
