const test=require('node:test'),assert=require('node:assert/strict');
const {assertInventoryIdentity}=require('../lib/inventory/access');
test('inventory authorization uses current database role and active company',()=>{
 const ctx={userId:'u',tenantId:'t',role:'admin'},user={id:'u',tenantId:'t',role:'viewer',status:'active'},tenant={id:'t',status:'active'};
 assert.throws(()=>assertInventoryIdentity(ctx,user,tenant,['admin']),e=>e.status===403);
 assert.equal(assertInventoryIdentity(ctx,user,tenant,['viewer']).role,'viewer');
 assert.throws(()=>assertInventoryIdentity(ctx,user,{...tenant,status:'suspended'},['viewer']),e=>e.status===403);
 assert.throws(()=>assertInventoryIdentity(ctx,{...user,tenantId:'other'},tenant,['viewer']),e=>e.status===401);
});
