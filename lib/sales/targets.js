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
module.exports={targetInfo,targetCents};
