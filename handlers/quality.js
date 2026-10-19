'use strict';
const {createHash}=require('node:crypto');
const {apiHandler}=require('../lib/http');
const {requireInventoryUser,requireRole}=require('../lib/inventory/access');
const {getInventoryPool,transact}=require('../lib/db/inventory-client');
const {ensureQualitySchema}=require('../lib/quality/schema');
const {readQualityFile}=require('../lib/quality/upload');
const {parseChatLog}=require('../lib/quality/parser');
const {findEvidence}=require('../lib/quality/evidence');
const {validateReview}=require('../lib/quality/review');
const {RULES,RULE_VERSION}=require('../lib/quality/rules');
const fail=(message,status=422)=>{throw Object.assign(Error(message),{status});};
const uuid=value=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||'')))fail('ID 无效');return value;};
const csv=value=>'"'+String(value??'').replaceAll('"','""')+'"';
module.exports=apiHandler(async(req,res)=>{
 const action=String(req.query.action||'list'),write=req.method==='POST';
 const user=await requireInventoryUser(req,write?['admin','operator']:['admin','operator','viewer']);
 await ensureQualitySchema();
 const db=getInventoryPool(),tenant=user.tenantId,body=req.body||{};
 if(req.method==='GET'){
  if(action==='meta')return res.json({data:{rules:RULES,ruleVersion:RULE_VERSION,role:user.role}});
  if(action==='list'){
   const status=String(req.query.status||'all');if(!['all','pending','draft','reviewed'].includes(status))fail('状态筛选无效');
   const page=Number(req.query.page||1);if(!Number.isInteger(page)||page<1||page>10000)fail('页码无效');
   const agent=String(req.query.agent||'').trim().slice(0,100),date=String(req.query.date||'').trim();
   if(date&&!/^20\d{2}-\d{2}-\d{2}$/.test(date))fail('日期格式无效');
   const conditions=['tenant_id=$1'],args=[tenant];
   if(status!=='all'){args.push(status);conditions.push(`status=$${args.length}`);}
   if(agent){args.push('%'+agent+'%');conditions.push(`agent ILIKE $${args.length}`);}
   if(date){args.push(date);conditions.push(`left(started_at,10)=$${args.length}`);}
   const where=conditions.join(' AND ');
   const total=Number((await db.query(`SELECT count(*)::int AS total FROM quality_sessions WHERE ${where}`,args)).rows[0].total);
   const rows=(await db.query(`SELECT id,import_id,ordinal,agent,started_at,ended_at,status,revision,review->>'score' AS score,jsonb_array_length(data->'messages') AS message_count,jsonb_array_length(data->'evidence') AS evidence_count FROM quality_sessions WHERE ${where} ORDER BY started_at DESC,ordinal DESC LIMIT 50 OFFSET $${args.length+1}`,[...args,(page-1)*50])).rows;
   return res.json({data:{rows,total,page}});
  }
  if(action==='detail'){
   const row=(await db.query('SELECT id,import_id,ordinal,agent,started_at,ended_at,data,review,status,revision,reviewed_by,reviewed_at FROM quality_sessions WHERE tenant_id=$1 AND id=$2',[tenant,uuid(req.query.id)])).rows[0];
   if(!row)fail('会话不存在',404);return res.json({data:row});
  }
  if(action==='summary'){
   const date=String(req.query.date||new Date().toISOString().slice(0,10));if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))fail('日期格式无效');
   const rows=(await db.query("SELECT status,review->>'score' AS score FROM quality_sessions WHERE tenant_id=$1 AND left(started_at,10)=$2",[tenant,date])).rows;
   const scores=rows.filter(row=>row.status==='reviewed').map(row=>Number(row.score));
   return res.json({data:{date,sessions:rows.length,reviewed:scores.length,pending:rows.length-scores.length,average:scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*100)/100:null}});
  }
  if(action==='export'){
   const date=String(req.query.date||new Date().toISOString().slice(0,10));if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))fail('日期格式无效');
   const rows=(await db.query("SELECT agent,started_at,ended_at,review->>'score' AS score,review->>'note' AS note FROM quality_sessions WHERE tenant_id=$1 AND status='reviewed' AND left(started_at,10)=$2 ORDER BY started_at,ordinal",[tenant,date])).rows;
   const lines=[['客服','开始时间','结束时间','主管评分','复核备注'],...rows.map(row=>[row.agent,row.started_at,row.ended_at,row.score,row.note])];
   res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="quality-${date}.csv"`);
   return res.end('\uFEFF'+lines.map(line=>line.map(csv).join(',')).join('\r\n'));
  }
  fail('操作不存在',404);
 }
 if(req.method!=='POST')fail('不支持此请求',405);
 if(action==='preview'){
  let filename;try{filename=decodeURIComponent(req.headers['x-quality-filename']||'');}catch{fail('文件名编码无效');}
  filename=String(filename).split(/[\\/]/).at(-1).slice(0,200);
  const raw=readQualityFile(filename,Buffer.isBuffer(body)?body:Buffer.alloc(0));
  const parsed=parseChatLog(raw,{agentHint:String(req.query.agentHint||'客服')});
  const data={summary:parsed.summary,speakers:parsed.speakers,sessions:parsed.sessions.map(session=>({...session,evidence:findEvidence(session)}))};
  const hash=createHash('sha256').update(raw).digest('hex');
  const inserted=(await db.query('INSERT INTO quality_previews(tenant_id,source_hash,filename,data,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[tenant,hash,filename,data,user.userId])).rows[0];
  return res.json({data:{id:inserted.id,filename,summary:data.summary,speakers:data.speakers,examples:data.sessions.slice(0,3).map(session=>({ordinal:session.ordinal,agent:session.agent,startedAt:session.startedAt,anomalies:session.anomalies,evidenceCount:session.evidence.length}))}});
 }
 if(action==='confirm'){
  const result=await transact(db,async client=>{
   const preview=(await client.query('SELECT * FROM quality_previews WHERE tenant_id=$1 AND id=$2 AND created_by=$3 FOR UPDATE',[tenant,uuid(body.id),user.userId])).rows[0];
   if(!preview)fail('预览不存在，请重新上传',404);
   if(Date.now()-new Date(preview.created_at).getTime()>30*60*1000)fail('预览已过期，请重新上传');
   const existing=(await client.query('SELECT id FROM quality_imports WHERE tenant_id=$1 AND source_hash=$2',[tenant,preview.source_hash])).rows[0];
   if(existing)return{importId:existing.id,duplicate:true};
   const record=(await client.query('INSERT INTO quality_imports(tenant_id,source_hash,filename,summary,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,source_hash) DO NOTHING RETURNING id',[tenant,preview.source_hash,preview.filename,preview.data.summary,user.userId])).rows[0];
   if(!record)return{importId:(await client.query('SELECT id FROM quality_imports WHERE tenant_id=$1 AND source_hash=$2',[tenant,preview.source_hash])).rows[0].id,duplicate:true};
   await client.query("INSERT INTO quality_sessions(tenant_id,import_id,ordinal,agent,started_at,ended_at,data) SELECT $1,$2,(item->>'ordinal')::int,item->>'agent',item->>'startedAt',item->>'endedAt',item FROM jsonb_array_elements($3::jsonb) item",[tenant,record.id,JSON.stringify(preview.data.sessions)]);
   return{importId:record.id,duplicate:false,sessions:preview.data.sessions.length};
  });return res.json({data:result});
 }
 if(action==='review'){
  requireRole(user,['admin']);
  const result=await transact(db,async client=>{
   const row=(await client.query('SELECT id,data,revision FROM quality_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,uuid(body.id)])).rows[0];
   if(!row)fail('会话不存在',404);if(row.revision!==Number(body.revision))fail('会话已由其他人更新，请刷新后重试',409);
   const review=validateReview(body,row.data.evidence||[]);
   const updated=(await client.query("UPDATE quality_sessions SET review=$1,status=$2,revision=revision+1,reviewed_by=$3,reviewed_at=CASE WHEN $2='reviewed' THEN now() ELSE NULL END WHERE tenant_id=$4 AND id=$5 RETURNING revision",[review,review.status,user.userId,tenant,row.id])).rows[0];
   await client.query('INSERT INTO quality_review_events(tenant_id,session_id,actor_id,review) VALUES($1,$2,$3,$4)',[tenant,row.id,user.userId,review]);
   return{review,revision:updated.revision};
  });return res.json({data:result});
 }
 fail('操作不存在',404);
});
