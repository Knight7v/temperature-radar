const {createRepository}=require('./repository'),{getInventoryPool,withInventoryTransaction}=require('../db/inventory-client'),{parseInventoryFile}=require('./import-parser'),{calculateInventory}=require('./calculate'),{InventoryError}=require('./errors'),{requireRole}=require('./access');
function rowKey(r){return JSON.stringify([r.warehouse,r.jdSku]);}
function compareRows(oldRows,rows){const old=new Map(oldRows.map(r=>[rowKey(r),r])),next=new Map(rows.map(r=>[rowKey(r),r]));return {added:rows.filter(r=>!old.has(rowKey(r))),changed:rows.filter(r=>old.has(rowKey(r))&&JSON.stringify(old.get(rowKey(r)))!==JSON.stringify(r)).map(r=>({before:old.get(rowKey(r)),after:r})),missing:oldRows.filter(r=>!next.has(rowKey(r)))};}
function createSnapshotService({repository=createRepository(getInventoryPool()),withTransaction=withInventoryTransaction}={}){
 return {
  async previewImport(ctx,{buffer,filename,now=new Date()}){requireRole(ctx,['admin','operator','supply_chain']);const parsed=await parseInventoryFile({buffer,filename,now});return withTransaction(async db=>{
   const repo=createRepository(db),state=await repo.lock(ctx.tenantId),snap=await repo.snapshot(ctx.tenantId,parsed.date),latest=state.latestDate?await repo.snapshot(ctx.tenantId,state.latestDate):null;
   const names=[...new Set(parsed.rows.map(r=>r.warehouse))];const missingWarehouses=[...new Set((latest?.data.rows||[]).map(r=>r.warehouse))].filter(w=>!names.includes(w));
   const data={...parsed,filename:String(filename).slice(0,200),userId:ctx.userId,configRevision:state.configRevision,snapshotRevision:snap?.revision||0,diff:compareRows(snap?.data.rows||[],parsed.rows),missingWarehouses,noChange:snap?.data.contentHash===parsed.contentHash};
   const expiresAt=new Date(now.getTime()+15*60000);const id=(await db.query('INSERT INTO inventory_import_previews(tenant_id,expires_at,data) VALUES($1,$2,$3) RETURNING id',[ctx.tenantId,expiresAt,JSON.stringify(data)])).rows[0].id;
   return {previewId:id,expiresAt,date:data.date,counts:{rows:parsed.rows.length,warehouses:names.length,skus:new Set(parsed.rows.map(r=>r.jdSku)).size},snapshotRevision:data.snapshotRevision,missingWarehouses,noChange:data.noChange,diff:data.diff,warnings:parsed.warnings};
  });},
  async confirmImport(ctx,{previewId,expectedSnapshotRevision,confirmFullCoverage,confirmMissing=false,now=new Date()}){requireRole(ctx,['admin','operator','supply_chain']);return withTransaction(async db=>{
   const repo=createRepository(db),state=await repo.lock(ctx.tenantId);const stored=(await db.query('SELECT data,expires_at FROM inventory_import_previews WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[ctx.tenantId,previewId])).rows[0];if(!stored)throw new InventoryError('NOT_FOUND','未找到导入预览',404);const p=stored.data;
   if(p.result)return p.result;
   if(!confirmFullCoverage)throw new InventoryError('COVERAGE_CONFIRMATION_REQUIRED','请确认该文件包含目标日期的全部仓库',422);
   if(new Date(stored.expires_at)<=now)throw new InventoryError('PREVIEW_EXPIRED','预览已过期，请重新上传',409);
   const old=await repo.snapshot(ctx.tenantId,p.date);if(p.configRevision!==state.configRevision||p.snapshotRevision!==(old?.revision||0)||expectedSnapshotRevision!==p.snapshotRevision)throw new InventoryError('VERSION_CONFLICT','数据或配置已变化，请重新预览',409);
   if((p.diff.missing.length||p.missingWarehouses.length)&&!confirmMissing)throw new InventoryError('MISSING_CONFIRMATION','请确认缺失记录及仓库',422);
   if(p.noChange&&old){const result={snapshotId:old.id,calculationId:old.calculationId,revision:old.revision,noChange:true};await db.query('UPDATE inventory_import_previews SET data=$1 WHERE tenant_id=$2 AND id=$3',[JSON.stringify({...p,result}),ctx.tenantId,previewId]);return result;}
   for(const r of p.rows){await repo.put(ctx.tenantId,'warehouses',r.warehouse,{id:r.warehouse,name:r.warehouse,region:r.region});await repo.put(ctx.tenantId,'skus',r.jdSku,{id:r.jdSku,name:r.name||r.jdSku,merchantCode:r.merchantCode});}
   const revision=p.snapshotRevision+1,data={rows:p.rows,contentHash:p.contentHash,complete:true,importedAt:now.toISOString(),importedBy:ctx.userId};
   const snap=(await db.query('INSERT INTO inventory_snapshots(tenant_id,date,revision,data) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,date) DO UPDATE SET revision=EXCLUDED.revision,data=EXCLUDED.data RETURNING id',[ctx.tenantId,p.date,revision,JSON.stringify(data)])).rows[0];
   await db.query('DELETE FROM inventory_snapshot_rows WHERE tenant_id=$1 AND snapshot_id=$2',[ctx.tenantId,snap.id]);
   await db.query("INSERT INTO inventory_snapshot_rows(tenant_id,snapshot_id,warehouse,sku,data) SELECT $1,$2,r->>'warehouse',r->>'jdSku',r FROM jsonb_array_elements($3::jsonb) r",[ctx.tenantId,snap.id,JSON.stringify(p.rows)]);
   const config=await repo.config(ctx.tenantId),input={...data,...config,date:p.date,snapshotRevision:revision,createdAt:now.toISOString()};const calc=await repo.saveCalculation(ctx.tenantId,{...input,...calculateInventory(input)});
   await db.query('UPDATE inventory_snapshots SET calculation_id=$1 WHERE tenant_id=$2 AND id=$3',[calc.id,ctx.tenantId,snap.id]);await db.query('UPDATE inventory_state SET latest_date=GREATEST(latest_date,$2::date) WHERE tenant_id=$1',[ctx.tenantId,p.date]);
   const result={snapshotId:snap.id,calculationId:calc.id,revision};await db.query('UPDATE inventory_import_previews SET data=$1 WHERE tenant_id=$2 AND id=$3',[JSON.stringify({...p,result}),ctx.tenantId,previewId]);
   await db.query('INSERT INTO inventory_import_logs(tenant_id,data) VALUES($1,$2)',[ctx.tenantId,JSON.stringify({type:'snapshot.imported',date:p.date,filename:p.filename,contentHash:p.contentHash,userId:ctx.userId,diff:p.diff,...result})]);return result;
  });}
 };
}
module.exports={createSnapshotService,compareRows};
