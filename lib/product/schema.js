'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getInventoryPool } = require('../db/inventory-client');
const { ensureQualityAiSchema } = require('../quality/ai/schema');

let ready;

// 依赖链：0005 会话表 → 0009 质检结果 → 0013 产品知识库。
// product_advice 有指向 quality_sessions 的外键，所以会话表必须先就位。
function ensureProductSchema() {
  if (!ready) {
    ready = ensureQualityAiSchema()
      .then(() =>
        getInventoryPool().query(
          fs.readFileSync(path.join(__dirname, '../db/migrations/0013_product_knowledge.sql'), 'utf8')
        )
      )
      .catch(error => {
        ready = null;
        throw error;
      });
  }
  return ready;
}

module.exports = { ensureProductSchema };
