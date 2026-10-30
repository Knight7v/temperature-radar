'use strict';

const START = /\/\*+以下为一通会话\*+\//;
const END = /会话结束_时间:(20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;
const SPEAKER = /^(.{1,100}?)\s+(20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/;

function decodeEntities(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
    const key = entity.toLowerCase();
    if (named[key] !== undefined) return named[key];
    const number = key.startsWith('&#x') ? parseInt(key.slice(3, -1), 16) : parseInt(key.slice(2, -1), 10);
    return Number.isInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
}

// 脱敏口径：敏感信息只做「等长星号掩码」，绝不删除内容。
// 手机号保留前 3 后 4（138****8000），邮箱只遮 @ 前面的账号部分（保留域名便于判断是不是企业邮箱）。
function cleanText(value) {
  return decodeEntities(String(value).replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g, '$1****$2')
    .replace(/([A-Z0-9._%+-]+)(@[A-Z0-9.-]+\.[A-Z]{2,})/gi, (match, local, domain) => '*'.repeat(local.length) + domain)
    .replace(/https?:\/\/\S+/gi, url => url.split('?')[0])
    .replace(/\s+/g, ' ').replace(/\s+([，。！？；：,.!?;:])/g, '$1').trim();
}

// 发言人判定：字段标签行不能被当成发言人。
// 真实案例：「最新预约上门时间： 2026-03-25 16:00:00」——名字位置其实是字段名，后面是值。
// 一旦误判，这条客服消息会被拆成「一条空消息 + 一条挂在顾客名下的消息」，看起来就像内容被删了。
const LABEL_TAIL = /[：:]\s*$/;
const LABEL_WORDS = /(时间|日期|电话|手机|姓名|地址|订单|单号|型号|金额|数量|备注|联系人|发票|税号|开户|账号|工号|工程师|预约|物流|快递|网点|工单|卡号|车牌)/;
const SHOP_WORDS = /(客服|专营|旗舰|专卖|自营|官方|店)/;

function looksLikeFieldLabel(name) {
  const text = String(name || '').trim();
  if (!text) return true;
  if (LABEL_TAIL.test(text)) return true;                                  // 「最新预约上门时间：」
  return text.length <= 16 && LABEL_WORDS.test(text) && !SHOP_WORDS.test(text);
}

// 导出格式里，真正的发言人行以制表符结尾；正文行不会。
// 先扫一遍拿到「可信发言人名单」，再从名单外剔除字段标签行，双保险。
function trustedSpeakers(raw) {
  const names = new Set();
  for (const line of String(raw).split(/\r?\n/)) {
    if (!/\t\s*$/.test(line)) continue;
    const match = SPEAKER.exec(line.trim());
    if (match && !looksLikeFieldLabel(match[1])) names.add(match[1]);
  }
  return names;
}

// 机器人发言人：京东 AI 机器人「京小智」的账号形如 jimi_vender_22950829。
// 不认这条规则，整通角色会反过来（机器人说的话算顾客，顾客的提问算「客服没回复」），
// 曾有 25 通因此被判 D 级。机器人对话照样纳入质检，只是在客服名上标明是京小智。
const ROBOT_ACCOUNTS = [
  { pattern: /^jimi_vender_\d+$/i, name: '京小智' }
];

function robotName(name) {
  const text = String(name || '').trim();
  if (!text) return null;
  const hit = ROBOT_ACCOUNTS.find(item => item.pattern.test(text));
  return hit ? hit.name : null;
}

// 京东导出把京小智的卡片/富文本答案写成占位符，正文根本没导出来。
// 这时候「顾客问了什么」看得见、「机器人怎么答的」看不见，任何分数都是瞎猜：
// 实测同一批会话，只有占位符的会被判 A+100，答了一半的会被判 D13。
const ROBOT_HIDDEN = /暂不支持展示|欢迎卡片|富文本模板/;

function epoch(value) { return Date.parse(value.replace(' ', 'T') + '+08:00'); }

function parseChatLog(raw, { agentHint = '客服', isAgentName = null } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw Object.assign(Error('聊天记录内容不能为空'), { status: 422 });
  const hint = String(agentHint).trim();
  if (!hint || hint.length > 60) throw Object.assign(Error('请填写有效的客服识别关键词'), { status: 422 });
  // 历史数据修复时可以直接传已知客服名判断，避免再靠关键词猜（猜错的后果是整通角色反了）
  const judgeAgent = typeof isAgentName === 'function' ? isAgentName : name => String(name).includes(hint);
  const blocks = raw.includes('以下为一通会话') ? raw.split(START).slice(1) : [raw];
  if (blocks.length > 3000) throw Object.assign(Error('单个文件最多包含 3000 通会话'), { status: 422 });
  const trusted = trustedSpeakers(raw);
  const sessions = [];
  const speakers = new Map();
  let missingEnd = 0, endTimeConflicts = 0, withoutAgent = 0, unjudgeable = 0;
  for (const [index, block] of blocks.entries()) {
    const messages = [];
    let declaredEnd = null, current = null, outOfOrder = false, customerMasked = null;
    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const end = END.exec(line);
      if (end) { declaredEnd = end[1]; continue; }
      const speaker = SPEAKER.exec(line);
      // 名单外的字段标签行（如「最新预约上门时间：」）按正文处理，不新起一条消息
      if (speaker && (trusted.has(speaker[1]) || !looksLikeFieldLabel(speaker[1]))) {
        const at = speaker[2];
        const robot = robotName(speaker[1]);
        const isAgent = Boolean(robot) || judgeAgent(speaker[1]);
        const shown = robot || speaker[1];
        if (!Number.isFinite(epoch(at))) continue;
        if (messages.length && epoch(at) < epoch(messages.at(-1).at)) outOfOrder = true;
        if (isAgent) speakers.set(shown, (speakers.get(shown) || 0) + 1);
        // 顾客名在导出里是脱敏ID（m****dm）。留着它，才能和「会话记录列表」里的完整ID对上。
        else if (!customerMasked) customerMasked = speaker[1];
        current = { id: messages.length, role: isAgent ? 'agent' : 'customer', speaker: isAgent ? shown : '顾客', at, text: '' };
        messages.push(current);
      } else if (current) {
        const text = cleanText(line);
        if (text) current.text += (current.text ? ' ' : '') + text;
      }
    }
    if (!messages.length) continue;
    const sorted = messages.map(message => message.at).sort();
    const endedAt = sorted.at(-1), anomalies = [];
    if (!declaredEnd) { anomalies.push('缺少结束标记'); missingEnd++; }
    else if (epoch(declaredEnd) < epoch(endedAt)) { anomalies.push('结束标记早于最后一条消息'); endTimeConflicts++; }
    if (outOfOrder) anomalies.push('消息时间顺序异常');
    const agents = [...new Set(messages.filter(message => message.role === 'agent').map(message => message.speaker))];
    if (!agents.length) { anomalies.push('未识别客服发言'); withoutAgent++; }
    // 京小智的回复只要有一条是占位符，就说明答复内容缺失，不能自动评分
    const robotNames = new Set(ROBOT_ACCOUNTS.map(item => item.name));
    const robotMessages = messages.filter(message => message.role === 'agent' && robotNames.has(message.speaker));
    let judgeable = true, robotHidden = 0;
    if (robotMessages.length) {
      robotHidden = robotMessages.filter(message => ROBOT_HIDDEN.test(message.text)).length;
      if (robotHidden) {
        anomalies.push(robotHidden === robotMessages.length ? '机器人回复未导出' : '机器人回复部分未导出');
        judgeable = false;
      }
    }
    if (!judgeable) unjudgeable += 1;
    sessions.push({ ordinal: index + 1, agent: agents.join('、') || '待识别', startedAt: sorted[0], endedAt, declaredEnd, anomalies, judgeable, customerMasked, messages });
  }
  if (!sessions.length) throw Object.assign(Error('文件中没有可识别的聊天消息'), { status: 422 });
  return { sessions, summary: { conversations: sessions.length, messages: sessions.reduce((n, s) => n + s.messages.length, 0), missingEnd, endTimeConflicts, withoutAgent, unjudgeable }, speakers: [...speakers].map(([name, messages]) => ({ name, messages })).sort((a, b) => b.messages - a.messages) };
}

module.exports = { parseChatLog, cleanText, robotName };
