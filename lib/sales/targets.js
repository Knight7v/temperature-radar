function targetInfo(salesCents,targetCents){
 const target=targetCents==null?null:Number(targetCents);
 return {target,rate:target!=null&&target>0&&salesCents!=null?Number(salesCents)/target:null,incremental:target===0};
}
function targetCents(value){
 const text=String(value).replace(/,/g,'');
 if(!/^\d+(\.\d{1,2})?$/.test(text))throw Object.assign(Error('目标必须为非负金额，最多两位小数'),{status:422});
 const [whole,fraction='']=text.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents))throw Object.assign(Error('目标金额超出范围'),{status:422});
 return cents;
}
// 年度目标唯一来源：12 个月度目标之和。
// 入参为已换算成「分」的 12 个值（null / '' 表示该月未设置）。
// 全部为空 -> null（年度目标未设置）；部分填写 -> 已填月份的合计。
function annualFromMonths(months){
 const filled=(Array.isArray(months)?months:[]).filter(v=>v!=null&&v!=='');
 if(!filled.length)return null;
 return filled.reduce((sum,v)=>sum+Number(v),0);
}
module.exports={targetInfo,targetCents,annualFromMonths};
