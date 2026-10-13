const {period}=require('./core');
const {targetInfo}=require('./targets');
// Add one explicit no-data row for each selected shop absent from this interval.
function includeMissingShops(rows,shops,targets,start,end,grain){
 const present=new Set(rows.map(r=>r.shopId));
 const label=grain==='total'?'区间合计':period(start,grain)===period(end,grain)?period(start,grain):start+' ～ '+end;
 return [...rows,...shops.filter(s=>!present.has(s.id)).map(s=>{
  const saved=targets.find(t=>t.shop_id===s.id&&t.period===label),{target,rate,incremental}=targetInfo(null,saved?.cents);
  return {shopId:s.id,shop:s.data.name,period:label,cents:null,days:0,target,rate,incremental,visitors:null,views:null,conversionRate:null,avgOrderCents:null};
 })];
}

function buildYearlyBreakdown(shops,dailyRows,year){
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
   return {month,cents:value?value.cents:null,days:value?.days||0};
  });
  const observed=months.filter(month=>month.days>0);
  return {shopId:shop.id,shop:shop.data.name,year,yearCents:observed.length?observed.reduce((sum,month)=>sum+month.cents,0):null,yearDays:observed.reduce((sum,month)=>sum+month.days,0),months};
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
module.exports={includeMissingShops,attachSalesTrends,buildYearlyBreakdown};
