const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {transact,getInventoryPool}=require('../lib/db/inventory-client');
const legacyInventoryTables=['inventory_state','inventory_warehouses','inventory_skus','inventory_products','inventory_pairings','inventory_pairing_members','inventory_rules','inventory_snapshots','inventory_snapshot_rows','inventory_calculations','inventory_import_previews','inventory_import_logs','inventory_audit_logs','inventory_push_config','inventory_push_runs'];
async function migrate(pool){return transact(pool,async c=>{
 await c.query("SELECT pg_advisory_xact_lock(87402319)");
 const existing=(await c.query("SELECT to_regclass('public.tenants') AS name")).rows[0].name;
 if(!existing){
  await c.query("CREATE TYPE user_role AS ENUM ('admin','operator','viewer'); CREATE TYPE entity_status AS ENUM ('active','disabled'); CREATE TYPE tenant_status AS ENUM ('active','suspended','disabled');");
  await c.query(fs.readFileSync(path.join(__dirname,'../lib/db/migrations/0000_init.sql'),'utf8'));
 }else{
  await c.query('SELECT u.id,u.tenant_id,u.role,u.status,t.id,t.status FROM users u JOIN tenants t ON t.id=u.tenant_id LIMIT 0');
 }
 await c.query('CREATE TABLE IF NOT EXISTS inventory_schema_migrations(name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz DEFAULT now())');
 for(const name of ['0001_inventory_monitor.sql','0002_replenishment.sql']){
  const sql=fs.readFileSync(path.join(__dirname,'../lib/db/migrations',name),'utf8'),hash=crypto.createHash('sha256').update(sql).digest('hex');
  const previous=(await c.query('SELECT hash FROM inventory_schema_migrations WHERE name=$1',[name])).rows[0];
  if(previous){if(previous.hash!==hash)throw Error('库存迁移校验和不一致，请检查迁移历史');continue;}
  if(name==='0001_inventory_monitor.sql'){
   const legacy=(await c.query("SELECT count(*)::int AS tables,to_regclass('public.inventory_daily_run_unique') IS NOT NULL AS daily_index,EXISTS(SELECT 1 FROM pg_constraint WHERE conname='inventory_snapshot_calculation_fk') AS calculation_fk FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1)",[legacyInventoryTables])).rows[0];
   if(legacy.tables===legacyInventoryTables.length&&legacy.daily_index&&legacy.calculation_fk){
    await c.query('INSERT INTO inventory_schema_migrations(name,hash) VALUES($1,$2)',[name,hash]);
    continue;
   }
   if(legacy.tables>0)throw Error('检测到不完整的旧库存表，请核对后再迁移');
  }
  await c.query(sql);await c.query('INSERT INTO inventory_schema_migrations(name,hash) VALUES($1,$2)',[name,hash]);
 }
});}
if(require.main===module){const p=getInventoryPool();migrate(p).then(()=>console.log('库存迁移完成')).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.end());}
module.exports={migrate};
