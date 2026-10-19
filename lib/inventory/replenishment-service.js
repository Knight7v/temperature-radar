const {randomUUID}=require('node:crypto');
const {getInventoryPool,transact}=require('../db/inventory-client');
const {createRepository}=require('./repository');
const {InventoryError}=require('./errors');
const {buildReplenishmentRows}=require('./replenishment-core');
const {formatDailyAlert,formatPlanNotice,splitDailyAlerts}=require('./replenishment-message');
const {encryptWebhook,decryptWebhook,createWecomClient}=require('./wecom');

const fail=(code,message,status=422)=>{throw new InventoryError(code,message,status);};
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));

async function report(ctx,{date,sku}={}){
 const db=getInventoryPool(),repo=createRepository(db),state=await repo.state(ctx.tenantId),target=date||state.latestDate;
 if(!target)return {date:null,skus:[],sku:null,rows:[]};
 if(!validDate(target))fail('DATE_INVALID','数据日期无效');
 const snap=await repo.snapshot(ctx.tenantId,target);
 if(!snap?.calculationId)fail('SNAPSHOT_MISSING','所选日期没有有效库存快照',404);
 const calc=await repo.calculation(ctx.tenantId,snap.calculationId),facts=(calc.results||[]).filter(x=>x.kind==='sku');
 const skus=[...new Map(facts.map(x=>[x.entityId,{id:x.entityId,name:x.name||x.entityId}])).values()].sort((a,b)=>a.name.localeCompare(b.name,'zh'));
 const chosen=sku||skus[0]?.id||null;
 if(chosen&&!skus.some(x=>x.id===chosen))fail('SKU_MISSING','商品不在所选库存快照中',404);
 const plans=new Map();
 if(chosen){const records=await db.query('SELECT warehouse,data,revision FROM inventory_replenishment_plans WHERE tenant_id=$1 AND date=$2 AND sku=$3',[ctx.tenantId,target,chosen]);for(const r of records.rows)plans.set(r.warehouse,{...r.data,revision:r.revision});}
 const rows=buildReplenishmentRows(facts.filter(x=>x.entityId===chosen),plans).sort((a,b)=>a.warehouse.localeCompare(b.warehouse,'zh'));
 if(chosen){
  const history=await db.query("SELECT s.date::text AS date,r.warehouse,(r.data->'sales'->>'1')::numeric AS units FROM inventory_snapshot_rows r JOIN inventory_snapshots s ON s.id=r.snapshot_id AND s.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.sku=$2 AND s.date BETWEEN $3::date-interval '29 days' AND $3::date ORDER BY s.date",[ctx.tenantId,chosen,target]);
  const trends=new Map();for(const h of history.rows){if(!trends.has(h.warehouse))trends.set(h.warehouse,[]);if(h.units!==null)trends.get(h.warehouse).push({date:h.date,units:Number(h.units)});}
  for(const row of rows)row.trend=trends.get(row.warehouse)||[];
 }
 return {date:target,sku:chosen,skus,rows,snapshotRevision:snap.revision};
}

