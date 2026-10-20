const test=require('node:test');
const assert=require('node:assert/strict');
const {annualFromMonths,targetCents,targetInfo}=require('../lib/sales/targets');

test('年度目标 = 12 个月度目标之和',()=>{
 const months=Array.from({length:12},()=>100*100*10000); // 每月 100 万元（分）
 assert.equal(annualFromMonths(months),12*100*100*10000);
});

test('全部月度为空时年度目标为 null（未设置），而不是 0',()=>{
 assert.equal(annualFromMonths(Array.from({length:12},()=>null)),null);
 assert.equal(annualFromMonths(Array.from({length:12},()=>'')),null);
 assert.equal(annualFromMonths([]),null);
 assert.equal(annualFromMonths(undefined),null);
});

test('只填部分月份时按已填月份合计（不把空月当 0 之外的其它含义）',()=>{
 assert.equal(annualFromMonths([100,200,null,'',null,null,null,null,null,null,null,null]),300);
 assert.equal(annualFromMonths([null,null,null,null,null,null,null,null,null,null,null,42]),42);
});

test('0 是有效目标值（增量业务），不能被当成未设置',()=>{
 assert.equal(annualFromMonths(Array.from({length:12},()=>0)),0);
 assert.equal(annualFromMonths([0,null,null,null,null,null,null,null,null,null,null,null]),0);
});

test('月度合计与年度目标口径一致：分单位逐个相加无精度损失',()=>{
 // 800+300+800+1200+1500+2000+1800+1000+700+700+700+700 = 12200 万元
 const months=[800,300,800,1200,1500,2000,1800,1000,700,700,700,700].map(wan=>wan*1e6);
 const annual=annualFromMonths(months);
 assert.equal(annual,12200*1e6);
 assert.equal(annual/1e6,12200); // 万元
});

test('targetCents 仍然按元解析、输出分（回归）',()=>{
 assert.equal(targetCents('8000000'),800000000);
 assert.throws(()=>targetCents('-1'),/非负金额/);
 assert.throws(()=>targetCents('1.234'),/两位小数/);
});

test('targetInfo 达成率与增量业务判定（回归）',()=>{
 assert.deepEqual(targetInfo(500000,1000000),{target:1000000,rate:.5,incremental:false});
 assert.equal(targetInfo(500000,null).rate,null);
 assert.equal(targetInfo(500000,0).incremental,true);
});
