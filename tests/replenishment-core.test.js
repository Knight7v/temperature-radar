const test=require('node:test');
const assert=require('node:assert/strict');
const {turnover, classifyTurnover, buildReplenishmentRows, planStage}=require('../lib/inventory/replenishment-core');

test('turnover uses stock divided by period outflow times period days',()=>{
 assert.equal(turnover(26,42,7),4.3);
 assert.equal(turnover(26,79,15),4.9);
 assert.equal(turnover(26,126,30),6.2);
 assert.equal(turnover(26,0,7),null);
});

test('thresholds are strict and absent outflow is not called safe',()=>{
 assert.equal(classifyTurnover(14.9),'replenish');
 assert.equal(classifyTurnover(15),'normal');
 assert.equal(classifyTurnover(45),'normal');
 assert.equal(classifyTurnover(45.1),'slow');
 assert.equal(classifyTurnover(null),'unknown');
});

test('alerts compare unrounded turnover even when display rounds to a boundary',()=>{
 const low=buildReplenishmentRows([{kind:'sku',warehouse:'低周转仓',entityId:'A',stock:1499,sales:{7:700,15:1500,30:3000}}]);
 const high=buildReplenishmentRows([{kind:'sku',warehouse:'高周转仓',entityId:'B',stock:4501,sales:{7:700,15:1500,30:3000}}]);
 assert.equal(low[0].currentTurnover[7],15);
 assert.ok(low[0].alerts.some(a=>a.period===7&&a.type==='replenish'));
 assert.equal(high[0].currentTurnover[7],45);
 assert.ok(high[0].alerts.some(a=>a.period===7&&a.type==='slow'));
});

test('rows preserve exact warehouse names from inventory results and calculate both current and post-batch turnover',()=>{
 const rows=buildReplenishmentRows([{kind:'sku',warehouse:'京东北京一仓',entityId:'SKU-1',name:'空调',stock:26,sales:{7:42,15:79,30:126}}],new Map([['京东北京一仓',{demand:'核心仓备货',batch1:80,batch2:150,recommendation:40}]]));
 assert.equal(rows[0].warehouse,'京东北京一仓');
 assert.equal(rows[0].quantity,230);
 assert.deepEqual(rows[0].currentTurnover,{7:4.3,15:4.9,30:6.2});
 assert.deepEqual(rows[0].postBatch1Turnover,{7:17.7,15:20.1,30:25.2});
 assert.deepEqual(rows[0].alerts,[{period:7,type:'replenish'},{period:15,type:'replenish'},{period:30,type:'replenish'}]);
});

test('operator and supply-chain completion require their own fields',()=>{
 assert.equal(planStage({demand:'备货',batch1:80,batch2:0,recommendation:null}).operatorReady,true);
 assert.equal(planStage({demand:'备货',batch1:80,batch2:null,recommendation:null}).operatorReady,false);
 assert.equal(planStage({demand:'备货',batch1:80,batch2:0,recommendation:40}).supplyReady,true);
});
