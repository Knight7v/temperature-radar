(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkbenchSession=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const KEY='workbench.session.v1';
 function safeReturnTo(input){const raw=String(input||'');if(!raw.startsWith('/')||raw.startsWith('//')||raw.includes('\\'))return '/workbench.html';try{const u=new URL(raw,'https://workbench.invalid');return u.origin==='https://workbench.invalid'&&['/workbench.html','/inventory.html','/replenishment.html','/index-v2.html','/quality.html','/agents.html','/products.html','/pk.html','/service-commission.html','/sales.html','/sales-structure.html','/design.html','/selling.html','/comparison.html','/report-design.html'].includes(u.pathname)?u.pathname+u.search+u.hash:'/workbench.html';}catch{return '/workbench.html';}}
 function createSessionClient({fetchImpl=globalThis.fetch.bind(globalThis),storage=globalThis.sessionStorage,now=()=>Date.now()}={}){
  let refreshing=null;
  function clear(){storage.removeItem(KEY);}
  function expired(){const e=Error('登录已过期，请重新登录');e.code='SESSION_EXPIRED';return e;}
  function read(){try{const s=JSON.parse(storage.getItem(KEY));if(s&&typeof s.accessToken==='string'&&typeof s.refreshToken==='string'&&Number.isFinite(s.expiresAt))return s;}catch{}clear();return null;}
  async function jsonResponse(r){const body=await r.json().catch(()=>({}));if(!r.ok){const e=Error(typeof body.error==='string'?body.error:body.error?.message||'服务暂不可用');e.status=r.status;throw e;}return body.data;}
  function save(data){if(!data?.accessToken||!data.refreshToken||!Number.isFinite(data.expiresIn))throw Error('登录服务返回了无效会话');storage.setItem(KEY,JSON.stringify({accessToken:data.accessToken,refreshToken:data.refreshToken,expiresAt:now()+data.expiresIn*1000}));}
  async function refresh(){if(refreshing)return refreshing;refreshing=(async()=>{const s=read();if(!s)throw expired();try{save(await jsonResponse(await fetchImpl('/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:s.refreshToken})})));}catch{clear();throw expired();}})();try{await refreshing;}finally{refreshing=null;}}
  async function authorizedFetch(url,init={}){
   if(typeof url!=='string'||!url.startsWith('/api/')||url.includes('\\'))throw Error('仅允许同源API请求');
   let s=read();if(!s)throw expired();if(s.expiresAt<=now()){await refresh();s=read();}
   const send=()=>fetchImpl(url,{...init,headers:new Headers({...Object.fromEntries(new Headers(init.headers)),Authorization:'Bearer '+read().accessToken})});
   const sentToken=s.accessToken;let response=await send();
   if(response.status===401){if(read()?.accessToken===sentToken)await refresh();if(!read())throw expired();response=await send();if(response.status===401){clear();throw expired();}}
   return response;
  }
  return {clear,authorizedFetch,async login(credentials){const d=await jsonResponse(await fetchImpl('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)}));save(d);return {user:d.user,tenant:d.tenant};},async getIdentity(){try{return await jsonResponse(await authorizedFetch('/api/auth/me'));}catch(e){if(/signature verification failed|JWT_SECRET|令牌无效/i.test(e.message||'')){clear();throw expired();}throw e;}},async logout(){let remoteRevoked=false;try{remoteRevoked=(await authorizedFetch('/api/auth/logout',{method:'POST'})).ok;}catch{}finally{clear();}return {remoteRevoked};}};
 }
 return {safeReturnTo,createSessionClient};
});
