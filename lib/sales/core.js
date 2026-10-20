const ExcelJS=require('exceljs');
function fail(message){throw Object.assign(Error(message),{status:422});}
function date(s){s=String(s);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)fail('日期格式应为 YYYY-MM-DD');return s;}
function cents(v){const s=String(v).replace(/,/g,'');if(!/^\d+(\.\d{1,2})?$/.test(s))fail('成交金额必须为非负金额，最多两位小数');const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n))fail('金额超出范围');return n;}
function count(v,label){if(v==null||String(v).trim()===''||String(v).trim()==='-')return null;const n=Number(String(v).replace(/,/g,''));if(!Number.isSafeInteger(n)||n<0)fail(label+'必须为非负整数');return n;}
function rate(v){if(v==null||String(v).trim()===''||String(v).trim()==='-')return null;let n=typeof v==='string'&&v.includes('%')?Number(v.replace('%',''))/100:Number(v);if(Number.isFinite(n)&&n>1)n/=100;if(!Number.isFinite(n)||n<0||n>1)fail('店铺成交转化率格式无效');return n;}
function period(d,grain){if(grain==='day')return d;if(grain==='year')return d.slice(0,4);if(grain==='quarter')return d.slice(0,4)+'-Q'+Math.ceil(Number(d.slice(5,7))/3);if(grain==='week'){const x=new Date(d+'T00:00:00Z'),day=x.getUTCDate(),offset=(x.getUTCDay()+6)%7,last=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).getUTCDate();return d.slice(0,8)+String(Math.max(1,day-offset)).padStart(2,'0')+'～'+d.slice(0,8)+String(Math.min(last,day-offset+6)).padStart(2,'0');}return d.slice(0,7);}

const TEMPLATE_DAILY='jd-daily';
const TEMPLATE_ORDER='order-detail';
const MAX_BYTES=32*1024*1024;
const MAX_ROWS=50000;
const text=v=>v==null?'':String(v).trim();

