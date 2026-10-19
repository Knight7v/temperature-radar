const test=require('node:test');
const assert=require('node:assert/strict');
const {formatDailyAlert,formatPlanNotice,splitDailyAlerts}=require('../lib/inventory/replenishment-message');

test('daily alert identifies warehouse, SKU, period and exact threshold type',()=>{
 const text=formatDailyAlert({snapshotDate:'2026-10-15',rows:[{warehouse:'京东北京一仓',entityId:'SKU-1',name:'空调',currentTurnover:{7:14.9,15:45.1,30:20},alerts:[{period:7,type:'replenish'},{period:15,type:'slow'}]}]});
 assert.match(text,/京东北京一仓/);
 assert.match(text,/SKU-1/);
 assert.match(text,/7天.*14\.9.*补货预警/);
 assert.match(text,/15天.*45\.1.*滞销预警/);
});

test('plan notice contains only completed stage and escapes employee text',()=>{
 const text=formatPlanNotice('operator',{date:'2026-10-15',warehouse:'北京',entityId:'SKU-1',demand:'备货<@all>',batch1:80,batch2:0});
 assert.match(text,/运营已填写/);
 assert.match(text,/批次1.*80/);
 assert.doesNotMatch(text,/<@all>/);
});

test('large daily alert is split so every warehouse is delivered',()=>{
 const rows=Array.from({length:60},(_,i)=>({warehouse:'仓库'+i,entityId:'SKU-'+i,name:'空调'.repeat(30),currentTurnover:{7:1},alerts:[{period:7,type:'replenish'}]}));
 const parts=splitDailyAlerts(rows,'2026-10-15');
 assert.ok(parts.length>1);
 for(const part of parts)assert.ok(formatDailyAlert(part).length<=3900);
 const names=parts.flatMap(part=>part.rows.map(row=>row.warehouse));
 assert.deepEqual(names,rows.map(row=>row.warehouse));
});