async function savePlan(ctx,input){
 const {date,sku,warehouse,stage,expectedRevision}=input;
 if(!validDate(date)||!sku||!warehouse)fail('PLAN_INVALID','日期、商品和仓库不能为空');
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('VERSION_INVALID','请刷新页面后重试');
 if(stage!=='operator'&&stage!=='supply')fail('STAGE_INVALID','补货填写阶段无效');
 if(stage==='operator'&&!['admin','operator'].includes(ctx.role)||stage==='supply'&&!['admin','supply_chain'].includes(ctx.role))fail('FORBIDDEN','当前角色无权填写该字段',403);
 const patch={};
 if(stage==='operator'){
  patch.demand=String(input.demand||'').trim();
  if(!patch.demand||patch.demand.length>500)fail('DEMAND_INVALID','补货需求须填写且不超过500字');
  for(const k of ['batch1','batch2']){if(!Number.isSafeInteger(input[k])||input[k]<0||input[k]>1000000)fail('QUANTITY_INVALID','补货数量须为0至1000000的整数');patch[k]=input[k];}
 }else{
  if(!Number.isSafeInteger(input.recommendation)||input.recommendation<0||input.recommendation>1000000)fail('RECOMMENDATION_INVALID','补货建议须为0至1000000的整数');
  patch.recommendation=input.recommendation;
 }
 const db=getInventoryPool();
 const out=await transact(db,async c=>{
  const repo=createRepository(c),snap=await repo.snapshot(ctx.tenantId,date);
  if(!snap?.calculationId)fail('SNAPSHOT_MISSING','所选日期没有库存快照',404);
  const calc=await repo.calculation(ctx.tenantId,snap.calculationId);
  const fact=(calc.results||[]).find(x=>x.kind==='sku'&&x.entityId===sku&&x.warehouse===warehouse);
  if(!fact)fail('ROW_MISSING','仓库或商品与库存快照不一致',404);
  await c.query("INSERT INTO inventory_replenishment_plans(tenant_id,date,sku,warehouse) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[ctx.tenantId,date,sku,warehouse]);
  const old=(await c.query('SELECT data,revision FROM inventory_replenishment_plans WHERE tenant_id=$1 AND date=$2 AND sku=$3 AND warehouse=$4 FOR UPDATE',[ctx.tenantId,date,sku,warehouse])).rows[0];
  if(old.revision!==expectedRevision)fail('VERSION_CONFLICT','这行数据已被其他人修改，请刷新后重试',409);
  const plan={...old.data,...patch},changed=Object.keys(patch).some(k=>old.data[k]!==patch[k]);
  if(!changed)return {plan:{...plan,revision:old.revision},eventId:null};
  const revision=old.revision+1;
  await c.query('UPDATE inventory_replenishment_plans SET data=$1,revision=$2,updated_at=now() WHERE tenant_id=$3 AND date=$4 AND sku=$5 AND warehouse=$6',[JSON.stringify(plan),revision,ctx.tenantId,date,sku,warehouse]);
  await repo.audit(ctx.tenantId,{type:'replenishment.plan.updated',date,sku,warehouse,stage,revision,userId:ctx.userId});
  const eventId=randomUUID(),payload={...plan,date,warehouse,entityId:sku,name:fact.name||sku};
  await c.query('INSERT INTO inventory_replenishment_events(id,tenant_id,event_key,kind,data) VALUES($1,$2,$3,$4,$5)',[eventId,ctx.tenantId,JSON.stringify(['plan',date,sku,warehouse,stage,revision]),'plan',JSON.stringify({stage,payload})]);
  return {plan:{...plan,revision},eventId};
 });
 const delivery=out.eventId?await deliverEvent(ctx.tenantId,out.eventId):'unchanged';
 return {...out,delivery};
}

async function pushConfig(ctx){
 const r=await getInventoryPool().query('SELECT data FROM inventory_push_config WHERE tenant_id=$1',[ctx.tenantId]);
 return {configured:Boolean(r.rows[0]?.data?.webhookUrlEnc)};
}

async function configureWebhook(ctx,webhook){
 if(ctx.role!=='admin')fail('FORBIDDEN','仅管理员可配置库存机器人',403);
 const encrypted=encryptWebhook(webhook,process.env.INVENTORY_WEBHOOK_ENCRYPTION_KEY);
 const db=getInventoryPool();
 await db.query("INSERT INTO inventory_push_config(tenant_id,data) VALUES($1,$2) ON CONFLICT(tenant_id) DO UPDATE SET data=EXCLUDED.data",[ctx.tenantId,JSON.stringify({webhookUrlEnc:encrypted})]);
 const queued=(await db.query("SELECT id FROM inventory_replenishment_events WHERE tenant_id=$1 AND status='pending' AND kind='plan' AND created_at>now()-interval '7 days' ORDER BY created_at LIMIT 100",[ctx.tenantId])).rows;
 let sent=0;for(const event of queued)if(await deliverEvent(ctx.tenantId,event.id)==='sent')sent++;
 return {configured:true,queuedDelivered:sent};
}

async function deliverEvent(tenantId,eventId){
 const db=getInventoryPool();
 const claimed=(await db.query("UPDATE inventory_replenishment_events SET status='sending',attempts=attempts+1,attempted_at=now() WHERE tenant_id=$1 AND id=$2 AND (status='pending' OR (status='sending' AND attempted_at<now()-interval '5 minutes')) RETURNING kind,data",[tenantId,eventId])).rows[0];
 if(!claimed)return 'already-sent-or-sending';
 try{
  const config=(await db.query('SELECT data FROM inventory_push_config WHERE tenant_id=$1',[tenantId])).rows[0]?.data;
  if(!config?.webhookUrlEnc)throw Error('库存专用企业微信机器人尚未配置');
  const webhook=decryptWebhook(config.webhookUrlEnc,process.env.INVENTORY_WEBHOOK_ENCRYPTION_KEY);
  const content=claimed.kind==='daily'?formatDailyAlert(claimed.data):formatPlanNotice(claimed.data.stage,claimed.data.payload);
  await createWecomClient({webhook}).sendMarkdown(content);
  await db.query("UPDATE inventory_replenishment_events SET status='sent',sent_at=now(),last_error=NULL WHERE tenant_id=$1 AND id=$2",[tenantId,eventId]);
  return 'sent';
 }catch(e){
  await db.query("UPDATE inventory_replenishment_events SET status='pending',last_error=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,eventId,String(e.message||e).slice(0,200)]);
  return 'pending';
 }
}

async function runDaily(executionDate){
 if(!validDate(executionDate))fail('DATE_INVALID','执行日期无效');
 const db=getInventoryPool(),tenants=(await db.query("SELECT s.tenant_id,s.latest_date::text AS date FROM inventory_state s JOIN tenants t ON t.id=s.tenant_id AND t.status='active' WHERE s.latest_date IS NOT NULL")).rows;
 const result={tenants:tenants.length,alertGroups:0,sent:0,pending:0,missingConfig:0};
 for(const item of tenants){
  const cfg=(await db.query('SELECT 1 FROM inventory_push_config WHERE tenant_id=$1',[item.tenant_id])).rowCount;
  if(!cfg){result.missingConfig++;continue;}
  const repo=createRepository(db),snap=await repo.snapshot(item.tenant_id,item.date);
  if(!snap?.calculationId)continue;
  const calc=await repo.calculation(item.tenant_id,snap.calculationId);
  const rows=buildReplenishmentRows(calc.results||[]).filter(x=>x.alerts.length);
  if(!rows.length)continue;
  result.alertGroups++;
  const chunks=splitDailyAlerts(rows,item.date);
  for(let i=0;i<chunks.length;i++){
   const eventKey=JSON.stringify(['daily',executionDate,item.date,snap.calculationId,i+1]);
   const inserted=await db.query('INSERT INTO inventory_replenishment_events(tenant_id,event_key,kind,data) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,event_key) DO UPDATE SET event_key=EXCLUDED.event_key RETURNING id,status',[item.tenant_id,eventKey,'daily',JSON.stringify(chunks[i])]);
   if(inserted.rows[0].status==='sent')continue;
   const status=await deliverEvent(item.tenant_id,inserted.rows[0].id);
   if(status==='sent')result.sent++;else result.pending++;
  }
 }
 const oldPending=(await db.query("SELECT e.id,e.tenant_id FROM inventory_replenishment_events e JOIN tenants t ON t.id=e.tenant_id AND t.status='active' WHERE e.status='pending' AND e.kind='plan' AND e.created_at>now()-interval '7 days' ORDER BY e.created_at LIMIT 100")).rows;
 for(const e of oldPending){const status=await deliverEvent(e.tenant_id,e.id);if(status==='sent')result.sent++;else result.pending++;}
 return result;
}

module.exports={report,savePlan,pushConfig,configureWebhook,deliverEvent,runDaily};
