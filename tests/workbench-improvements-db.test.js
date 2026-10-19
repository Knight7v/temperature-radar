const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
test('销售匹配入库、闭店筛选、真实导入时间及库存处理权限', {skip:!process.env.SALES_TEST_DATABASE_URL},async()=>{
 process.env.DATABASE_URL=process.env.SALES_TEST_DATABASE_URL;
 process.env.JWT_SECRET='isolated-integration-test-secret';
 const {getInventoryPool}=require('../lib/db/inventory-client'),pool=getInventoryPool();
 const {signAccessToken}=require('../lib/auth');
 const sales=require('../handlers/sales'),followups=require('../handlers/inventory/followups'),users=require('../handlers/auth/users');
 const tenant=randomUUID(),uid=randomUUID(),shop=randomUUID(),calc=randomUUID();
 let token;
 async function call(handler,method,query={},body={},headers={}){const res={statusCode:200,status(c){this.statusCode=c;return this},json(b){this.body=b;return this}};await handler({method,query,body,headers:{authorization:'Bearer '+token,...headers}},res);return res;}
 try{
  await pool.query('INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3)',[tenant,'自动验证',tenant]);
  await pool.query('INSERT INTO users(id,tenant_id,identifier,password_hash,role) VALUES($1,$2,$3,$4,$5)',[uid,tenant,'verification','unused','admin']);
  token=await signAccessToken({id:uid,tenantId:tenant,role:'admin'});
  await pool.query('INSERT INTO sales_shops(tenant_id,id,data) VALUES($1,$2,$3)',[tenant,shop,{name:'独立验证店铺',shopId:'10186122',status:'已闭店'}]);
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('日报');sheet.addRow(['时间','成交金额','店铺访客数']);sheet.addRow(['2026-04-01','123.45',10]);const buffer=Buffer.from(await book.xlsx.writeBuffer());
  let r=await call(sales,'POST',{action:'preview'},buffer,{'x-sales-filename':encodeURIComponent('99999999_交易概况.xlsx')});assert.equal(r.statusCode,422);
  r=await call(sales,'POST',{action:'preview'},buffer,{'x-sales-filename':encodeURIComponent('10186122_交易概况.xlsx')});assert.equal(r.statusCode,200,JSON.stringify(r.body));assert.equal(r.body.data.shopId,shop);const preview=r.body.data.id;
  r=await call(sales,'POST',{action:'confirm'},{id:preview});assert.equal(r.statusCode,200,JSON.stringify(r.body));assert.equal(r.body.data.added,1);
  r=await call(sales,'GET',{action:'overview',start:'2026-04-01',end:'2026-04-01',grain:'total'});assert.equal(r.body.data.total,0);
  r=await call(sales,'GET',{action:'overview',start:'2026-04-01',end:'2026-04-01',grain:'total',status:'all'});assert.equal(r.body.data.total,12345);assert.ok(r.body.data.lastImport);assert.equal(r.body.data.rows[0].visitors,10);
  await pool.query('INSERT INTO inventory_calculations(id,tenant_id,data) VALUES($1,$2,$3)',[calc,tenant,{results:[{warehouse:'仓库',kind:'sku',entityId:'sku-1'}]}]);
  await pool.query('INSERT INTO inventory_snapshots(tenant_id,date,revision,calculation_id,data) VALUES($1,$2,1,$3,$4)',[tenant,'2026-04-01',calc,{}]);
  const follow={date:'2026-04-01',warehouse:'仓库',kind:'sku',entityId:'sku-1',status:'已处理',note:''};
  r=await call(followups,'POST',{},follow);assert.equal(r.statusCode,422);
  r=await call(followups,'POST',{},{...follow,note:'已补货'});assert.equal(r.statusCode,200,JSON.stringify(r.body));
  r=await call(followups,'GET',{date:follow.date});assert.equal(r.body.data[0].note,'已补货');
  await pool.query("UPDATE users SET role='viewer' WHERE id=$1",[uid]);
  r=await call(followups,'POST',{},{...follow,note:'不应保存'});assert.equal(r.statusCode,403);
  r=await call(users,'GET');assert.equal(r.statusCode,403);
  await pool.query("UPDATE users SET status='disabled' WHERE id=$1",[uid]);
  r=await call(sales,'GET',{action:'shops'});assert.equal(r.statusCode,403);
 }finally{
  for(const table of ['sales_daily','sales_targets','sales_previews','sales_imports','sales_shops'])await pool.query('DELETE FROM '+table+' WHERE tenant_id=$1',[tenant]);
  await pool.query('DELETE FROM inventory_snapshots WHERE tenant_id=$1',[tenant]);
  await pool.query('DELETE FROM users WHERE tenant_id=$1',[tenant]);
  await pool.query('DELETE FROM tenants WHERE id=$1',[tenant]);
  await pool.end();
 }
});
