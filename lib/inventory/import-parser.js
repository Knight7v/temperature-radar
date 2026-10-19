const ExcelJS=require('exceljs'),Papa=require('papaparse'),{createHash}=require('node:crypto');
const {InventoryError}=require('./errors'),{guardXlsx}=require('./xlsx-guard'),{validateRows}=require('./import-validation'),{businessDate}=require('./dates');
const headers=['日期','仓库名称','京东SKU','商家商品编码','商家商品标识','商品名称','省市','在库件数','在库件数-良品','在库件数-残品','可用在库件数','销售出库件数','近7天销售出库件数','近15天销售出库件数','近30天销售出库件数','商品MTD周转','30天周转'];
const required=headers.filter(h=>!['商家商品编码','商家商品标识','商品名称','省市','商品MTD周转','30天周转'].includes(h));
const text=v=>v==null?'':String(v).trim();const number=v=>v==null||text(v)===''?null:Number(v);
function dateValue(v){if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='number')return new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10);return text(v).replaceAll('.','-').replaceAll('/','-');}
// 京东云仓「库存查询」导出表：纯库存快照(无销售/周转数据)。特征列:仓库名称/商家商品编码/总库存/可用库存。
const JD_STOCK_KEY=['仓库名称','商家商品编码','总库存','可用库存'];
const JD_MAPPED=new Set(['仓库名称','商家商品编码','事业部商品名称','商家商品标识','总库存','可用库存','库存状态']);
function isJdStock(labels){return JD_STOCK_KEY.every(h=>labels.includes(h));}
function parseJdStock(labels,matrix,now){
 const absent=JD_STOCK_KEY.filter(h=>!labels.includes(h));const duplicates=labels.filter((h,i)=>h&&labels.indexOf(h)!==i);
 if(duplicates.length||absent.length)throw new InventoryError('HEADERS','表头重复或缺少必填列',422,[...duplicates.map(field=>({field,message:'重复列'})),...absent.map(field=>({field,message:'缺少必填列'}))]);
 const today=businessDate(now);
 const rows=matrix.filter(r=>r.some(v=>v!=null&&text(v)!=='')).map(values=>{
  const source=Object.fromEntries(labels.map((h,i)=>[h,values[i]??null]));
  const status=text(source['库存状态']);const stock=number(source['总库存']);const merchantCode=text(source['商家商品编码']);
  return {date:today,warehouse:text(source['仓库名称']),jdSku:merchantCode,merchantCode,merchantLabel:text(source['商家商品标识']),name:text(source['事业部商品名称']),region:'',stock,good:status==='残品'?0:stock,bad:status==='残品'?stock:0,available:number(source['可用库存']),sales:null,sourceTurnover:null,extra:Object.fromEntries(Object.entries(source).filter(([h])=>h&&!JD_MAPPED.has(h)).sort(([a],[b])=>a.localeCompare(b)))};
 });
 // 同一仓+SKU 若存在良品/残品多行，合并为一行(stock=良品+残品)
 const merged=new Map();
 for(const r of rows){const key=JSON.stringify([r.warehouse,r.jdSku]);const prev=merged.get(key);
  if(!prev){merged.set(key,{...r});continue;}
  prev.stock=(prev.stock||0)+(r.stock||0);prev.good=(prev.good||0)+(r.good||0);prev.bad=(prev.bad||0)+(r.bad||0);prev.available=(prev.available||0)+(r.available||0);}
 const out=[...merged.values()].sort((a,b)=>JSON.stringify([a.warehouse,a.jdSku]).localeCompare(JSON.stringify([b.warehouse,b.jdSku])));
 return {rows:out,date:today};
}
async function parseInventoryFile({buffer,filename,now=new Date()}){
 if(!Buffer.isBuffer(buffer)||buffer.length>3*1024*1024)throw new InventoryError('FILE_LIMIT','文件最大3 MiB',413);
 let matrix;
 if(/\.csv$/i.test(filename)){
  let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new InventoryError('ENCODING','请保存为UTF-8编码CSV',422);}
  const parsed=Papa.parse(source.replace(/^\uFEFF/,''),{skipEmptyLines:'greedy'});if(parsed.errors.length)throw new InventoryError('CSV_INVALID','CSV格式错误',422,parsed.errors);matrix=parsed.data;
 }else if(/\.xlsx$/i.test(filename)){
  await guardXlsx(buffer);const w=new ExcelJS.Workbook();try{await w.xlsx.load(buffer);}catch{throw new InventoryError('INVALID_XLSX','无法读取Excel文件',422);}
  const sheets=w.worksheets.filter(s=>s.actualRowCount>0);if(sheets.length!==1)throw new InventoryError('SHEET_COUNT','仅支持一个非空工作表',422);
  const s=sheets[0];if(s.rowCount>10001)throw new InventoryError('ROW_LIMIT','最多10000条明细',422);matrix=[];
  s.eachRow(row=>{const values=[];for(let i=1;i<=s.columnCount;i++){const c=row.getCell(i);let v=c.value;
   if(v&&typeof v==='object'&&!(v instanceof Date)){if(v.formula||v.sharedFormula||v.error)throw new InventoryError('FORMULA','请把公式或错误单元格转为原始值后导出',422,[{row:row.number,field:c.address}]);v=v.richText?v.richText.map(x=>x.text).join(''):v.text??null;}
   const heading=s.getRow(1).getCell(i).text.trim();if(['京东SKU','商家商品编码'].includes(heading)&&typeof v==='number'){if(!Number.isSafeInteger(v))throw new InventoryError('IDENTIFIER_PRECISION','商品编码精度已丢失，请按文本导出',422);v=/^0+$/.test(c.numFmt)?String(v).padStart(c.numFmt.length,'0'):String(v);}
   values.push(v);
  }matrix.push(values);});
 }else throw new InventoryError('FILE_TYPE','请上传 .xlsx 或 UTF-8 .csv',422);
 const labels=(matrix.shift()||[]).map(text);
 if(isJdStock(labels)){const {rows,date}=parseJdStock(labels,matrix,now);const checked=validateRows(rows,{today:businessDate(now)});if(checked.errors.length)throw new InventoryError('VALIDATION','报表未通过校验，请修正后重新导入',422,checked.errors);return {date,rows,warnings:[],contentHash:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}
 const duplicates=labels.filter((h,i)=>h&&labels.indexOf(h)!==i);
 const absent=required.filter(h=>!labels.includes(h));if(duplicates.length||absent.length)throw new InventoryError('HEADERS','表头重复或缺少必填列',422,[...duplicates.map(field=>({field,message:'重复列'})),...absent.map(field=>({field,message:'缺少必填列'}))]);
 const rows=matrix.filter(r=>r.some(v=>v!=null&&text(v)!=='')).map(values=>{const source=Object.fromEntries(labels.map((h,i)=>[h,values[i]??null]));return {date:dateValue(source['日期']),warehouse:text(source['仓库名称']),jdSku:text(source['京东SKU']),merchantCode:text(source['商家商品编码']),merchantLabel:text(source['商家商品标识']),name:text(source['商品名称']),region:text(source['省市']),stock:number(source['在库件数']),good:number(source['在库件数-良品']),bad:number(source['在库件数-残品']),available:number(source['可用在库件数']),sales:{1:number(source['销售出库件数']),7:number(source['近7天销售出库件数']),15:number(source['近15天销售出库件数']),30:number(source['近30天销售出库件数'])},sourceTurnover:{mtd:number(source['商品MTD周转']),days30:number(source['30天周转'])},extra:Object.fromEntries(Object.entries(source).filter(([h])=>h&&!headers.includes(h)).sort(([a],[b])=>a.localeCompare(b)))};});
 const checked=validateRows(rows,{today:businessDate(now)});if(checked.errors.length)throw new InventoryError('VALIDATION','报表未通过校验，请修正后重新导入',422,checked.errors);
 rows.sort((a,b)=>JSON.stringify([a.warehouse,a.jdSku]).localeCompare(JSON.stringify([b.warehouse,b.jdSku])));
 return {date:rows[0].date,rows,warnings:[],contentHash:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
}
module.exports={parseInventoryFile,headers};
