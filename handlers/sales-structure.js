'use strict';
const {apiHandler}=require('../lib/http');
const {requireInventoryUser}=require('../lib/inventory/access');
const {getInventoryPool,transact}=require('../lib/db/inventory-client');
const {ensureSalesStructureSchema}=require('../lib/sales/structure-schema');
const {CATEGORIES,parseStructureUpload,buildStructureReport,filterStructureShops,resolveSettlementShops,combineStructureRows}=require('../lib/sales/structure');
const Life=require('../js/sales-lifecycle');
function fail(message,status=422){throw Object.assign(Error(message),{status});}
const operatesInYear=(shop,year)=>Life.operatingInRange(shop,`${year}-01-01`,`${year}-12-31`);
function today(){return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});}
function categoryOf(req){const category=String(req.query.category||'gree-ac');if(!CATEGORIES[category])fail('销售结构类别无效');return category;}
async function matchingShops(pool,tenant,category){const result=await pool.query("SELECT id,data FROM sales_shops WHERE tenant_id=$1 AND data->>'brand'=$2 ORDER BY data->>'name'",[tenant,CATEGORIES[category].brand]);return result.rows;}
module.exports=apiHandler(async(req,res)=>{
 const write=req.method!=='GET',user=await requireInventoryUser(req,write?['admin','operator']:['admin','operator','viewer']);
 const pool=getInventoryPool();await ensureSalesStructureSchema();
 const tenant=user.tenantId,category=categoryOf(req),action=req.query.action||'report';
 if(req.method==='GET'){
  if(action==='template'){
   res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="sales-structure-template.csv"');
   return res.end('\uFEFF日期,店铺ID,SKU,销量件数,机型档位,是否柜机\n');
  }
  const asOf=today(),year=Number(req.query.year||asOf.slice(0,4));
  if(!Number.isInteger(year)||year<2020||year>Number(asOf.slice(0,4)))fail('统计年份无效');
  // 只在统计年份内经营过的店铺才出现在下拉与报表里（未开店 / 已闭店按经营期判断）。
  const allShops=(await matchingShops(pool,tenant,category)).filter(shop=>operatesInYear(shop,year));
  if(action==='meta')return res.json({data:{category,label:CATEGORIES[category].label,role:user.role,shops:allShops}});
  if(action!=='report')fail('操作不存在',404);
  const shops=filterStructureShops(allShops,category,req.query.platform);
  const shop=String(req.query.shop||'');if(shop&&!shops.some(item=>item.id===shop))fail('店铺不属于当前类别');
  const start=`${year}-01-01`,end=asOf<`${year}-12-31`?asOf:`${year}-12-31`;
  const params=[tenant,category,start,end,shop||null,shops.map(item=>item.id)];
  const manual=await pool.query(`SELECT d.date::text AS date,d.shop_id AS "shopId",d.sku,m.tier,m.is_cabinet AS cabinet,d.units::text AS units
   FROM sales_structure_daily d LEFT JOIN sales_structure_models m
   ON m.tenant_id=d.tenant_id AND m.category=d.category AND m.sku=d.sku
   WHERE d.tenant_id=$1 AND d.category=$2 AND d.date BETWEEN $3 AND $4
   AND ($5::uuid IS NULL OR d.shop_id=$5) AND d.shop_id=ANY($6::uuid[])`,params);
  const settlement=category==='gree-ac'?await pool.query(`SELECT d.date::text AS date,d.shop_id AS "shopId",d.sku,m.tier,m.is_cabinet AS cabinet,d.units::text AS units
   FROM sales_structure_settlement_items d LEFT JOIN sales_structure_models m
   ON m.tenant_id=d.tenant_id AND m.category=d.category AND m.sku=d.sku
   WHERE d.tenant_id=$1 AND d.category=$2 AND d.date BETWEEN $3 AND $4
   AND ($5::uuid IS NULL OR d.shop_id=$5) AND d.shop_id=ANY($6::uuid[])`,params):{rows:[]};
  const report=buildStructureReport(combineStructureRows(manual.rows,settlement.rows),year,asOf,shop?1:shops.length);
  const imported=(await pool.query('SELECT MAX(imported_at) AS last_import FROM sales_structure_imports WHERE tenant_id=$1 AND category=$2',[tenant,category])).rows[0]?.last_import||null;
  return res.json({data:{...report,category,label:CATEGORIES[category].label,year,asOf,lastImport:imported,shopCount:shop?1:shops.length}});
 }
 if(req.method!=='POST')fail('不支持此请求',405);
 if(action==='preview'){
  let filename;try{filename=decodeURIComponent(String(req.headers['x-sales-structure-filename']||''));}catch{fail('文件名编码无效');}
  if(!filename||filename.length>200)fail('文件名无效');
  const parsed=await parseStructureUpload(req.body,filename,category),rows=parsed.rows,shops=await matchingShops(pool,tenant,category);
  if(parsed.kind==='settlement'){
   const aliases=(await pool.query('SELECT platform,source_name,shop_id FROM sales_structure_shop_aliases WHERE tenant_id=$1 AND category=$2',[tenant,category])).rows;
   const sourceShops=resolveSettlementShops(parsed.sourceShops,shops,aliases);
   const from=rows.reduce((value,row)=>row.date<value?row.date:value,rows[0].date),to=rows.reduce((value,row)=>row.date>value?row.date:value,rows[0].date);
   const data={category,kind:'settlement',filename,batchKey:parsed.batchKey,platform:parsed.platform,rows,sourceShops:parsed.sourceShops,from,to,shopCount:sourceShops.length,ignoredNegative:parsed.ignoredNegative,ignoredZero:parsed.ignoredZero,positiveUnits:rows.reduce((sum,row)=>sum+row.units,0)};
   const previous=(await pool.query('SELECT 1 FROM sales_structure_settlement_batches WHERE tenant_id=$1 AND category=$2 AND batch_key=$3 AND platform=$4',[tenant,category,parsed.batchKey,parsed.platform])).rowCount>0;
   const saved=await pool.query('INSERT INTO sales_structure_previews(tenant_id,data) VALUES($1,$2) RETURNING id',[tenant,data]);
   return res.json({data:{id:saved.rows[0].id,kind:'settlement',filename,batchKey:data.batchKey,platform:data.platform,rowCount:rows.length,shopCount:data.shopCount,positiveUnits:data.positiveUnits,ignoredNegative:data.ignoredNegative,ignoredZero:data.ignoredZero,replaceExisting:previous,from,to,sourceShops,unclassified:rows.filter(row=>!row.tier).length,examples:rows.slice(0,8).map(row=>({date:row.date,shopCode:row.sourceShopName,sku:row.sku,units:row.units,tier:row.tier,cabinet:row.cabinet}))}});
  }
  const byCode=new Map();for(const shop of shops){const code=String(shop.data.shopId||'').trim();if(code)byCode.set(code,[...(byCode.get(code)||[]),shop]);}
  for(const row of rows){const candidates=byCode.get(row.shopCode)||[];if(candidates.length!==1)fail(`店铺ID ${row.shopCode} 未找到唯一的${CATEGORIES[category].brand}店铺，请先完善店铺档案`);row.shopId=candidates[0].id;}
  const from=rows.reduce((value,row)=>row.date<value?row.date:value,rows[0].date),to=rows.reduce((value,row)=>row.date>value?row.date:value,rows[0].date);
  const data={category,kind:'manual',filename,rows,from,to,shopCount:new Set(rows.map(row=>row.shopId)).size,unclassified:rows.filter(row=>!row.tier).length};
  const saved=await pool.query('INSERT INTO sales_structure_previews(tenant_id,data) VALUES($1,$2) RETURNING id',[tenant,data]);
  return res.json({data:{id:saved.rows[0].id,filename,rowCount:rows.length,shopCount:data.shopCount,from,to,unclassified:data.unclassified,examples:rows.slice(0,8).map(({date,shopCode,sku,units,tier,cabinet})=>({date,shopCode,sku,units,tier,cabinet}))}});
 }
 if(action==='confirm'){
  const id=String(req.body?.id||'');if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))fail('预览编号无效');
  const outcome=await transact(pool,async client=>{
   const preview=(await client.query('SELECT * FROM sales_structure_previews WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
   if(!preview||preview.data.category!==category)fail('预览不存在',404);
   if(preview.data.done)return preview.data.done;
   if(Date.now()-new Date(preview.created_at).getTime()>30*60*1000)fail('预览已过期，请重新上传');
   const {rows,filename}=preview.data,models=new Map();
   for(const row of rows){const previous=models.get(row.sku)||{};models.set(row.sku,{tier:row.tier||previous.tier||null,cabinet:row.cabinet??previous.cabinet??null});}
   for(const [sku,model] of models)await client.query(`INSERT INTO sales_structure_models(tenant_id,category,sku,tier,is_cabinet) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(tenant_id,category,sku) DO UPDATE SET tier=COALESCE(EXCLUDED.tier,sales_structure_models.tier),is_cabinet=COALESCE(EXCLUDED.is_cabinet,sales_structure_models.is_cabinet)`,[tenant,category,sku,model.tier,model.cabinet]);
   if(preview.data.kind==='settlement'){
    const shops=await matchingShops(client,tenant,category);
    const aliases=(await client.query('SELECT platform,source_name,shop_id FROM sales_structure_shop_aliases WHERE tenant_id=$1 AND category=$2',[tenant,category])).rows;
    const mapped=resolveSettlementShops(preview.data.sourceShops,shops,aliases,req.body?.shopMap||{},true);
    const key=preview.data.batchKey,platform=preview.data.platform,old=(await client.query('SELECT imported_at FROM sales_structure_settlement_batches WHERE tenant_id=$1 AND category=$2 AND batch_key=$3 AND platform=$4 FOR UPDATE',[tenant,category,key,platform])).rows[0];
    if(old&&new Date(old.imported_at)>new Date(preview.created_at))fail('该结算月份数据已变化，请重新校验与预览');
    await client.query(`INSERT INTO sales_structure_settlement_batches(tenant_id,category,batch_key,platform,filename,row_count,positive_units,ignored_negative,ignored_zero)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(tenant_id,category,batch_key,platform) DO UPDATE SET filename=EXCLUDED.filename,row_count=EXCLUDED.row_count,positive_units=EXCLUDED.positive_units,
     ignored_negative=EXCLUDED.ignored_negative,ignored_zero=EXCLUDED.ignored_zero,imported_at=now()`,[tenant,category,key,platform,filename,rows.length,preview.data.positiveUnits,preview.data.ignoredNegative,preview.data.ignoredZero]);
    await client.query('DELETE FROM sales_structure_settlement_items WHERE tenant_id=$1 AND category=$2 AND batch_key=$3 AND platform=$4',[tenant,category,key,platform]);
    const shopMap=new Map(mapped.map(item=>[item.platform+'|'+item.name,item.shopId]));
    const items=rows.map(row=>({source_row:row.sourceRow,shop_id:shopMap.get(row.platform+'|'+row.sourceShopName),date:row.date,sku:row.sku,units:row.units}));
    await client.query(`INSERT INTO sales_structure_settlement_items(tenant_id,category,batch_key,platform,source_row,shop_id,date,sku,units)
     SELECT $1,$2,$3,$4,x.source_row,x.shop_id,x.date,x.sku,x.units
     FROM jsonb_to_recordset($5::jsonb) AS x(source_row integer,shop_id uuid,date date,sku text,units bigint)`,[tenant,category,key,platform,JSON.stringify(items)]);
    for(const item of mapped)await client.query(`INSERT INTO sales_structure_shop_aliases(tenant_id,category,platform,source_name,shop_id) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(tenant_id,category,platform,source_name) DO UPDATE SET shop_id=EXCLUDED.shop_id`,[tenant,category,item.platform,item.name,item.shopId]);
   }else{
    for(const row of rows)await client.query(`INSERT INTO sales_structure_daily(tenant_id,category,shop_id,date,sku,units) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(tenant_id,category,shop_id,date,sku) DO UPDATE SET units=EXCLUDED.units`,[tenant,category,row.shopId,row.date,row.sku,row.units]);
   }
   await client.query('INSERT INTO sales_structure_imports(tenant_id,category,filename,row_count) VALUES($1,$2,$3,$4)',[tenant,category,filename,rows.length]);
   const done={rowCount:rows.length,shopCount:preview.data.shopCount,from:preview.data.from,to:preview.data.to,kind:preview.data.kind,batchKey:preview.data.batchKey||null,platform:preview.data.platform||null,positiveUnits:preview.data.positiveUnits||null};
   await client.query('UPDATE sales_structure_previews SET data=$1 WHERE tenant_id=$2 AND id=$3',[{...preview.data,done},tenant,id]);
   return done;
  });return res.json({data:outcome});
 }
 fail('操作不存在',404);
});
