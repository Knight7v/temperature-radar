const test=require('node:test');
const assert=require('node:assert');
const {includeMissingShops,buildYearlyBreakdown,zeroIfCovered}=require('../lib/sales/report');

const shop=(id,extra={})=>({id,data:{name:'店-'+id,...extra}});

test('zeroIfCovered 只在经营期内、且周期被数据窗口完整覆盖时为真',()=>{
 const coverage=new Map([['s1',{from:'2026-01-01',to:'2026-09-30'}]]);
 const s=shop('s1',{openDate:'2025-01-16'});
 assert.equal(zeroIfCovered(s,'2026-02-01','2026-02-28',coverage),true);
 assert.equal(zeroIfCovered(s,'2026-10-01','2026-10-31',coverage),false,'超出数据窗口');
 assert.equal(zeroIfCovered(s,'2025-12-01','2025-12-31',coverage),false,'早于数据窗口');
 assert.equal(zeroIfCovered(s,'2026-01-01','2026-12-31',coverage),false,'部分超出数据窗口');
 assert.equal(zeroIfCovered(shop('s2'),'2026-02-01','2026-02-28',coverage),false,'没有该店数据窗口');
 assert.equal(zeroIfCovered(s,'2026-02-01','2026-02-28',null),false,'无 coverage');
});

test('zeroIfCovered 不覆盖经营期外（未开店 / 已闭店）',()=>{
 const coverage=new Map([['s1',{from:'2026-01-01',to:'2026-12-31'}]]);
 const future=shop('s1',{openDate:'2026-05-01'});
 assert.equal(zeroIfCovered(future,'2026-02-01','2026-02-28',coverage),false,'未开店期间不补 0');
 const closed=shop('s1',{closeDate:'2026-03-31'});
 assert.equal(zeroIfCovered(closed,'2026-06-01','2026-06-30',coverage),false,'已闭店期间不补 0');
});

test('buildYearlyBreakdown 把数据窗口内的空月记 0，窗口外仍是未导入',()=>{
 const s=shop('s1',{openDate:'2025-01-16'});
 const coverage=new Map([['s1',{from:'2026-01-01',to:'2026-09-30'}]]);
 const daily=[{shop_id:'s1',date:'2026-03-05',cents:'1234500'}];
 const [row]=buildYearlyBreakdown([s],daily,'2026',coverage);
 const january=row.months[0],march=row.months[2],october=row.months[9];
 assert.equal(january.cents,0);
 assert.equal(january.zero,true);
 assert.equal(march.cents,1234500);
 assert.equal(october.cents,null);
 assert.equal(october.zero,false);
 assert.equal(row.yearCents,1234500);
});

test('buildYearlyBreakdown 全年零订单时年累计为 0 而不是 null',()=>{
 const s=shop('s1',{openDate:'2026-01-01'});
 const coverage=new Map([['s1',{from:'2026-01-01',to:'2026-01-31'}]]);
 const [row]=buildYearlyBreakdown([s],[],'2026',coverage);
 assert.equal(row.months[0].cents,0);
 assert.equal(row.months[1].cents,null);
 assert.equal(row.yearCents,0);
});

test('buildYearlyBreakdown 无 coverage 时保持原口径（空月为 null）',()=>{
 const s=shop('s1',{openDate:'2025-01-16'});
 const [row]=buildYearlyBreakdown([s],[],'2026');
 assert.equal(row.months[0].cents,null);
 assert.equal(row.yearCents,null);
});

test('includeMissingShops 整店无数据但在数据窗口内时记 0',()=>{
 const s=shop('s1',{openDate:'2025-01-16'});
 const coverage=new Map([['s1',{from:'2026-01-01',to:'2026-09-30'}]]);
 const [row]=includeMissingShops([],[s],[],'2026-02-01','2026-02-28','month',coverage);
 assert.equal(row.cents,0);
 assert.equal(row.zero,true);
 assert.equal(row.state,'');
});

test('includeMissingShops 窗口外仍标记未导入（cents 为 null）',()=>{
 const s=shop('s1',{openDate:'2025-01-16'});
 const coverage=new Map([['s1',{from:'2026-01-01',to:'2026-09-30'}]]);
 const [row]=includeMissingShops([],[s],[],'2026-11-01','2026-11-30','month',coverage);
 assert.equal(row.cents,null);
 assert.equal(row.zero,false);
});

test('includeMissingShops 已闭店店铺不补 0',()=>{
 const s=shop('s1',{closeDate:'2026-05-31'});
 const coverage=new Map([['s1',{from:'2026-01-01',to:'2026-12-31'}]]);
 const [row]=includeMissingShops([],[s],[],'2026-08-01','2026-08-31','month',coverage);
 assert.equal(row.cents,null);
 assert.equal(row.state,'已闭店');
});
