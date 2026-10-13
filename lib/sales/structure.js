'use strict';
const ExcelJS=require('exceljs');
const Papa=require('papaparse');

const CATEGORIES={
 'gree-ac':{label:'格力空调',brand:'格力'},
 'haier-ac':{label:'海尔空调',brand:'海尔'},
 'haier-fridge':{label:'海尔冰箱',brand:'海尔'}
};
const TIERS=['引流机','普通机','中端机','高端机'];
function fail(message){throw Object.assign(Error(message),{status:422});}
function filterStructureShops(shops,category,platform){
 if(category!=='gree-ac')return shops;
 const selected=platform||'京东';
 if(!['京东','天猫'].includes(selected))fail('平台筛选无效');
 return shops.filter(shop=>String(shop.data?.platform||'').trim()===selected);
}
function resolveSettlementShops(sourceShops,shops,aliases=[],overrides={},strict=false){
 const saved=new Map(aliases.map(alias=>[alias.platform+'|'+alias.source_name,alias.shop_id]));
 return sourceShops.map(source=>{
  const key=source.platform+'|'+source.name;
  const eligible=shops.filter(shop=>shop.data?.brand==='格力'&&shop.data?.platform===source.platform);
  const exact=eligible.filter(shop=>shop.data.name===source.name);
  const savedShop=saved.get(key);
  const suggested=savedShop&&eligible.some(shop=>shop.id===savedShop)?savedShop:exact.length===1?exact[0].id:null;
  const chosen=Object.hasOwn(overrides,key)?overrides[key]:suggested;
  if(chosen&&!eligible.some(shop=>shop.id===chosen))fail(`“${source.name}”须映射到同平台的格力店铺`);
  if(strict&&!chosen)fail(`请为“${source.name}”选择店铺档案`);
  return {...source,shopId:chosen||null};
 });
}
function combineStructureRows(manual,settlement){
 const key=row=>[row.shopId,row.date,row.sku].join('|'),combined=new Map(),settlementKeys=new Set();
 for(const row of manual)combined.set(key(row),{...row,units:Number(row.units)});
 for(const row of settlement){const id=key(row);if(!settlementKeys.has(id)){combined.delete(id);combined.set(id,{...row,units:0});settlementKeys.add(id);}combined.get(id).units+=Number(row.units);}
 return [...combined.values()];
}
function validDate(value){
 if(value instanceof Date)value=value.toISOString().slice(0,10);
 else if(typeof value==='number'&&value>20000&&value<100000)value=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
 const s=String(value??'').trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)fail('日期必须为 YYYY-MM-DD');
 if(s<'2020-01-01')fail('商品销量日期不能早于 2020-01-01');
 if(s>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}))fail('商品销量日期不能晚于今天');
 return s;
}
function string(value){return String(value??'').trim();}
function parseRows(matrix,category){
 if(!CATEGORIES[category])fail('销售结构类别无效');
 if(matrix.length<2)fail('文件没有商品销量明细');
 if(matrix.length>10001)fail('最多导入 10000 行');
 const headers=matrix[0].map(string),index={};headers.forEach((header,i)=>{index[header]=i;});
 const find=(...names)=>names.map(name=>index[name]).find(value=>value!==undefined);
 const columns={date:find('日期','时间'),shop:find('店铺ID','店铺 Id','店铺id'),sku:find('SKU','商品SKU','型号'),units:find('销量件数','支付件数','销量'),tier:find('机型档位'),cabinet:find('是否柜机')};
 if(['date','shop','sku','units'].some(key=>columns[key]===undefined))fail('缺少“日期、店铺ID、SKU、销量件数”必需列');
 const rows=[],seen=new Set(),classifications=new Map();
 for(let i=1;i<matrix.length;i++){
  const cells=matrix[i]||[];if(cells.every(value=>string(value)===''))continue;
  const date=validDate(cells[columns.date]),shopCode=string(cells[columns.shop]),sku=string(cells[columns.sku]);
  if(!/^\d{4,20}$/.test(shopCode))fail(`第 ${i+1} 行店铺ID须为 4 至 20 位数字`);
  if(!sku||sku.length>100)fail(`第 ${i+1} 行 SKU 不能为空且不能超过 100 字`);
  const raw=string(cells[columns.units]).replace(/,/g,'');if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail(`第 ${i+1} 行销量件数必须为非负整数`);
  const tier=columns.tier===undefined?null:string(cells[columns.tier])||null;
  if(tier&&(!TIERS.includes(tier)||category!=='gree-ac'))fail(`第 ${i+1} 行机型档位无效`);
  const cabinetRaw=columns.cabinet===undefined?'':string(cells[columns.cabinet]);
  const cabinet=({是:true,否:false,'1':true,'0':false,true:true,false:false})[cabinetRaw];
  if(cabinetRaw&&cabinet===undefined)fail(`第 ${i+1} 行是否柜机只能填“是”或“否”`);
  if(category==='haier-fridge'&&cabinetRaw)fail(`第 ${i+1} 行冰箱不适用柜机分类`);
  const key=[shopCode,date,sku].join('|');if(seen.has(key))fail(`第 ${i+1} 行店铺、日期与 SKU 重复`);seen.add(key);
  const previous=classifications.get(sku);
  if(previous&&((tier&&previous.tier&&tier!==previous.tier)||(cabinet!==undefined&&previous.cabinet!==undefined&&cabinet!==previous.cabinet)))fail(`SKU ${sku} 的分类在文件中不一致`);
  classifications.set(sku,{tier:tier||previous?.tier||null,cabinet:cabinet===undefined?previous?.cabinet:cabinet});
  rows.push({date,shopCode,sku,units:Number(raw),tier,cabinet:cabinet===undefined?null:cabinet});
 }
 if(!rows.length)fail('文件没有商品销量明细');
 return rows;
}
async function parseStructureFile(buffer,filename,category){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>3*1024*1024)fail('文件不能为空且不能超过 3 MB');
 const ext=String(filename).toLowerCase().split('.').pop();let matrix;
 if(ext==='csv'){
  const content=buffer.toString('utf8').replace(/^\uFEFF/,'');
  if(content.includes('\uFFFD'))fail('CSV 文件须使用 UTF-8 编码');
  const parsed=Papa.parse(content,{skipEmptyLines:true});if(parsed.errors.length)fail('CSV 解析失败：'+parsed.errors[0].message);matrix=parsed.data;
 }else if(ext==='xlsx'){
  const workbook=new ExcelJS.Workbook();try{await workbook.xlsx.load(buffer);}catch{fail('XLSX 文件无法读取');}
  const sheets=workbook.worksheets.filter(sheet=>sheet.actualRowCount);if(sheets.length!==1)fail('XLSX 文件须只有一个数据工作表');
  matrix=[];sheets[0].eachRow({includeEmpty:true},row=>{matrix.push(row.values.slice(1).map(value=>value&&typeof value==='object'&&'text'in value?value.text:value));});
 }else fail('仅支持 CSV 或 XLSX 文件');
 return parseRows(matrix,category);
}
function settlementBatchKey(filename){
 const compact=String(filename).match(/(20\d{2})(0[1-9]|1[0-2])(?=\D|$)/);
 const chinese=String(filename).match(/(20\d{2})年\s*(1[0-2]|0?[1-9])月/);
 if(compact)return compact[1]+compact[2];
 if(chinese)return chinese[1]+chinese[2].padStart(2,'0');
 fail('结算表文件名须包含结算月份，如 202607 或 2026年7月');
}
function settlementOrderDate(value){
 if(value instanceof Date)return validDate(value);
 const match=string(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s|$)/);
 if(!match)fail('下单时间无法识别');
 return validDate(`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`);
}
function parseSettlementSheet(sheet,filename,category){
 if(category!=='gree-ac')fail('“可结算订单”结算表目前仅支持格力空调销售结构');
 if(sheet.actualRowCount>10001)fail('可结算订单最多导入 10000 行');
 const headers=sheet.getRow(1).values.slice(1).map(string),index=Object.fromEntries(headers.map((name,i)=>[name,i+1]));
 for(const name of ['下单时间','机型档次','挂柜机','物料代码','商品数量','平台','分销店铺'])if(!index[name])fail(`可结算订单缺少“${name}”列`);
 const rows=[],shops=new Map(),classifications=new Map();let ignoredNegative=0,ignoredZero=0;
 sheet.eachRow((row,rowNo)=>{
  if(rowNo===1)return;
  const value=name=>row.getCell(index[name]).value;
  const raw=Number(value('商品数量'));
  if(!Number.isSafeInteger(raw))fail(`可结算订单第 ${rowNo} 行商品数量必须为整数`);
  if(raw<0){ignoredNegative++;return;}
  if(raw===0){ignoredZero++;return;}
  const date=settlementOrderDate(value('下单时间')),tier=string(value('机型档次'))||null,format=string(value('挂柜机'));
  const sku=string(value('物料代码')),platform=string(value('平台')),sourceShopName=string(value('分销店铺'));
  if(!sku||sku.length>100)fail(`可结算订单第 ${rowNo} 行物料代码无效`);
  if(!['京东','天猫'].includes(platform))fail(`可结算订单第 ${rowNo} 行平台无效`);
  if(!sourceShopName)fail(`可结算订单第 ${rowNo} 行分销店铺为空`);
  if(tier&&!TIERS.includes(tier))fail(`可结算订单第 ${rowNo} 行机型档次无效`);
  if(format&&!['挂机','大挂','柜机'].includes(format))fail(`可结算订单第 ${rowNo} 行挂柜机无效`);
  const cabinet=format?['柜机','大挂'].includes(format):null,previous=classifications.get(sku);
  if(previous&&((tier&&previous.tier&&tier!==previous.tier)||(cabinet!==null&&previous.cabinet!==null&&cabinet!==previous.cabinet)))fail(`物料代码 ${sku} 的机型分类在文件中不一致`);
  classifications.set(sku,{tier:tier||previous?.tier||null,cabinet:cabinet??previous?.cabinet??null});
  const sourceKey=platform+'|'+sourceShopName,shop=shops.get(sourceKey)||{name:sourceShopName,platform,rows:0,units:0};
  shop.rows++;shop.units+=raw;shops.set(sourceKey,shop);
  rows.push({sourceRow:rowNo,date,sourceShopName,platform,sku,units:raw,tier,cabinet});
 });
 if(!rows.length)fail('可结算订单没有正数商品数量记录');
 const platforms=[...new Set([...shops.values()].map(shop=>shop.platform))];
 if(platforms.length!==1)fail('请分别上传京东与天猫结算表，避免同月批次互相覆盖');
 return {kind:'settlement',batchKey:settlementBatchKey(filename),platform:platforms[0],rows,sourceShops:[...shops.values()],ignoredNegative,ignoredZero};
}
async function parseStructureUpload(buffer,filename,category){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>3*1024*1024)fail('文件不能为空且不能超过 3 MB');
 if(!/\.xlsx$/i.test(filename))return {kind:'manual',rows:await parseStructureFile(buffer,filename,category)};
 const workbook=new ExcelJS.Workbook();try{await workbook.xlsx.load(buffer);}catch{fail('XLSX 文件无法读取');}
 const settlement=workbook.getWorksheet('可结算订单');
 return settlement?parseSettlementSheet(settlement,filename,category):{kind:'manual',rows:await parseStructureFile(buffer,filename,category)};
}
function period(year,kind,index,asOf){
 const start=kind==='annual'?`${year}-01-01`:kind==='quarter'?`${year}-${String(index*3-2).padStart(2,'0')}-01`:`${year}-${String(index).padStart(2,'0')}-01`;
 const month=kind==='annual'?12:kind==='quarter'?index*3:index;
 const end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
 return {key:kind==='annual'?String(year):kind==='quarter'?`Q${index}`:String(index).padStart(2,'0'),label:kind==='annual'?`${year} 年累计`:kind==='quarter'?`第 ${index} 季度`:`${index} 月`,start,end:start>asOf?end:(end>asOf?asOf:end),future:start>asOf};
}
function summarize(rows,range,shopCount){
 if(range.future)return {...range,state:'future',units:null};
 const matching=rows.filter(row=>row.date>=range.start&&row.date<=range.end),tiers=Object.fromEntries(TIERS.map(tier=>[tier,0]));
 const expectedShopDays=(Math.round((new Date(range.end)-new Date(range.start))/86400000)+1)*shopCount;
 if(!matching.length)return {...range,state:'missing',units:null,coveredShopDays:0,expectedShopDays};
 const coveredShopDays=new Set(matching.map(row=>row.date+'|'+(row.shopId||row.shopCode||''))).size;
 let units=0,classifiedUnits=0,cabinetUnits=0,cabinetKnownUnits=0;
 for(const row of matching){const count=Number(row.units);units+=count;if(TIERS.includes(row.tier)){tiers[row.tier]+=count;classifiedUnits+=count;}if(row.cabinet!==null&&row.cabinet!==undefined){cabinetKnownUnits+=count;if(row.cabinet===true)cabinetUnits+=count;}}
 return {...range,state:'ready',units,tiers,classifiedUnits,unknownUnits:units-classifiedUnits,cabinetUnits,cabinetKnownUnits,coveredShopDays,expectedShopDays,cabinetShare:units>0&&cabinetKnownUnits===units?cabinetUnits/units:null,classificationShare:units>0?classifiedUnits/units:null};
}
function buildStructureReport(rows,year,asOf=new Date().toISOString().slice(0,10),shopCount=1){
 year=Number(year);if(!Number.isInteger(year)||year<2020||year>Number(asOf.slice(0,4)))fail('统计年份无效');
 return {annual:summarize(rows,period(year,'annual',0,asOf),shopCount),quarters:[1,2,3,4].map(i=>summarize(rows,period(year,'quarter',i,asOf),shopCount)),months:Array.from({length:12},(_,i)=>summarize(rows,period(year,'month',i+1,asOf),shopCount))};
}
module.exports={CATEGORIES,TIERS,parseStructureFile,parseStructureUpload,buildStructureReport,filterStructureShops,resolveSettlementShops,combineStructureRows};
