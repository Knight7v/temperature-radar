'use strict';
const {apiHandler}=require('../lib/http');
const {requireInventoryUser}=require('../lib/inventory/access');
const {getInventoryPool,transact}=require('../lib/db/inventory-client');
const {ensureQualitySchema}=require('../lib/quality/schema');
const {sampleSessions}=require('../lib/quality/sampling');
const fail=(message,status=422)=>{throw Object.assign(Error(message),{status});};
const uuid=value=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||'')))fail('预览 ID 无效');return value;};
const publicStats=sample=>({total:sample.total,target:sample.target,selected:sample.selected.length,requestedRate:sample.requestedRate,actualRate:sample.actualRate,agentCount:sample.agentCount,coverageRaisedSample:sample.coverageRaisedSample});
module.exports=apiHandler(async(req,res)=>{
 const action=String(req.query.action||'list'),write=req.method==='POST';
 const user=await requireInventoryUser(req,write?['admin','operator']:['admin','operator','viewer']);
 await ensureQualitySchema();
 const db=getInventoryPool(),tenant=user.tenantId,body=req.body||{};
 if(req.method==='GET'&&action==='preview'){
  const preview=(await db.query('SELECT data,source_hash,created_by,created_at FROM quality_previews WHERE tenant_id=$1 AND id=$2',[tenant,uuid(req.query.id)])).rows[0];
  if(!preview||preview.created_by!==user.userId)fail('预览不存在，请重新上传',404);
  if(Date.now()-new Date(preview.created_at).getTime()>30*60*1000)fail('预览已过期，请重新上传');
  const sample=sampleSessions(preview.data.sessions,{rate:Number(req.query.rate??15),seed:preview.source_hash});
  return res.json({data:publicStats(sample)});
 }
 if(req.method==='POST'&&action==='confirm'){
  const result=await transact(db,async client=>{
   const preview=(await client.query('SELECT * FROM quality_previews WHERE tenant_id=$1 AND id=$2 AND created_by=$3 FOR UPDATE',[tenant,uuid(body.id),user.userId])).rows[0];
   if(!preview)fail('预览不存在，请重新上传',404);
   if(Date.now()-new Date(preview.created_at).getTime()>30*60*1000)fail('预览已过期，请重新上传');
   const existing=(await client.query('SELECT id,summary FROM quality_imports WHERE tenant_id=$1 AND source_hash=$2',[tenant,preview.source_hash])).rows[0];
   if(existing)return{importId:existing.id,duplicate:true,sampling:existing.summary.sampling||null};
   const sample=sampleSessions(preview.data.sessions,{rate:Number(body.rate??15),seed:preview.source_hash});
   const selected=new Set(sample.selectedOrdinals),summary={...preview.data.summary,sampling:publicStats(sample)};
   const record=(await client.query('INSERT INTO quality_imports(tenant_id,source_hash,filename,summary,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,source_hash) DO NOTHING RETURNING id',[tenant,preview.source_hash,preview.filename,summary,user.userId])).rows[0];
   if(!record){const row=(await client.query('SELECT id,summary FROM quality_imports WHERE tenant_id=$1 AND source_hash=$2',[tenant,preview.source_hash])).rows[0];return{importId:row.id,duplicate:true,sampling:row.summary.sampling||null};}
   const rows=preview.data.sessions.map(session=>({...session,sampled:selected.has(session.ordinal)}));
   await client.query("INSERT INTO quality_sessions(tenant_id,import_id,ordinal,agent,started_at,ended_at,data) SELECT $1,$2,(item->>'ordinal')::int,item->>'agent',item->>'startedAt',item->>'endedAt',item FROM jsonb_array_elements($3::jsonb) item",[tenant,record.id,JSON.stringify(rows)]);
   return{importId:record.id,duplicate:false,sampling:publicStats(sample)};
  });return res.json({data:result});
 }
 if(req.method==='GET'&&action==='list'){
  const status=String(req.query.status||'all'),scope=String(req.query.scope||'sampled');
  if(!['all','pending','draft','reviewed'].includes(status)||!['all','sampled'].includes(scope))fail('筛选条件无效');
  const page=Number(req.query.page||1);if(!Number.isInteger(page)||page<1||page>10000)fail('页码无效');
  const agent=String(req.query.agent||'').trim().slice(0,100),date=String(req.query.date||'').trim();
  if(date&&!/^20\d{2}-\d{2}-\d{2}$/.test(date))fail('日期格式无效');
  const conditions=['tenant_id=$1'],args=[tenant];
  if(scope==='sampled')conditions.push("data->>'sampled'='true'");
  if(status!=='all'){args.push(status);conditions.push(`status=$${args.length}`);}
  if(agent){args.push('%'+agent+'%');conditions.push(`agent ILIKE $${args.length}`);}
  if(date){args.push(date);conditions.push(`left(started_at,10)=$${args.length}`);}
  const where=conditions.join(' AND '),total=Number((await db.query(`SELECT count(*)::int AS total FROM quality_sessions WHERE ${where}`,args)).rows[0].total);
  const rows=(await db.query(`SELECT id,import_id,ordinal,agent,started_at,ended_at,status,revision,review->>'score' AS score,jsonb_array_length(data->'messages') AS message_count,jsonb_array_length(data->'evidence') AS evidence_count,data->>'sampled' AS sampled FROM quality_sessions WHERE ${where} ORDER BY started_at DESC,ordinal DESC LIMIT 50 OFFSET $${args.length+1}`,[...args,(page-1)*50])).rows;
  return res.json({data:{rows,total,page}});
 }
 fail('操作不存在',404);
});
