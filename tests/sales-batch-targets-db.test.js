const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
test('七个月批量导入、幂等、重复日期拒绝、回滚、年度目标保存', {skip:!process.env.SALES_TEST_DATABASE_URL},async()=>{
 process.env.DATABASE_URL=process.env.SALES_TEST_DATABASE_URL;process.env.JWT_SECRET='isolated-integration-test-secret';
 const pool=require('../lib/db/inventory-client').getInventoryPool(),handler=require('../handlers/sales'),{signAccessToken}=require('../lib/auth');
 const tenant=randomUUID(),user=randomUUID(),shop=randomUUID(),shop2=randomUUID();let token;
 async function call(action,body={},query={}){const res={statusCode:200,status(c){this.statusCode=c;return this},json(b){this.body=b;return this}};await handler({method:'POST',query:{action,...query},body,headers:{authorization:'Bearer '+token}},res);return res;}
 async function preview(month,shopId=shop){const Excel=require('exceljs'),w=new Excel.Workbook(),s=w.addWorksheet('日报');s.addRow(['时间','成交金额']);s.addRow([`2026-${String(month).padStart(2,'0')}-01`,'100.00']);const r=await call('preview',Buffer.from(await w.xlsx.writeBuffer()),{shop:shopId});assert.equal(r.statusCode,200,JSON.stringify(r.body));return r.body.data.id;}
 try{
 await pool.query('INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3)',[tenant,'批量验证',tenant]);await pool.query('INSERT INTO users(id,tenant_id,identifier,password_hash,role) VALUES($1,$2,$3,$4,$5)',[user,tenant,'test','unused','admin']);token=await signAccessToken({id:user,tenantId:tenant,role:'admin'});
 for(const id of [shop,shop2])await pool.query('INSERT INTO sales_shops(tenant_id,id,data) VALUES($1,$2,$3)',[tenant,id,{name:id}]);
 const ids=[];for(let m=1;m<=7;m++)ids.push(await preview(m));
 let r=await call('confirm-batch',{ids});assert.equal(r.statusCode,200,JSON.stringify(r.body));assert.equal(r.body.data.added,7);assert.equal(r.body.data.start,'2026-01-01');assert.equal(r.body.data.end,'2026-07-01');
 r=await call('confirm-batch',{ids});assert.equal(r.statusCode,200);assert.equal(Number((await pool.query('SELECT count(*) FROM sales_imports WHERE tenant_id=$1',[tenant])).rows[0].count),7);
 const dupe=[await preview(8),await preview(8)];r=await call('confirm-batch',{ids:dupe});assert.equal(r.statusCode,422);
 const multi=[await preview(8),await preview(8,shop2)];r=await call('confirm-batch',{ids:multi});assert.equal(r.statusCode,200);
 const rollback=[await preview(9),await preview(10,shop2)];await pool.query('UPDATE sales_shops SET revision=revision+1 WHERE tenant_id=$1 AND id=$2',[tenant,shop2]);r=await call('confirm-batch',{ids:rollback});assert.equal(r.statusCode,409);assert.equal(Number((await pool.query("SELECT count(*) FROM sales_daily WHERE tenant_id=$1 AND date>='2026-09-01'",[tenant])).rows[0].count),0);
 r=await call('target-year',{shop,year:'2026',annual:'120000',months:Array(12).fill('10000')});assert.equal(r.statusCode,200,JSON.stringify(r.body));assert.equal(Number((await pool.query('SELECT count(*) FROM sales_targets WHERE tenant_id=$1',[tenant])).rows[0].count),13);
 r=await call('target-year',{shop,year:'2026',annual:'5',months:[...Array(11).fill('100'),'-1']});assert.equal(r.statusCode,422);assert.equal((await pool.query("SELECT cents::text FROM sales_targets WHERE tenant_id=$1 AND period='2026'",[tenant])).rows[0].cents,'12000000');
 }finally{for(const table of ['sales_daily','sales_targets','sales_previews','sales_imports','sales_shops','users','tenants'])await pool.query('DELETE FROM '+table+' WHERE '+(table==='tenants'?'id':'tenant_id')+'=$1',[tenant]);await pool.end();}
});
