const test = require('node:test');
const assert = require('node:assert/strict');
const {safeReturnTo,createSessionClient}=require('../js/workbench-session');
function storage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
test('returnTo rejects external, escaped hosts and unknown pages',()=>{
 for(const s of ['//evil.test','https://evil.test','/\\evil.test','/api/auth/me','javascript:alert(1)']) assert.equal(safeReturnTo(s),'/workbench.html');
 assert.equal(safeReturnTo('/inventory.html?date=2026-09-29'),'/inventory.html?date=2026-09-29');
 assert.equal(safeReturnTo('/replenishment.html?sku=123'),'/replenishment.html?sku=123');
});
test('concurrent expired requests share refresh and preserve rotated tokens',async()=>{
 const s=storage();s.setItem('workbench.session.v1',JSON.stringify({accessToken:'old',refreshToken:'r1',expiresAt:1}));
 let refresh=0;
 const fetchImpl=async(url,init)=>{if(url.includes('refresh')) {refresh++;await new Promise(r=>setTimeout(r,10));return response({data:{accessToken:'new',refreshToken:'r2',expiresIn:900}});}
 return response({authorization:new Headers(init.headers).get('Authorization')});};
 const c=createSessionClient({storage:s,fetchImpl,now:()=>100});
 const results=await Promise.all([c.authorizedFetch('/api/one'),c.authorizedFetch('/api/two')]);
 for(const r of results)assert.equal((await r.json()).authorization,'Bearer new');
 assert.equal(refresh,1);assert.equal(JSON.parse(s.getItem('workbench.session.v1')).refreshToken,'r2');
});
test('failed refresh clears session and a 403 does not refresh',async()=>{
 const s=storage();s.setItem('workbench.session.v1',JSON.stringify({accessToken:'a',refreshToken:'r',expiresAt:0}));
 const c=createSessionClient({storage:s,fetchImpl:async()=>response({},401)});
 await assert.rejects(c.authorizedFetch('/api/a'),e=>e.code==='SESSION_EXPIRED');assert.equal(s.getItem('workbench.session.v1'),null);
 s.setItem('workbench.session.v1',JSON.stringify({accessToken:'a',refreshToken:'r',expiresAt:Date.now()+999999}));
 let calls=0;const d=createSessionClient({storage:s,fetchImpl:async()=>{calls++;return response({},403)}});
 assert.equal((await d.authorizedFetch('/api/a')).status,403);assert.equal(calls,1);
});
test('malformed storage is cleared; logout reports remote failure but clears local state',async()=>{
 const s=storage();s.setItem('workbench.session.v1','{');
 const c=createSessionClient({storage:s,fetchImpl:async()=>{throw Error('offline')}});
 await assert.rejects(c.getIdentity(),e=>e.code==='SESSION_EXPIRED');
 s.setItem('workbench.session.v1',JSON.stringify({accessToken:'a',refreshToken:'r',expiresAt:Date.now()+999999}));
 assert.equal((await c.logout()).remoteRevoked,false);assert.equal(s.getItem('workbench.session.v1'),null);
});
