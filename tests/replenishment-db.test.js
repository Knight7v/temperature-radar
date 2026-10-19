const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {inventoryDbTest}=require('./helpers/inventory-db');
const {getInventoryPool}=require('../lib/db/inventory-client');

inventoryDbTest('replenishment uses exact inventory warehouses, separates roles and deduplicates WeCom delivery',async f=>{
 process.env.DATABASE_URL=process.env.INVENTORY_TEST_DATABASE_URL;
 process.env.INVENTORY_WEBHOOK_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');
 const service=require('../lib/inventory/replenishment-service');
 const originalFetch=global.fetch,messages=[];
 global.fetch=async(url,options)=>{assert.match(url,/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send/);messages.push(JSON.parse(options.body));return {ok:true,json:async()=>({errcode:0,errmsg:'ok'})};};
 try{
  const date='2026-10-15',sku='SKU-1',warehouse='京东北京一仓';
  const supplyUser=randomUUID();
  await f.pool.query("INSERT INTO users(id,tenant_id,identifier,password_hash,role) VALUES($1,$2,$3,$4,'supply_chain')",[supplyUser,f.ctxA.tenantId,'supply-test','not-real']);
  const calc=await f.repository.saveCalculation(f.ctxA.tenantId,{results:[{kind:'sku',warehouse,entityId:sku,name:'格力空调',stock:26,unit:'件',sales:{1:8,7:42,15:79,30:126}}]});
  await f.pool.query('INSERT INTO inventory_snapshots(tenant_id,date,revision,calculation_id,data) VALUES($1,$2,1,$3,$4)',[f.ctxA.tenantId,date,calc.id,JSON.stringify({})]);
  await f.pool.query('INSERT INTO inventory_state(tenant_id,latest_date) VALUES($1,$2)',[f.ctxA.tenantId,date]);
  const initial=await service.report(f.ctxA,{date,sku});
  assert.deepEqual(initial.rows.map(r=>r.warehouse),[warehouse]);
  const operator={...f.ctxA,role:'operator'};
  const supply={...f.ctxA,role:'supply_chain'};
  await assert.rejects(service.savePlan(supply,{date,sku,warehouse,stage:'operator',expectedRevision:0,demand:'备货',batch1:80,batch2:0}),e=>e.status===403);
  const first=await service.savePlan(operator,{date,sku,warehouse,stage:'operator',expectedRevision:0,demand:'核心仓备货',batch1:80,batch2:0});
  assert.equal(first.delivery,'pending');
  const configured=await service.configureWebhook(f.ctxA,'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test');
  assert.equal(configured.queuedDelivered,1);
  assert.equal(messages.length,1);
  const unchanged=await service.savePlan(operator,{date,sku,warehouse,stage:'operator',expectedRevision:1,demand:'核心仓备货',batch1:80,batch2:0});
  assert.equal(unchanged.delivery,'unchanged');
  const next=await service.savePlan(supply,{date,sku,warehouse,stage:'supply',expectedRevision:1,recommendation:40});
  assert.equal(next.delivery,'sent');assert.equal(messages.length,2);
  const daily=await service.runDaily(date);assert.equal(daily.sent,1);assert.equal(messages.length,3);
  await service.runDaily(date);assert.equal(messages.length,3);
  const after=await service.report(f.ctxA,{date,sku});assert.equal(after.rows[0].quantity,80);assert.equal(after.rows[0].recommendation,40);
 }finally{global.fetch=originalFetch;await getInventoryPool().end();}
});
