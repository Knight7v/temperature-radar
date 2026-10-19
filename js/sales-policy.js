(function(root){
 function reject(message){throw Object.assign(new Error(message),{status:422});}
 // 平台导出文件里的店铺名 → 工作台店铺档案里的正式名称。
 // 喵速达（天猫）后端导出固定写「羚稀官方旗舰店」，实际是本公司的「喵速达电器官方旗舰店」。
 const SHOP_ALIASES={'羚稀官方旗舰店':'喵速达电器官方旗舰店'};
 function canonicalShopName(name){const n=String(name==null?'':name).trim();return SHOP_ALIASES[n]||n;}
 function findShopByName(shops,name){
  const target=canonicalShopName(name);
  if(!target)return null;
  const hits=shops.filter(s=>s.data&&s.data.name===target);
  if(!hits.length)reject('文件中的店铺「'+target+'」在店铺档案中不存在，请先维护店铺档案或手动选择店铺');
  if(hits.length>1)reject('店铺名称重复，请先修正店铺档案');
  return hits[0];
 }
 function resolveShop(shops,filename,selected){
  const match=String(filename||'').match(/^(\d{4,20})(?=[_\s.-])/);
  if(match){
   const matches=shops.filter(s=>s.data.shopId===match[1]);
   if(!matches.length)reject('文件中的店铺ID '+match[1]+' 未匹配，请先维护店铺档案');
   if(matches.length>1)reject('店铺ID重复，请先修正店铺档案');
   if(selected&&selected!==matches[0].id)reject('所选店铺与文件中的店铺ID不一致，请重新选择');
   return matches[0];
  }
  const shop=shops.find(s=>s.id===selected);
  if(!shop)reject('文件名未包含店铺ID，请手动选择店铺');
  return shop;
 }
 function selectShops(shops,query){
  const status=query.status||'current';
  if(!['current','all','运营中','闭店中','已闭店','unknown'].includes(status))reject('店铺状态筛选无效');
  return shops.filter(s=>(status==='all'||(status==='current'?s.data.status!=='已闭店':status==='unknown'?!s.data.status:s.data.status===status))&&(!query.shop||s.id===query.shop)&&['brand','platform','owner','executor'].every(k=>!query[k]||s.data[k]===query[k]));
 }
 const api={resolveShop,selectShops,canonicalShopName,findShopByName};if(typeof module==='object')module.exports=api;else root.SalesPolicy=api;
})(globalThis);
