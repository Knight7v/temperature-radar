const {apiHandler}=require('../../lib/http');
const {requireInventoryUser}=require('../../lib/inventory/access');
const {getInventoryPool}=require('../../lib/db/inventory-client');
const {createRepository}=require('../../lib/inventory/repository');
const fail=(message,status=422)=>{throw Object.assign(Error(message),{status});};
module.exports=apiHandler(async(req,res)=>{
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'不支持此请求'});
 const ctx=await requireInventoryUser(req,req.method==='GET'?['admin','operator','viewer']:['admin','operator']);
 const pool=getInventoryPool(),body=req.body||{},date=req.method==='GET'?req.query.date:body.date;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))fail('请选择数据日期');
 if(req.method==='GET'){
  const rows=await pool.query("SELECT DISTINCT ON (data->>'key') data,created_at FROM inventory_audit_logs WHERE tenant_id=$1 AND data->>'action'='inventory-followup' AND data->>'date'=$2 ORDER BY data->>'key',created_at DESC,id DESC",[ctx.tenantId,date]);
  return res.json({data:rows.rows.map(r=>({...r.data,updatedAt:r.created_at}))});
 }
 const {warehouse,entityId,kind,status}=body,note=String(body.note||'').trim();
 if(!['待处理','处理中','已处理'].includes(status))fail('处理状态无效');
 if(note.length>500)fail('处理备注最多500字');
 if(status==='已处理'&&!note)fail('请填写处理结果后标记为已处理');
 const repo=createRepository(pool),snapshot=await repo.snapshot(ctx.tenantId,date);
 if(!snapshot?.calculationId)fail('当前日期没有库存快照',404);
 const calculation=await repo.calculation(ctx.tenantId,snapshot.calculationId);
 const row=(calculation.results||[]).find(r=>r.warehouse===warehouse&&r.entityId===entityId&&r.kind===kind);
 if(!row)fail('库存记录不存在',404);
 const key=JSON.stringify([warehouse,kind,entityId]);
 const data={action:'inventory-followup',key,date,warehouse,entityId,kind,status,note,userId:ctx.userId};
 const saved=await pool.query('INSERT INTO inventory_audit_logs(tenant_id,data) VALUES($1,$2) RETURNING created_at',[ctx.tenantId,data]);
 return res.json({data:{...data,updatedAt:saved.rows[0].created_at}});
});
