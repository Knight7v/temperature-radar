const {Pool}=require('pg');
let pool;
function getInventoryPool(){if(!pool){if(!process.env.DATABASE_URL)throw Object.assign(Error('数据库尚未配置'),{status:503,code:'DATABASE_NOT_CONFIGURED'});pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:20000});}return pool;}
async function transact(p,fn){const c=await p.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
function withInventoryTransaction(fn){return transact(getInventoryPool(),fn);}
module.exports={getInventoryPool,transact,withInventoryTransaction};
