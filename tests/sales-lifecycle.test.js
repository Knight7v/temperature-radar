const {test}=require('node:test');
const assert=require('node:assert/strict');
const Life=require('../js/sales-lifecycle');
const {includeMissingShops,buildYearlyBreakdown}=require('../lib/sales/report');

const shop=(data)=>({id:'s1',data:{name:'测试店',...data}});

test('开店/闭店日期当天都算营业，区间外不计经营天数',()=>{
 const s=shop({openDate:'2026-03-01',closeDate:'2026-03-10'});
 assert.equal(Life.isOpenOn(s,'2026-02-28'),false);
 assert.equal(Life.isOpenOn(s,'2026-03-01'),true);
 assert.equal(Life.isOpenOn(s,'2026-03-10'),true);
 assert.equal(Life.isOpenOn(s,'2026-03-11'),false);
 assert.equal(Life.activeDays(s,'2026-01-01','2026-12-31'),10);
 assert.equal(Life.activeDays(s,'2026-03-05','2026-03-20'),6);
 assert.equal(Life.activeDays(s,'2026-01-01','2026-02-28'),0);
 // 只填一侧
 assert.equal(Life.activeDays(shop({openDate:'2026-10-01'}),'2026-09-01','2026-10-05'),5);
 assert.equal(Life.activeDays(shop({}),'2026-09-01','2026-09-30'),30);
});

test('整段区间状态：未开店 / 已闭店 / 空（经营期内）',()=>{
 const s=shop({openDate:'2026-03-01',closeDate:'2026-05-31'});
 assert.equal(Life.rangeState(s,'2026-01-01','2026-01-31'),'未开店');
 assert.equal(Life.rangeState(s,'2026-02-20','2026-03-02'),'');
 assert.equal(Life.rangeState(s,'2026-05-01','2026-05-31'),'');
 assert.equal(Life.rangeState(s,'2026-06-01','2026-06-30'),'已闭店');
 assert.equal(Life.rangeState(shop({}),'2026-06-01','2026-06-30'),'');
});

test('日期优先于手填状态；没填日期时沿用店铺状态',()=>{
 const closedByDate=shop({status:'运营中',closeDate:'2026-07-31'});
 assert.equal(Life.effectiveStatus(closedByDate,'2026-08-01'),'已闭店');
 assert.equal(Life.effectiveStatus(closedByDate,'2026-07-31'),'运营中');
 const manual=shop({status:'已闭店'});
 assert.equal(Life.effectiveStatus(manual,'2026-10-01'),'已闭店');
 assert.equal(Life.effectiveStatus(shop({status:'运营中',openDate:'2026-12-01'}),'2026-10-01'),'未开业');
});

test('目标 / 排行口径：闭店日期优先，闭店前周期仍参与',()=>{
 const s=shop({status:'运营中',openDate:'2026-01-01',closeDate:'2026-07-31'});
 assert.equal(Life.operatingInRange(s,'2026-07-01','2026-07-31'),true);
 assert.equal(Life.operatingInRange(s,'2026-08-01','2026-08-31'),false);
 assert.equal(Life.operatingInPeriod(s,'2026-07'),true);
 assert.equal(Life.operatingInPeriod(s,'2026-08'),false);
 assert.equal(Life.operatingInPeriod(shop({status:'已闭店'}),'2026-07'),false);
 assert.equal(Life.operatingInPeriod(shop({openDate:'2026-10-01'}),'2026-09'),false);
 assert.equal(Life.operatingInPeriod(shop({openDate:'2026-10-01'}),'2026'),true);
});

test('周期解析支持年 / 月 / 季度 / 单日 / 区间标签',()=>{
 assert.deepEqual(Life.periodRange('2026'),{start:'2026-01-01',end:'2026-12-31'});
 assert.deepEqual(Life.periodRange('2026-02'),{start:'2026-02-01',end:'2026-02-28'});
 assert.deepEqual(Life.periodRange('2026-Q2'),{start:'2026-04-01',end:'2026-06-30'});
 assert.deepEqual(Life.periodRange('2026-10-18'),{start:'2026-10-18',end:'2026-10-18'});
 assert.deepEqual(Life.periodRange('2026-01-01 ～ 2026-10-18'),{start:'2026-01-01',end:'2026-10-18'});
 assert.equal(Life.periodRange('区间合计'),null);
 assert.equal(Life.validDate('2026-02-30'),false);
 assert.equal(Life.validDate('2026-02-28'),true);
});

test('缺失行区分未开店 / 已闭店 / 真的缺数据',()=>{
 const shops=[shop({openDate:'2026-10-01'}),{id:'s2',data:{name:'闭店店',closeDate:'2026-07-31'}},{id:'s3',data:{name:'缺数店'}}];
 const rows=includeMissingShops([],shops,[],'2026-09-01','2026-09-30','month');
 assert.equal(rows.find(r=>r.shopId==='s1').state,'未开店');
 assert.equal(rows.find(r=>r.shopId==='s2').state,'已闭店');
 assert.equal(rows.find(r=>r.shopId==='s3').state,'');
 assert.equal(rows.find(r=>r.shopId==='s3').cents,null);
});

test('年视图月度明细按月标注经营状态',()=>{
 const shops=[shop({openDate:'2026-03-01'})];
 const rows=buildYearlyBreakdown(shops,[{shop_id:'s1',date:'2026-03-01',cents:'100'}],'2026');
 assert.equal(rows[0].months[0].state,'未开店');
 assert.equal(rows[0].months[1].state,'未开店');
 assert.equal(rows[0].months[2].cents,100);
 assert.equal(rows[0].months[2].state,'');
 assert.equal(rows[0].yearCents,100);
});
