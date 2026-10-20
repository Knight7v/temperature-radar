const {period}=require('./core');
const {targetInfo}=require('./targets');
const Life=require('../../js/sales-lifecycle');
// coverage: Map<shopId,{from,to}> —— 该店铺已有销售数据的最早/最晚日期。
// 口径（2026-10-20 用户拍板）：周期完整落在 coverage 窗口内、又没有销售记录的，说明「导入过但当天没卖出」，记 0；
// 窗口外才是真正的「未导入」。经营期外（未开店 / 已闭店）永远优先，不补 0。
function zeroIfCovered(shop,start,end,coverage){
 if(!(coverage instanceof Map)||!start||!end)return false;
 if(Life.rangeState(shop,start,end))return false;
 const cover=coverage.get(shop.id);
 if(!cover||!cover.from||!cover.to)return false;
 return start>=cover.from&&end<=cover.to;
}
// Add one explicit no-data row for each selected shop absent from this interval.
// state 区分「未开店 / 已闭店」与真正的缺数据（空串）。
function includeMissingShops(rows,shops,targets,start,end,grain,coverage){
 const present=new Set(rows.map(r=>r.shopId));
 const label=grain==='total'?'区间合计':period(start,grain)===period(end,grain)?period(start,grain):start+' ～ '+end;
 return [...rows,...shops.filter(s=>!present.has(s.id)).map(s=>{
  const saved=targets.find(t=>t.shop_id===s.id&&t.period===label),{target,rate,incremental}=targetInfo(null,saved?.cents);
  const zero=zeroIfCovered(s,start,end,coverage);
  return {shopId:s.id,shop:s.data.name,period:label,cents:zero?0:null,days:0,target,rate,incremental,visitors:null,views:null,conversionRate:null,avgOrderCents:null,state:Life.rangeState(s,start,end),zero};
 })];
}

function buildYearlyBreakdown(shops,dailyRows,year,coverage){
 const totals=new Map();
 for(const row of dailyRows){
  if(!row.date.startsWith(year+'-'))continue;
  const month=Number(row.date.slice(5,7)),key=row.shop_id+'|'+month;
  const value=totals.get(key)||{cents:0,days:0};
  value.cents+=Number(row.cents);value.days++;totals.set(key,value);
 }
 return shops.map(shop=>{
  const months=Array.from({length:12},(_,index)=>{
   const month=index+1,value=totals.get(shop.id+'|'+month);
   const range={start:year+'-'+String(month).padStart(2,'0')+'-01',end:new Date(Date.UTC(Number(year),month,0)).toISOString().slice(0,10)};
   const zero=!value&&zeroIfCovered(shop,range.start,range.end,coverage);
   return {month,cents:value?value.cents:zero?0:null,days:value?.days||0,state:Life.rangeState(shop,range.start,range.end),zero};
  });
  const observed=months.filter(month=>month.days>0||month.zero);
  return {shopId:shop.id,shop:shop.data.name,year,state:Life.rangeState(shop,year+'-01-01',year+'-12-31'),yearCents:observed.length?observed.reduce((sum,month)=>sum+month.cents,0):null,yearDays:observed.reduce((sum,month)=>sum+month.days,0),months};
 });
}
function attachSalesTrends(rows,dailyRows,start,end){
 if(start===end)return rows;
 const byShop=new Map();
 for(const row of dailyRows){
  if(!byShop.has(row.shop_id))byShop.set(row.shop_id,new Map());
  byShop.get(row.shop_id).set(row.date,Number(row.cents));
 }
 const dates=[];const cursor=new Date(start+'T00:00:00Z'),last=new Date(end+'T00:00:00Z');
 for(;cursor<=last;cursor.setUTCDate(cursor.getUTCDate()+1))dates.push(cursor.toISOString().slice(0,10));
 const attached=new Set();
 for(const row of rows){
  if(attached.has(row.shopId))continue;
  const values=byShop.get(row.shopId);
  row.trend=dates.map(date=>({date,cents:values?.has(date)?values.get(date):null}));
  attached.add(row.shopId);
 }
 return rows;
}
module.exports={includeMissingShops,attachSalesTrends,buildYearlyBreakdown,zeroIfCovered};