function dayOf(cell,row){
 if(cell){
  const printed=text(cell.text);
  const m=printed.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  const v=cell.value;
  if(v instanceof Date){const y=v.getFullYear(),mo=v.getMonth()+1,d=v.getDate();if(y>2000)return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
  const raw=text(v);
  if(raw)return date(raw.slice(0,10).replaceAll('/','-').replaceAll('.','-'));
 }
 fail('第'+row+'行下单时间无效');
}

function parseDaily(s,idx){
 const di=idx['时间'],ai=idx['成交金额'];if(!di||!ai)fail('缺少“时间”或“成交金额”表头');
 if(s.rowCount>MAX_ROWS+1)fail('最多'+MAX_ROWS+'行');
 const rows=[],seen=new Set();
 for(let i=2;i<=s.rowCount;i++){
  const row=s.getRow(i);let d=row.getCell(di).value,v=row.getCell(ai).value;
  if(d==null&&v==null)continue;
  if(d instanceof Date)d=d.toISOString().slice(0,10);
  d=date(d);
  if(seen.has(d))fail('文件中日期重复：'+d);
  seen.add(d);
  const cell=name=>idx[name]?row.getCell(idx[name]).value:null;
  rows.push({date:d,cents:cents(String(v).trim()==='-'?0:v),visitors:count(cell('店铺访客数'),'店铺访客数'),views:count(cell('店铺浏览量'),'店铺浏览量'),conversionRate:rate(cell('店铺成交转化率')),customers:count(cell('成交客户数'),'成交客户数'),avgOrderCents:cell('客单价')==null||String(cell('客单价')).trim()===''||String(cell('客单价')).trim()==='-'?null:cents(cell('客单价'))});
 }
 if(!rows.length)fail('没有有效数据');
 return {template:TEMPLATE_DAILY,shopName:null,rows:rows.sort((a,b)=>a.date.localeCompare(b.date)),stats:null};
}

// 喵速达（天猫）订单明细导出：一单两行（外机行 + 内机行），金额为订单级重复。
// 口径（2026-10-19 用户拍板）：只认「已签收」，其余状态（已出库/仓库已接单/待下发/关闭/退款等）全部剔除。
// 另剔除“规格=外机”行；按下单时间按天汇总；金额取“订单金额”列。
const SIGNED='已签收';
function parseOrderDetail(s,idx){
 if(s.rowCount>MAX_ROWS+1)fail('最多'+MAX_ROWS+'行');
 const at=(row,name)=>idx[name]?row.getCell(idx[name]):null;
 const byDate=new Map(),keptOrders=new Set(),skippedOrders=new Set(),closedOrders=new Set(),outerOrders=new Set(),statusCounts=new Map();
 let shopName=null,rowsKept=0,rowsSkipped=0,rowsClosed=0,rowsOuter=0;
 for(let i=2;i<=s.rowCount;i++){
  const row=s.getRow(i);
  const statusCell=at(row,'订单状态'),orderCell=at(row,'交易订单号'),specCell=at(row,'规格'),whenCell=at(row,'下单时间'),amountCell=at(row,'订单金额');
  const status=text(statusCell?.value),orderNo=text(orderCell?.value),spec=text(specCell?.value);
  if(!status&&!orderNo&&!spec&&!whenCell?.value&&!amountCell?.value)continue;
  if(!shopName)shopName=text(at(row,'店铺名称')?.value)||null;
  statusCounts.set(status, (statusCounts.get(status)||0)+1);
  if(!status.includes(SIGNED)){
   rowsSkipped++;
   if(status.includes('关闭')){rowsClosed++;if(orderNo)closedOrders.add(orderNo);}
   if(orderNo)skippedOrders.add(orderNo);
   continue;
  }
  if(spec.includes('外机')&&!spec.includes('内机')){rowsOuter++;if(orderNo)outerOrders.add(orderNo);continue;}
  if(!orderNo)fail('第'+i+'行缺少交易订单号');
  let value;try{value=cents(amountCell?.value);}catch{return fail('第'+i+'行订单金额无效');}
  const d=dayOf(whenCell,i);
  const buyer=text(at(row,'买家昵称')?.value),qty=Number(text(at(row,'商品数量')?.value)||0);
  if(!byDate.has(d))byDate.set(d,{cents:0,orders:new Set(),buyers:new Set(),quantity:0});
  const agg=byDate.get(d);agg.cents+=value;agg.orders.add(orderNo);if(buyer)agg.buyers.add(buyer);if(Number.isFinite(qty))agg.quantity+=qty;
  keptOrders.add(orderNo);rowsKept++;
 }
 if(!byDate.size)fail('没有已签收的有效订单');
 const rows=[...byDate.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([d,agg])=>{
  const customers=agg.buyers.size||agg.orders.size;
  return {date:d,cents:agg.cents,visitors:null,views:null,conversionRate:null,customers,avgOrderCents:customers?Math.round(agg.cents/customers):null,orders:agg.orders.size,quantity:agg.quantity};
 });
 const byStatus=Object.fromEntries([...statusCounts.entries()].sort((a,b)=>b[1]-a[1]));
 return {template:TEMPLATE_ORDER,shopName,rows,stats:{rowsKept,rowsSkipped,rowsClosed,rowsOuter,orders:keptOrders.size,skippedOrders:skippedOrders.size,closedOrders:closedOrders.size,orphanOuter:[...outerOrders].filter(o=>!keptOrders.has(o)&&!skippedOrders.has(o)).length,byStatus,quantity:rows.reduce((n,r)=>n+r.quantity,0)}};
}

async function parseFile(buffer){
 if(!Buffer.isBuffer(buffer)||!buffer.length)fail('请上传表格文件');
 if(buffer.length>MAX_BYTES)fail('文件不能超过32MB');
 const w=new ExcelJS.Workbook();await w.xlsx.load(buffer);
 const sheets=w.worksheets.filter(s=>s.actualRowCount);
 if(sheets.length!==1)fail('请上传只有一个数据工作表的文件');
 const s=sheets[0],headers=s.getRow(1).values,idx={};
 headers.forEach((h,i)=>{if(h!=null)idx[text(h)]=i;});
 const has=n=>Boolean(idx[n]);
 if(has('订单状态')&&has('订单金额')&&has('规格')&&has('交易订单号'))return parseOrderDetail(s,idx);
 if(has('时间')&&has('成交金额'))return parseDaily(s,idx);
 fail('未识别的表格模板：请上传京东日报（时间/成交金额）或喵速达订单明细（订单状态/订单金额/规格/交易订单号）');
}

// 兼容原调用：只返回按天汇总行
async function parse(buffer){return (await parseFile(buffer)).rows;}

module.exports={parse,parseFile,period,date,cents,TEMPLATE_DAILY,TEMPLATE_ORDER};
