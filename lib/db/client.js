// Neon + Drizzle 客户端。懒初始化:顶层 neon() 在构建期(DATABASE_URL 未配)会抛错,
// 必须延迟到首次请求。不用 Proxy 包装(会破坏部分库的内省)。
const { neon } = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-http');
const schema = require('./schema');

let _db = null;
let _sql = null;

/** 带类型的 Drizzle 客户端(租户作用域查询用)。 */
function getDb() {
    if (_db) return _db;
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未配置');
    _db = drizzle(neon(process.env.DATABASE_URL), { schema });
    return _db;
}

/** 原始 tagged-template sql(set_config 等原生操作用)。 */
function getSql() {
    if (_sql) return _sql;
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未配置');
    _sql = neon(process.env.DATABASE_URL);
    return _sql;
}

module.exports = { getDb, getSql };
