'use strict';

const timestamp = value => Date.parse(value.replace(' ', 'T') + '+08:00');

function findEvidence(session) {
  const messages = session.messages || [], found = [];
  let longest = null;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'customer' || !message.text) continue;
    const reply = messages.slice(i + 1).find(next => next.role === 'agent' && next.text);
    if (!reply) continue;
    const seconds = Math.round((timestamp(reply.at) - timestamp(message.at)) / 1000);
    if (seconds >= 120 && (!longest || seconds > longest.waitSeconds)) longest = { ruleId: 'response', title: '人工回复间隔较长，需核对排班与会话背景', messageIds: [message.id, reply.id], waitSeconds: seconds, verdict: null };
  }
  if (longest) found.push(longest);
  const complaint = messages.find(message => message.role === 'customer' && /投诉|工商|消协|315|媒体曝光/.test(message.text));
  if (complaint) found.push({ ruleId: 'complaint', title: '顾客提及投诉或敏感诉求，需核实处理过程', messageIds: [complaint.id], verdict: null });
  const claim = messages.find(message => message.role === 'agent' && /国补|补贴|质保|保修|安装|优惠券|折扣|降价|赔付/.test(message.text));
  if (claim) found.push({ ruleId: 'claims', title: '商品或活动承诺需与有效政策核对', messageIds: [claim.id], verdict: null });
  return found;
}

module.exports = { findEvidence };
