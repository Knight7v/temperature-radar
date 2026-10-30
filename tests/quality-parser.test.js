const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseChatLog, cleanText } = require('../lib/quality/parser');

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

// 真实故障样本：客服发的「最新预约上门时间： 2026-03-25 16:00:00」
// 时间部分长得像发言人时间戳，旧逻辑会把这条消息拆成「空消息 + 挂在顾客名下的幽灵消息」，
// 预约时间和工程师电话看起来就像被删了。
const SPLIT_BLOCK = [
  '/*****************以下为一通会话************************************/\t',
  'j****jg 2026-03-25 18:13:11\t',
  '现在都没有来拆呢\t',
  '格力旗舰店-售前小雪 2026-03-25 18:13:25\t',
  '期望上门时间： 2026-03-24(周二)',
  '最新预约上门时间： 2026-03-25 16:00:00',
  '工程师姓名： 包居荣',
  '工程师电话： 13657313879\t',
  '格力旗舰店-售前小雪 2026-03-25 18:13:29\t',
  '您可以电话沟通下哦亲',
  '/*****************会话结束_时间:2026-03-25 18:14:32******************************/'
].join('\n');

test('字段标签行不会被当成发言人，预约信息仍然留在客服消息里', () => {
  const session = parseChatLog(SPLIT_BLOCK, { agentHint: '售前' }).sessions[0];
  assert.equal(session.messages.length, 3);
  const second = session.messages[1];
  assert.equal(second.role, 'agent');
  assert.equal(second.at, '2026-03-25 18:13:25');
  assert.match(second.text, /最新预约上门时间： 2026-03-25 16:00:00/);
  assert.match(second.text, /工程师姓名： 包居荣/);
  assert.match(second.text, /工程师电话： 136\*\*\*\*3879/);
});

test('拆分修好后不再出现空消息与时间倒退，会话结束时间也不再跳到预约时间', () => {
  const session = parseChatLog(SPLIT_BLOCK, { agentHint: '售前' }).sessions[0];
  assert.equal(session.messages.filter(item => !String(item.text).trim()).length, 0);
  assert.equal(session.anomalies.includes('消息时间顺序异常'), false);
  assert.equal(session.endedAt, '2026-03-25 18:13:29');
  assert.deepEqual(session.messages.map(item => item.id), [0, 1, 2]);
});

test('可以直接按已知客服名判定角色，不依赖关键词', () => {
  const session = parseChatLog(SPLIT_BLOCK, { isAgentName: name => name === '格力旗舰店-售前小雪' }).sessions[0];
  assert.deepEqual(session.messages.map(item => item.role), ['customer', 'agent', 'agent']);
  assert.equal(session.agent, '格力旗舰店-售前小雪');
  assert.equal(session.messages[0].speaker, '顾客');
});

test('邮箱只遮账号部分、长度不变，域名保留', () => {
  const masked = cleanText('开好之后发到我邮箱2446327516@qq.com');
  assert.equal(masked, '开好之后发到我邮箱**********@qq.com');
  assert.equal(masked.includes('2446327516'), false);
});

// 真实故障样本：jimi_vender_22950829 是京东 AI 机器人「京小智」。
// 账号里没有「客服」二字，旧逻辑把它当顾客，整通角色反过来——
// 机器人说的话算顾客，顾客的提问算「客服一句没说」，5 通因此被判 D 级。
const ROBOT_BLOCK = [
  '/*****************以下为一通会话************************************/\t',
  'jd_4afc789cfca86 2026-03-25 07:09:10\t',
  '这款带自清洁除湿功能么\t',
  'jimi_vender_22950829 2026-03-25 07:09:18\t',
  '【此消息为欢迎卡片或富文本模板答案，聊天记录中暂不支持展示】\t',
  '/*****************会话结束_时间:2026-03-25 07:19:18******************************/'
].join('\n');

test('京东 AI 机器人 jimi_vender 识别为京小智，不是顾客', () => {
  const session = parseChatLog(ROBOT_BLOCK, { agentHint: '客服' }).sessions[0];
  assert.equal(session.agent, '京小智');
  assert.deepEqual(session.messages.map(item => item.role), ['customer', 'agent']);
  assert.equal(session.messages[1].speaker, '京小智');
  assert.equal(session.anomalies.includes('未识别客服发言'), false);
});

test('京小智的答复是占位符时不参与自动评分', () => {
  const result = parseChatLog(ROBOT_BLOCK, { agentHint: '客服' });
  const session = result.sessions[0];
  assert.equal(session.judgeable, false);
  assert.ok(session.anomalies.includes('机器人回复未导出'));
  assert.equal(result.summary.unjudgeable, 1);
});

test('京小智的答复能正常看到时照常参与评分', () => {
  const input = ROBOT_BLOCK.replace('【此消息为欢迎卡片或富文本模板答案，聊天记录中暂不支持展示】', '这款带自清洁和除湿，按「自清洁」键就行~');
  const result = parseChatLog(input, { agentHint: '客服' });
  assert.equal(result.sessions[0].judgeable, true);
  assert.equal(result.summary.unjudgeable, 0);
  assert.equal(result.sessions[0].anomalies.some(item => item.startsWith('机器人回复')), false);
});

