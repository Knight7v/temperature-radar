'use strict';

// 价格监控的建表入口，与 design/inventory 模块保持同一套做法：
// 第一次用到时把迁移文件依次执行一遍（全是 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS，可重复跑），
// 失败就把 ready 清空，下次请求重试——这样忘了跑迁移的机器也不会一打开就 500。

const fs = require('node:fs');
const path = require('node:path');
const { getInventoryPool } = require('../db/inventory-client');

// 顺序不能乱：0020 的 ALTER 依赖 0019 建好的表
const FILES = ['0019_price_monitor.sql', '0020_price_landed_cost.sql'];

let ready = null;

function ensurePriceSchema() {
  if (!ready) {
    const db = getInventoryPool();
    ready = FILES.reduce(
      (chain, file) =>
        chain.then(() => db.query(fs.readFileSync(path.join(__dirname, '../db/migrations', file), 'utf8'))),
      Promise.resolve()
    ).catch(error => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

module.exports = { ensurePriceSchema, FILES };
