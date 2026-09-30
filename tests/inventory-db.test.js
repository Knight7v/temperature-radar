const test=require('node:test'),assert=require('node:assert/strict');
const {Pool}=require('pg');const {transact}=require('../lib/db/inventory-client');
const {migrate}=require('../scripts/migrate');
const url=process.env.INVENTORY_TEST_DATABASE_URL;
test('real PostgreSQL migration is repeatable and transaction rolls back',{skip:!url},async()=>{
 const pool=new Pool({connectionString:url});try{await migrate(pool);await migrate(pool);
 const id=require('node:crypto').randomUUID();
 await assert.rejects(()=>transact(pool,async c=>{await c.query('INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3)',[id,'test',id]);throw Error('rollback');}),/rollback/);
 assert.equal((await pool.query('SELECT id FROM tenants WHERE id=$1',[id])).rowCount,0);
 }finally{await pool.end();}
});
