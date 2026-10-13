'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { getInventoryPool } = require('../db/inventory-client');
let ready;
function ensureQualitySchema() {
  if (!ready) ready = getInventoryPool().query(fs.readFileSync(path.join(__dirname, '../db/migrations/0005_quality.sql'), 'utf8')).catch(error => { ready = null; throw error; });
  return ready;
}
module.exports = { ensureQualitySchema };
