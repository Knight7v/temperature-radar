// Neon + Drizzle 客户端。懒初始化:顶层 neon() 在构建期(DATABASE_URL 未配)会抛错,
// 必须延迟到首次请求。不用 Proxy 包装(会破坏部分库的内省)。
const { neon } = require('@neondatabase/serverless');
const { drizzle: drizzleNeon } = require('drizzle-orm/neon-http');
const { drizzle: drizzlePg } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const schema = require('./schema');

let _db = null;
let _sql = null;

/** 带类型的 Drizzle 客户端(租户作用域查询用)。 */
function getDb() {
    if (_db) return _db;
    const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL 未配置');
    // Local development databases cannot be reached through Neon HTTP.
    if (/localhost|127\.0\.0\.1/.test(url)) {
        _db = drizzlePg(new Pool({ connectionString: url }), { schema });
    } else {
        _db = drizzleNeon(neon(url), { schema });
    }
    return _db;
}

/** 原始 tagged-template sql(set_config 等原生操作用)。 */
function getSql() {
    if (_sql) return _sql;
    const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL 未配置');
    _sql = neon(url);
    return _sql;
}

module.exports = { getDb, getSql };
