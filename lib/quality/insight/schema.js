'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getInventoryPool } = require('../../db/inventory-client');
const { ensureQualityAiSchema } = require('../ai/schema');

let ready;

// 依赖链：0005 会话表 → 0009 质检结果表 → 0010 洞察表。串行且进程内只跑一次。
function ensureQualityInsightSchema() {
  if (!ready) {
    ready = ensureQualityAiSchema()
      .then(() => getInventoryPool().query(fs.readFileSync(path.join(__dirname, '../../db/migrations/0010_quality_insight.sql'), 'utf8')))
      .catch(error => {
        ready = null;
        throw error;
      });
  }
  return ready;
}

module.exports = { ensureQualityInsightSchema };
