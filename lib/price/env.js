'use strict';

/**
 * 读取 .env.local（项目里没装 dotenv，Node 的 --env-file 只在命令行可用，
 * 脚本被定时任务调用时不方便加参数，所以这里自己解析一份，逻辑保持最小）。
 *
 * 规则：只补缺失的变量，不覆盖环境里已有的；不支持多行值（.env.local 里也没有）。
 */

const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const target = file || path.join(__dirname, '..', '..', '.env.local');
  let raw = '';
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (e) {
    return { loaded: false, count: 0, file: target };
  }
  let count = 0;
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 1) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) {
      process.env[k] = v;
      count += 1;
    }
  }
  return { loaded: true, count, file: target };
}

module.exports = { loadEnv };
