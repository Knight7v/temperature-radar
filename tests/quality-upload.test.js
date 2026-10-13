const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readQualityFile } = require('../lib/quality/upload');

test('chat transcripts accept LOG and TXT files with UTF-8 content', () => {
  const bytes = Buffer.from('客服聊天记录\n一通会话');
  assert.equal(readQualityFile('records.log', bytes), '客服聊天记录\n一通会话');
  assert.equal(readQualityFile('records.TXT', bytes), '客服聊天记录\n一通会话');
});

test('chat upload rejects spreadsheet files and invalid text', () => {
  assert.throws(() => readQualityFile('daily.xlsx', Buffer.from('data')), /仅支持 LOG、TXT/);
  assert.throws(() => readQualityFile('records.log', Buffer.from([0xff, 0xfe])), /UTF-8/);
  assert.throws(() => readQualityFile('records.txt', Buffer.alloc(0)), /不能为空/);
});
