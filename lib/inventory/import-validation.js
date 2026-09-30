const {validDate}=require('./dates');
function validateRows(rows,{today}){
 const errors=[],keys=new Set(),dates=new Set();const issue=(i,field,code,message)=>errors.push({row:i+2,field,code,message});
 rows.forEach((r,i)=>{
  for(const f of ['warehouse','jdSku'])if(!r[f])issue(i,f,'REQUIRED','必填字段不能为空');
  if(!validDate(r.date)||r.date>today)issue(i,'date','INVALID_DATE','日期无效或晚于今天');dates.add(r.date);
  for(const f of ['stock','good','bad','available'])if(r[f]==null)issue(i,f,'REQUIRED','数量不能为空');else if(!Number.isSafeInteger(r[f])||r[f]<0)issue(i,f,'INVALID_QUANTITY','数量必须是非负安全整数');
  for(const n of [1,7,15,30])if(r.sales?.[n]==null||!Number.isSafeInteger(r.sales[n])||r.sales[n]<0)issue(i,'sales'+n,'INVALID_QUANTITY','出库量必须是非负整数，不能为空');
  if(r.stock!==r.good+r.bad)issue(i,'stock','STOCK_MISMATCH','良品加残品必须等于在库件数');
  if(r.available>r.good)issue(i,'available','STOCK_MISMATCH','可用库存不能大于良品库存');
  if(r.sales[7]>r.sales[15]||r.sales[15]>r.sales[30])issue(i,'sales','SALES_MISMATCH','近7/15/30天累计出库量不一致');
  const k=JSON.stringify([r.date,r.warehouse,r.jdSku]);if(keys.has(k))issue(i,'jdSku','DUPLICATE','同日同仓同SKU重复');keys.add(k);
 });
 if(dates.size!==1)errors.push({row:1,field:'date',code:'MIXED_DATES',message:'每次必须导入一个日期的全仓快照'});
 if(!rows.length||rows.length>10000)errors.push({row:1,field:'file',code:'ROW_LIMIT',message:'文件须包含1至10000条数据'});
 return {rows,errors};
}
module.exports={validateRows};
