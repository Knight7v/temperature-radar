const {ruleFor}=require('./rules');
const FORMULA_VERSION='inventory-v1';
const BRANDS=['格力','美的','海尔','TCL','华凌','奥克斯','海信','容声','小天鹅','西门子','松下'];
function detectBrand(name){const n=String(name||'');for(const b of BRANDS)if(n.includes(b))return b;return null;}
function detectCategory(name){const n=String(name||'');if(/冰箱/.test(n))return '冰箱';if(/洗衣机/.test(n))return '洗衣机';if(/空调|外机|KFR-?\d/i.test(n))return '空调';return '其他';}
function buildFacts({rows,products,pairings}){
 const assigned=new Set();for(const p of products)if(p.type==='single')assigned.add(p.sku);for(const p of pairings)if(p.status==='confirmed'){assigned.add(p.innerSku);assigned.add(p.outerSku);}
 const skuBrand=new Map(),skuCategory=new Map();for(const r of rows){const nm=r.name||r.jdSku;skuBrand.set(r.jdSku,detectBrand(nm));skuCategory.set(r.jdSku,detectCategory(nm));}
 for(const p of pairings)if(p.status==='confirmed'){const b=skuBrand.get(p.innerSku)||skuBrand.get(p.outerSku),c=skuCategory.get(p.innerSku)||skuCategory.get(p.outerSku);if(b){if(!skuBrand.get(p.innerSku))skuBrand.set(p.innerSku,b);if(!skuBrand.get(p.outerSku))skuBrand.set(p.outerSku,b);}if(c){if(!skuCategory.get(p.innerSku))skuCategory.set(p.innerSku,c);if(!skuCategory.get(p.outerSku))skuCategory.set(p.outerSku,c);}}
 const facts=rows.map(r=>({key:JSON.stringify([r.warehouse,'sku',r.jdSku]),warehouse:r.warehouse,warehouseId:r.warehouse,entityId:r.jdSku,name:r.name||r.jdSku,kind:'sku',unit:'件',brand:skuBrand.get(r.jdSku)||null,category:skuCategory.get(r.jdSku)||null,available:r.available,stock:r.stock,good:r.good,bad:r.bad,sales:r.sales,turnover:r.sourceTurnover||null,sourceSkus:[r.jdSku],issues:assigned.has(r.jdSku)?[]:['PAIRING_PENDING']}));
 const byWarehouse=new Map();for(const r of rows){if(!byWarehouse.has(r.warehouse))byWarehouse.set(r.warehouse,new Map());byWarehouse.get(r.warehouse).set(r.jdSku,r);}
 for(const [warehouse,map] of byWarehouse)for(const p of products){
  const pair=pairings.find(v=>v.id===p.id&&v.status==='confirmed');const ids=p.type==='single'?[p.sku]:pair?[pair.innerSku,pair.outerSku]:[];
  if(!ids.length||!ids.some(id=>map.has(id)))continue;const components=ids.map(id=>map.get(id)),missing=components.some(v=>!v),sales={},issues=[];let unmatchedInner=0,unmatchedOuter=0;
  if(missing)issues.push('MISSING_COMPONENT');
  for(const n of [1,7,15,30])sales[n]=missing?null:Math.min(...components.map(r=>r.sales[n]));
  if(!missing&&components.length===2){unmatchedInner=Math.max(0,components[0].available-components[1].available);unmatchedOuter=Math.max(0,components[1].available-components[0].available);if(unmatchedInner||unmatchedOuter)issues.push('PAIR_MISMATCH');if([1,7,15,30].some(n=>components[0].sales[n]!==components[1].sales[n]))issues.push('OUTFLOW_MISMATCH');}
  facts.push({key:JSON.stringify([warehouse,'product',p.id]),warehouse,warehouseId:warehouse,entityId:p.id,name:p.name,kind:'product',unit:p.unit|| (p.type==='pair'?'套':'台'),brand:ids.map(id=>skuBrand.get(id)).find(Boolean)||null,category:ids.map(id=>skuCategory.get(id)).find(Boolean)||null,available:missing?null:Math.min(...components.map(r=>r.available)),stock:missing?null:Math.min(...components.map(r=>r.stock??r.available)),good:missing?null:Math.min(...components.map(r=>r.good??r.available)),bad:missing?null:Math.min(...components.map(r=>r.bad??0)),sales,turnover:null,sourceSkus:ids,components,unmatchedInner,unmatchedOuter,issues});
 }return facts;
}
function calculateFact(fact,rule){
 const r=rule.values,issues=[...fact.issues],businessAlerts=[];const s=fact.sales?.[r.period];const dailySales=s==null?null:s/r.period,daysCover=dailySales>0&&fact.available!=null?fact.available/dailySales:null;
 if(r.leadDays==null||r.safetyDays==null||r.maxDays==null)issues.push('RULES_PENDING');
 if(fact.sales==null){issues.push('NO_SALES_DATA');if(fact.available===0)businessAlerts.push('LOW_STOCK');}
 if(s===0)issues.push('NO_SALES_PERIOD');if(fact.available===0)issues.push('ZERO_AVAILABLE');
 if(daysCover!=null&&r.leadDays!=null&&r.safetyDays!=null&&daysCover<r.leadDays+r.safetyDays)businessAlerts.push('LOW_STOCK');
 if(fact.available>0&&fact.sales?.[30]===0)businessAlerts.push('NO_SALES_30');
 if(daysCover!=null&&r.maxDays!=null&&daysCover>r.maxDays)businessAlerts.push('OVERSTOCK');
 return {...fact,rule:r,ruleSources:rule.sources,dailySales,daysCover,businessAlerts,issues:[...new Set(issues)]};
}
function summarize(rows){const availableByUnit={},alerts={},issues={};for(const r of rows){if(r.available!=null)availableByUnit[r.unit]=(availableByUnit[r.unit]||0)+r.available;for(const a of r.businessAlerts)alerts[a]=(alerts[a]||0)+1;for(const a of r.issues)issues[a]=(issues[a]||0)+1;}return {count:rows.length,availableByUnit,alerts,issues,riskCount:rows.filter(r=>r.businessAlerts.length).length,normalCount:rows.filter(r=>!r.businessAlerts.length&&!r.issues.length).length,warehouseCount:new Set(rows.map(r=>r.warehouse)).size};}
function calculateInventory(input){const facts=buildFacts(input),results=facts.map(f=>calculateFact(f,ruleFor(f,input.rules)));return {results,summary:{product:summarize(results.filter(r=>r.kind==='product')),sku:summarize(results.filter(r=>r.kind==='sku'))},formulaVersion:FORMULA_VERSION};}
module.exports={buildFacts,calculateFact,calculateInventory,summarize,detectBrand,detectCategory};
