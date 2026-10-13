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

function cleanText(value) {
  return decodeEntities(String(value).replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g, '$1****$2')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已隐藏]')
    .replace(/https?:\/\/\S+/gi, url => url.split('?')[0])
    .replace(/\s+/g, ' ').replace(/\s+([，。！？；：,.!?;:])/g, '$1').trim();
}

function epoch(value) { return Date.parse(value.replace(' ', 'T') + '+08:00'); }

function parseChatLog(raw, { agentHint = '客服' } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw Object.assign(Error('聊天记录内容不能为空'), { status: 422 });
  const hint = String(agentHint).trim();
  if (!hint || hint.length > 60) throw Object.assign(Error('请填写有效的客服识别关键词'), { status: 422 });
  const blocks = raw.includes('以下为一通会话') ? raw.split(START).slice(1) : [raw];
  if (blocks.length > 3000) throw Object.assign(Error('单个文件最多包含 3000 通会话'), { status: 422 });
  const sessions = [];
  const speakers = new Map();
  let missingEnd = 0, endTimeConflicts = 0, withoutAgent = 0;
  for (const [index, block] of blocks.entries()) {
    const messages = [];
    let declaredEnd = null, current = null, outOfOrder = false;
    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const end = END.exec(line);
      if (end) { declaredEnd = end[1]; continue; }
      const speaker = SPEAKER.exec(line);
      if (speaker) {
        const at = speaker[2], isAgent = speaker[1].includes(hint);
        if (!Number.isFinite(epoch(at))) continue;
        if (messages.length && epoch(at) < epoch(messages.at(-1).at)) outOfOrder = true;
        if (isAgent) speakers.set(speaker[1], (speakers.get(speaker[1]) || 0) + 1);
        current = { id: messages.length, role: isAgent ? 'agent' : 'customer', speaker: isAgent ? speaker[1] : '顾客', at, text: '' };
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
    sessions.push({ ordinal: index + 1, agent: agents.join('、') || '待识别', startedAt: sorted[0], endedAt, declaredEnd, anomalies, messages });
  }
  if (!sessions.length) throw Object.assign(Error('文件中没有可识别的聊天消息'), { status: 422 });
  return { sessions, summary: { conversations: sessions.length, messages: sessions.reduce((n, s) => n + s.messages.length, 0), missingEnd, endTimeConflicts, withoutAgent }, speakers: [...speakers].map(([name, messages]) => ({ name, messages })).sort((a, b) => b.messages - a.messages) };
}

module.exports = { parseChatLog, cleanText };
