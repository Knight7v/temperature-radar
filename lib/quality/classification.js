'use strict';
const BRANDS=['格力','海尔'];
const isUuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
const brandOf=value=>BRANDS.find(brand=>String(value||'').includes(brand))||'未识别';
function fromShop(shop,source){
 const name=String(shop.data?.name||''),brand=brandOf(shop.data?.brand||name);
 return{shopId:shop.id,shopName:name,brand,group:brand==='未识别'?'未识别':brand+'组',source};
}
function validateAssignment(input,shops){
 if(!input?.shopId)return null;
 if(!isUuid(input.shopId))throw Object.assign(Error('店铺 ID 无效'),{status:422});
 const shop=shops.find(x=>x.id===input.shopId);
 if(!shop)throw Object.assign(Error('店铺不存在'),{status:422});
 return fromShop(shop,'selected');
}
function resolveAssignment(session,shops){
 const saved=session?.assignment;
 if(saved?.shopId){const shop=shops.find(x=>x.id===saved.shopId);if(shop)return fromShop(shop,'selected');}
 const agent=String(session?.agent||'');
 const matches=shops.filter(x=>{const name=String(x.data?.name||'');return name.length>=4&&agent.includes(name);});
 if(matches.length===1)return fromShop(matches[0],'agent-shop');
 const brand=brandOf(agent);
 return{shopId:null,shopName:'未关联店铺',brand,group:brand==='未识别'?'未识别':brand+'组',source:brand==='未识别'?'unknown':'agent-brand'};
}
module.exports={BRANDS,brandOf,validateAssignment,resolveAssignment};
