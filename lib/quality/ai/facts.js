'use strict';

// 从会话时间戳直接算出来的客观事实。这些不让模型"估算"，
// 由代码算好塞进提示词，模型只负责解读和取证。

function epoch(value) {
  const text = String(value || '').trim();
  if (!text) return NaN;
  const normalized = text.replace(' ', 'T');
  const parsed = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}+08:00`);
  return parsed;
}

function conversationFacts(session) {
  const messages = Array.isArray(session?.messages) ? session.messages.filter(item => item && String(item.text || '').trim()) : [];
  const agents = messages.filter(item => item.role === 'agent');
  const customers = messages.filter(item => item.role === 'customer');

  let firstAgentReplySeconds = null;
  const firstCustomer = messages.find(item => item.role === 'customer');
  if (firstCustomer) {
    const reply = messages.slice(messages.indexOf(firstCustomer) + 1).find(item => item.role === 'agent');
    const seconds = reply ? Math.round((epoch(reply.at) - epoch(firstCustomer.at)) / 1000) : null;
    if (Number.isFinite(seconds)) firstAgentReplySeconds = seconds;
  }

  const gaps = [];
  for (let i = 0; i < messages.length; i += 1) {
    const current = messages[i];
    if (current.role !== 'customer') continue;
    const reply = messages.slice(i + 1).find(item => item.role === 'agent');
    if (!reply) continue;
    const seconds = Math.round((epoch(reply.at) - epoch(current.at)) / 1000);
    if (Number.isFinite(seconds) && seconds >= 0) {
      gaps.push({ customerMessageId: current.id, agentMessageId: reply.id, seconds });
    }
  }
  const maxGapSeconds = gaps.length ? Math.max(...gaps.map(item => item.seconds)) : null;
  const slowGaps = gaps.filter(item => item.seconds > 120);

  // 顾客最后一条消息没有客服回复：这是"未响应"，比等待间隔更严重，单独算。
  const lastCustomer = [...customers].pop();
  let unanswered = null;
  if (lastCustomer) {
    const after = messages.slice(messages.indexOf(lastCustomer) + 1).filter(item => item.role === 'agent');
    if (!after.length) {
      const seconds = Math.round((epoch(session?.endedAt) - epoch(lastCustomer.at)) / 1000);
      unanswered = { messageId: lastCustomer.id, seconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null };
    }
  }

  return {
    messageCount: messages.length,
    customerTurns: customers.length,
    agentTurns: agents.length,
    firstAgentReplySeconds,
    maxGapSeconds,
    slowGaps: slowGaps.slice(0, 5),
    unanswered,
    hasTimestamp: Number.isFinite(epoch(messages[0]?.at)),
    startedAt: session?.startedAt || messages[0]?.at || '',
    endedAt: session?.endedAt || messages[messages.length - 1]?.at || '',
    agent: session?.agent || '',
    durationSeconds: (() => {
      const span = Math.round((epoch(session?.endedAt) - epoch(session?.startedAt)) / 1000);
      return Number.isFinite(span) && span >= 0 ? span : null;
    })()
  };
}

// 顾客侧出现这些词，说明涉及不满/投诉/敏感诉求，供模型判断"投诉与敏感诉求"项。
const SENSITIVE = /投诉|315|工商|消协|曝光|差评|举报|退一赔三|起诉|律师|记者/;
function sensitiveMentions(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return messages.filter(item => item.role === 'customer' && SENSITIVE.test(String(item.text || ''))).map(item => item.id);
}

module.exports = { conversationFacts, sensitiveMentions, epoch };
