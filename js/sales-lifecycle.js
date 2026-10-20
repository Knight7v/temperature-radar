(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.SalesLifecycle=api;
})(globalThis,function(){
 const DATE=/^\d{4}-\d{2}-\d{2}$/;
 const DAY=86400000;
 function validDate(value){
  if(!DATE.test(value))return false;
  const t=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===value;
 }
 function normalizeDate(value){
  const text=String(value==null?'':value).trim();
  return validDate(text)?text:'';
 }
 function today(){
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
 }
 // 店铺经营期：开店日期当天算营业，闭店日期当天算营业，次日起算已闭店。留空表示不限制。
 function window(shop){
  const data=(shop&&shop.data)||{};
  return {open:normalizeDate(data.openDate),close:normalizeDate(data.closeDate)};
 }
 function isOpenOn(shop,date){
  const {open,close}=window(shop);
  if(open&&date<open)return false;
  if(close&&date>close)return false;
  return true;
 }
 function activeDays(shop,start,end){
  if(!start||!end||start>end)return 0;
  const {open,close}=window(shop);
  const from=open&&open>start?open:start;
  const to=close&&close<end?close:end;
  if(from>to)return 0;
  return Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/DAY)+1;
 }
 // 整段区间的状态：整段都在开店前 → 未开店；整段都在闭店后 → 已闭店；否则返回空串（视为正常经营期）。
 function rangeState(shop,start,end){
  const {open,close}=window(shop);
  if(open&&end<open)return '未开店';
  if(close&&start>close)return '已闭店';
  return '';
 }
 function periodRange(period){
  const text=String(period==null?'':period).trim();
  let m=/^(\d{4})$/.exec(text);
  if(m)return {start:m[1]+'-01-01',end:m[1]+'-12-31'};
  m=/^(\d{4})-(\d{2})$/.exec(text);
  if(m){const y=Number(m[1]),mo=Number(m[2]);if(mo<1||mo>12)return null;return {start:text+'-01',end:new Date(Date.UTC(y,mo,0)).toISOString().slice(0,10)};}
  m=/^(\d{4})-Q([1-4])$/i.exec(text);
  if(m){const y=Number(m[1]),q=Number(m[2]),s=(q-1)*3+1;const start=y+'-'+String(s).padStart(2,'0')+'-01',end=new Date(Date.UTC(y,s+2,0)).toISOString().slice(0,10);return {start,end};}
  m=/^(\d{4}-\d{2}-\d{2})\s*[～~]\s*(\d{4}-\d{2}-\d{2})$/.exec(text);
  if(m)return {start:m[1],end:m[2]};
  if(validDate(text))return {start:text,end:text};
  return null;
 }
 // 该店铺在区间内是否属于「在营」（目标考核、排行口径）：闭店日期优先于手填状态。
 function operatingInRange(shop,start,end){
  if(!start||!end)return true;
  const {open,close}=window(shop);
  if(close)return !(close<start)&&!(open&&open>end);
  if(String((shop&&shop.data&&shop.data.status)||'')==='已闭店')return false;
  return !(open&&open>end);
 }
 function operatingInPeriod(shop,period){
  const range=periodRange(period);
  if(!range)return true;
  return operatingInRange(shop,range.start,range.end);
 }
 // 生效状态：填了日期就以日期为准，没填日期沿用店铺状态。
 function effectiveStatus(shop,day){
  const {open,close}=window(shop);
  const at=day||today();
  if(open&&at<open)return '未开业';
  if(close&&at>close)return '已闭店';
  return String((shop&&shop.data&&shop.data.status)||'');
 }
 function toDate(value){
  return value instanceof Date?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(value):String(value||'');
 }
 return {validDate,normalizeDate,today,window,isOpenOn,activeDays,rangeState,periodRange,operatingInRange,operatingInPeriod,effectiveStatus,toDate};
});
