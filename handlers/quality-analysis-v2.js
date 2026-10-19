'use strict';
const {apiHandler}=require('../lib/http');
const {requireInventoryUser,requireRole}=require('../lib/inventory/access');
const {getInventoryPool,transact}=require('../lib/db/inventory-client');
const {ensureQualitySchema}=require('../lib/quality/schema');
const {sampleSessions}=require('../lib/quality/sampling');
const {resolveAssignment,validateAssignment}=require('../lib/quality/classification');
const {scoreConversation,VERSION}=require('../lib/quality/machine-score');
const {RULES,RULE_VERSION}=require('../lib/quality/rules');
const {validateReview}=require('../lib/quality/review');
const {CATEGORIES,analyzeConversation,checksForCategories}=require('../lib/quality/intent');
const fail=(message,status=422)=>{throw Object.assign(Error(message),{status});};
const uuid=value=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||'')))fail('ID 无效');return value;};
const stats=sample=>({total:sample.total,target:sample.target,selected:sample.selected.length,requestedRate:sample.requestedRate,actualRate:sample.actualRate,agentCount:sample.agentCount,coverageRaisedSample:sample.coverageRaisedSample});
const policy=[
 {code:'abusive-language',points:40,label:'客服明确侮辱性用语',condition:'匹配明确侮辱用语，主管必须核对语境'},
 {code:'slow-reply',points:5,label:'人工回复间隔 ≥ 2 分钟',condition:'最长顾客消息至后续人工回复间隔 120–299 秒'},
 {code:'slow-reply',points:10,label:'人工回复间隔 ≥ 5 分钟',condition:'最长间隔 ≥ 300 秒；与 2 分钟档不叠加'}
];
module.exports=apiHandler(async(req,res)=>{
 const action=String(req.query.action||'list');
 const write=req.method==='POST';
 const user=await requireInventoryUser(req,write?['admin','operator']:['admin','operator','viewer']);
 await ensureQualitySchema();
 const db=getInventoryPool(),tenant=user.tenantId,body=req.body||{};
 const shops=async()=> (await db.query("SELECT id,data FROM sales_shops WHERE tenant_id=$1 ORDER BY data->>'name'",[tenant])).rows;
 if(req.method==='GET'&&action==='meta')return res.json({data:{rules:RULES,ruleVersion:RULE_VERSION,categories:[...CATEGORIES.map(({id,label})=>({id,label})),{id:'unknown',label:'待分类'}],checksByCategory:Object.fromEntries([...CATEGORIES.map(item=>item.id),'unknown'].map(id=>[id,checksForCategories([id])])),role:user.role,shops:await shops(),machinePolicy:policy,machineVersion:VERSION}});
 if(req.method==='GET'&&action==='preview'){
  const preview=(await db.query('SELECT data,source_hash,created_by,created_at FROM quality_previews WHERE tenant_id=$1 AND id=$2',[tenant,uuid(req.query.id)])).rows[0];
  if(!preview||preview.created_by!==user.userId)fail('预览不存在，请重新上传',404);
  if(Date.now()-new Date(preview.created_at).getTime()>30*60*1000)fail('预览已过期，请重新上传');
  return res.json({data:stats(sampleSessions(preview.data.sessions,{rate:Number(req.query.rate??15),seed:preview.source_hash}))});
 }
 if(req.method==='POST'&&action==='confirm'){
  const catalog=await shops();
  const assignment=validateAssignment({shopId:body.shopId},catalog);
  const result=await transact(db,async client=>{
   const preview=(await client.query('SELECT * FROM quality_previews WHERE tenant_id=$1 AND id=$2 AND created_by=$3 FOR UPDATE',[tenant,uuid(body.id),user.userId])).rows[0];
   if(!preview)fail('预览不存在，请重新上传',404);
   if(Date.now()-new Date(preview.created_at).getTime()>30*60*1000)fail('预览已过期，请重新上传');
   const existing=(await client.query('SELECT id,summary FROM quality_imports WHERE tenant_id=$1 AND source_hash=$2',[tenant,preview.source_hash])).rows[0];
   if(existing)return{importId:existing.id,duplicate:true,sampling:existing.summary.sampling||null};
   const sample=sampleSessions(preview.data.sessions,{rate:Number(body.rate??15),seed:preview.source_hash});
   const selected=new Set(sample.selectedOrdinals);
   const summary={...preview.data.summary,sampling:stats(sample),assignment};
   const record=(await client.query('INSERT INTO quality_imports(tenant_id,source_hash,filename,summary,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,source_hash) DO NOTHING RETURNING id',[tenant,preview.source_hash,preview.filename,summary,user.userId])).rows[0];
   if(!record){const row=(await client.query('SELECT id,summary FROM quality_imports WHERE tenant_id=$1 AND source_hash=$2',[tenant,preview.source_hash])).rows[0];return{importId:row.id,duplicate:true,sampling:row.summary.sampling||null};}
   const rows=preview.data.sessions.map(session=>({...session,sampled:selected.has(session.ordinal),assignment:assignment||resolveAssignment(session,catalog),machine:scoreConversation(session)}));
   await client.query("INSERT INTO quality_sessions(tenant_id,import_id,ordinal,agent,started_at,ended_at,data) SELECT $1,$2,(item->>'ordinal')::int,item->>'agent',item->>'startedAt',item->>'endedAt',item FROM jsonb_array_elements($3::jsonb) item",[tenant,record.id,JSON.stringify(rows)]);
   return{importId:record.id,duplicate:false,sampling:stats(sample)};
  });return res.json({data:result});
 }
 if(req.method==='GET'&&action==='list'){
  const status=String(req.query.status||'all'),scope=String(req.query.scope||'sampled');
  const brand=String(req.query.brand||'all'),group=String(req.query.group||'all'),shopId=String(req.query.shop||'all'),warning=String(req.query.warning||'all');
  if(!['all','pending','draft','reviewed'].includes(status)||!['all','sampled'].includes(scope)||!['all','格力','海尔','未识别'].includes(brand)||!['all','格力组','海尔组','未识别'].includes(group)||!['all','flagged'].includes(warning))fail('筛选条件无效');
  const page=Number(req.query.page||1);if(!Number.isInteger(page)||page<1||page>10000)fail('页码无效');
  const agent=String(req.query.agent||'').trim().slice(0,100),date=String(req.query.date||'').trim();if(date&&!/^20\d{2}-\d{2}-\d{2}$/.test(date))fail('日期格式无效');
  const catalog=await shops();if(shopId!=='all'&&shopId!=='unlinked'&&!catalog.some(x=>x.id===shopId))fail('店铺不存在');
  const conditions=['tenant_id=$1'],args=[tenant];
  if(scope==='sampled')conditions.push("data->>'sampled'='true'");
  if(status!=='all'){args.push(status);conditions.push(`status=$${args.length}`);}
  if(agent){args.push('%'+agent+'%');conditions.push(`agent ILIKE $${args.length}`);}
  if(date){args.push(date);conditions.push(`left(started_at,10)=$${args.length}`);}
  const candidates=(await db.query(`SELECT id,agent,started_at,status,data->'assignment' AS assignment,data->>'sampled' AS sampled FROM quality_sessions WHERE ${conditions.join(' AND ')} ORDER BY started_at DESC,ordinal DESC`,args)).rows;
  const matched=candidates.filter(row=>{
   const assignment=resolveAssignment({agent:row.agent,assignment:row.assignment},catalog);
   return(shopId==='all'||(shopId==='unlinked'?!assignment.shopId:assignment.shopId===shopId))&&(brand==='all'||assignment.brand===brand)&&(group==='all'||assignment.group===group);
  });
  const ids=matched.map(x=>x.id),rowData=[];
  // Warning filtering needs the full message evidence; only load it for that explicit filter.
  if(warning==='flagged'&&ids.length){const all=(await db.query('SELECT id,data FROM quality_sessions WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[tenant,ids])).rows;const flagged=new Set(all.filter(x=>scoreConversation(x.data).warnings.some(w=>w.severity==='high')).map(x=>x.id));matched.splice(0,matched.length,...matched.filter(x=>flagged.has(x.id)));}
  const total=matched.length,pageIds=matched.slice((page-1)*50,page*50).map(x=>x.id);
  if(pageIds.length){const rows=(await db.query('SELECT id,import_id,ordinal,agent,started_at,ended_at,status,revision,review,data FROM quality_sessions WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[tenant,pageIds])).rows;const byId=new Map(rows.map(row=>[row.id,row]));
   for(const id of pageIds){const row=byId.get(id);if(!row)continue;const data=row.data||{},machine=data.machine?.version===VERSION?data.machine:scoreConversation(data),analysis=analyzeConversation(data);rowData.push({id:row.id,import_id:row.import_id,ordinal:row.ordinal,agent:row.agent,started_at:row.started_at,ended_at:row.ended_at,status:row.status,revision:row.revision,score:row.review?.score??null,message_count:data.messages?.length||0,evidence_count:data.evidence?.length||0,sampled:String(data.sampled),assignment:resolveAssignment(data,catalog),categories:row.review?.categoryIds||analysis.categories.map(item=>item.id),machine});}
  }
  return res.json({data:{rows:rowData,total,page}});
 }
 if(req.method==='GET'&&action==='detail'){
  const row=(await db.query('SELECT id,import_id,ordinal,agent,started_at,ended_at,data,review,status,revision,reviewed_by,reviewed_at FROM quality_sessions WHERE tenant_id=$1 AND id=$2',[tenant,uuid(req.query.id)])).rows[0];
  if(!row)fail('会话不存在',404);
  const catalog=await shops();row.assignment=resolveAssignment(row.data,catalog);row.machine=row.data?.machine?.version===VERSION?row.data.machine:scoreConversation(row.data);row.analysis=analyzeConversation(row.data);
  return res.json({data:row});
 }
 if(req.method==='POST'&&action==='review'){
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
