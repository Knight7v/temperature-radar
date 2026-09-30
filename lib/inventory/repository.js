const {InventoryError}=require('./errors');
const {randomUUID}=require('node:crypto');
const tables=new Set(['warehouses','skus','products','pairings','rules']);
function createRepository(db){
 const repo={db,
  async lock(tenantId){await db.query('INSERT INTO inventory_state(tenant_id) VALUES($1) ON CONFLICT DO NOTHING',[tenantId]);return (await db.query('SELECT config_revision AS "configRevision",latest_date::text AS "latestDate" FROM inventory_state WHERE tenant_id=$1 FOR UPDATE',[tenantId])).rows[0];},
  async state(tenantId){return (await db.query('SELECT config_revision AS "configRevision",latest_date::text AS "latestDate" FROM inventory_state WHERE tenant_id=$1',[tenantId])).rows[0]||{configRevision:0,latestDate:null};},
  async list(tenantId,table){if(!tables.has(table))throw Error('Invalid table');return (await db.query(`SELECT data FROM inventory_${table} WHERE tenant_id=$1 ORDER BY id`,[tenantId])).rows.map(r=>r.data);},
  async put(tenantId,table,id,data){if(!tables.has(table))throw Error('Invalid table');await db.query(`INSERT INTO inventory_${table}(tenant_id,id,data) VALUES($1,$2,$3) ON CONFLICT(tenant_id,id) DO UPDATE SET data=EXCLUDED.data`,[tenantId,id,JSON.stringify(data)]);},
  async config(tenantId){const [state,products,pairings,rules]=await Promise.all([repo.state(tenantId),repo.list(tenantId,'products'),repo.list(tenantId,'pairings'),repo.list(tenantId,'rules')]);return {...state,products,pairings,rules};},
  async snapshot(tenantId,date){return (await db.query('SELECT id,date::text,revision,calculation_id AS "calculationId",data FROM inventory_snapshots WHERE tenant_id=$1 AND date=$2',[tenantId,date])).rows[0]||null;},
  async calculation(tenantId,id){const r=(await db.query('SELECT data FROM inventory_calculations WHERE tenant_id=$1 AND id=$2',[tenantId,id])).rows[0];if(!r)throw new InventoryError('NOT_FOUND','未找到对应报表',404);return r.data;},
  async saveCalculation(tenantId,data){const id=randomUUID(),value={...data,id,tenantId};await db.query('INSERT INTO inventory_calculations(id,tenant_id,data) VALUES($1,$2,$3)',[id,tenantId,JSON.stringify(value)]);return value;},
  async audit(tenantId,data){await db.query('INSERT INTO inventory_audit_logs(tenant_id,data) VALUES($1,$2)',[tenantId,JSON.stringify(data)]);}
 };return repo;
}
module.exports={createRepository};
