'use strict';

// 视觉设计 1.0 的建表入口。
//
// 与项目其它模块一致：首次用到时读迁移文件执行一遍，失败就重置 ready 让下次重试，
// 这样新环境（或忘跑迁移的机器）打开页面不会因为缺表直接报错。

const fs = require('node:fs');
const path = require('node:path');
const { getInventoryPool } = require('../db/inventory-client');

let ready;

function ensureDesignSchema() {
  if (!ready) {
    ready = getInventoryPool()
      .query(fs.readFileSync(path.join(__dirname, '../db/migrations/0014_design_assets.sql'), 'utf8'))
      .catch(error => {
        ready = null;
        throw error;
      });
  }
  return ready;
}

module.exports = { ensureDesignSchema };
