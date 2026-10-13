const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseChatLog } = require('../lib/quality/parser');

test('chat log import preserves messages, masks private data, and reports conflicting end times', () => {
  const input = [
    '/*****************以下为一通会话************************************/',
    'customer_1 2026-03-25 23:57:00',
    '请联系 13812345678 &amp; 帮我确认国补',
    '格力旗舰店售前-01 2026-03-25 23:57:10',
    '<a href="https://item.jd.com/123?token=secret">商品链接</a>，我稍后答复',
    '格力旗舰店售前-01 2026-03-26 00:20:00',
    '目前无法确认，请稍等',
    '/*****************会话结束_时间:2026-03-26 00:00:03******************************/'
  ].join('\n');
  const result = parseChatLog(input, { agentHint: '格力旗舰店' });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].messages.length, 3);
  assert.equal(result.sessions[0].messages[0].role, 'customer');
  assert.equal(result.sessions[0].messages[0].text, '请联系 138****5678 & 帮我确认国补');
  assert.equal(result.sessions[0].messages[1].text, '商品链接，我稍后答复');
  assert.equal(result.sessions[0].messages[2].role, 'agent');
  assert.equal(result.sessions[0].endedAt, '2026-03-26 00:20:00');
  assert.deepEqual(result.sessions[0].anomalies, ['结束标记早于最后一条消息']);
  assert.equal(result.summary.endTimeConflicts, 1);
});

test('plain TXT transcript without LOG delimiters is accepted as one session', () => {
  const input = [
    '顾客 2026-10-10 10:00:00',
    '请问多久可以安装？',
    '格力旗舰店客服 2026-10-10 10:00:30',
    '我帮您核实。'
  ].join('\n');
  const result = parseChatLog(input, { agentHint: '格力旗舰店' });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].messages.length, 2);
  assert.equal(result.sessions[0].agent, '格力旗舰店客服');
  assert.equal(result.summary.missingEnd, 1);
});
