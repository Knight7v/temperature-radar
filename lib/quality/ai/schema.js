'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getInventoryPool } = require('../../db/inventory-client');
const { ensureQualitySchema } = require('../schema');

let ready;

// 0005 建会话表，0009 建 AI 结果表；必须串行，且只在进程内执行一次。
function ensureQualityAiSchema() {
  if (!ready) {
    ready = ensureQualitySchema()
      .then(() => getInventoryPool().query(fs.readFileSync(path.join(__dirname, '../../db/migrations/0009_quality_ai.sql'), 'utf8')))
      .catch(error => {
        ready = null;
        throw error;
      });
  }
  return ready;
}

module.exports = { ensureQualityAiSchema };
