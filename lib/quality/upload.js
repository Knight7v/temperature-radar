'use strict';

function fail(message) { throw Object.assign(Error(message), { status: 422 }); }

function readQualityFile(filename, bytes) {
  if (!/\.(log|txt)$/i.test(String(filename || ''))) fail('仅支持 LOG、TXT 格式的聊天记录');
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail('聊天记录文件不能为空');
  if (bytes.length > 3 * 1024 * 1024) fail('单个聊天记录文件不能超过 3 MB');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('聊天记录必须使用 UTF-8 编码'); }
  if (!content.trim()) fail('聊天记录文件不能为空');
  return content.replace(/^\uFEFF/, '');
}

module.exports = { readQualityFile };
