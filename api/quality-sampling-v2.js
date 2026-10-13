'use strict';
const {apiHandler}=require('../lib/http');
const {requireInventoryUser}=require('../lib/inventory/access');
const {getInventoryPool,transact}=require('../lib/db/inventory-client');
const {ensureQualitySchema}=require('../lib/quality/schema');
const {planLegacySample}=require('../lib/quality/backfill');
const original=require('./quality-sampling');
async function repairLegacyImports(tenant){
 const db=getInventoryPool();
 return transact(db,async client=>{
  const imports=(await client.query("SELECT id,source_hash FROM quality_imports WHERE tenant_id=$1 AND NOT (summary ? 'sampling') ORDER BY created_at,id FOR UPDATE",[tenant])).rows;
  let repaired=0;
  for(const record of imports){
   const sessions=(await client.query('SELECT ordinal,agent,status FROM quality_sessions WHERE tenant_id=$1 AND import_id=$2 ORDER BY ordinal FOR UPDATE',[tenant,record.id])).rows;
   if(!sessions.length)continue;
   const plan=planLegacySample(sessions,record.source_hash);
   await client.query("UPDATE quality_sessions SET data=jsonb_set(data,'{sampled}',to_jsonb(ordinal = ANY($3::int[])),true) WHERE tenant_id=$1 AND import_id=$2",[tenant,record.id,plan.selectedOrdinals]);
   await client.query("UPDATE quality_imports SET summary=jsonb_set(summary,'{sampling}',$3::jsonb,true) WHERE tenant_id=$1 AND id=$2",[tenant,record.id,plan.sampling]);
   repaired++;
  }
  return repaired;
 });
}
module.exports=apiHandler(async(req,res)=>{
 const action=String(req.query.action||'list');
 if((req.method==='GET'&&action==='list')||(req.method==='POST'&&action==='confirm')){
  const user=await requireInventoryUser(req,req.method==='POST'?['admin','operator']:['admin','operator','viewer']);
  await ensureQualitySchema();
  await repairLegacyImports(user.tenantId);
 }
 return original(req,res);
});
module.exports.repairLegacyImports=repairLegacyImports;
