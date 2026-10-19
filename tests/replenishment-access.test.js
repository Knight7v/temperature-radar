const test=require('node:test');
const assert=require('node:assert/strict');
const {assertInventoryIdentity}=require('../lib/inventory/access');

test('supply-chain users can be authenticated for inventory reads',()=>{
 const ctx={userId:'u',tenantId:'t'};
 const user={id:'u',tenantId:'t',role:'supply_chain',status:'active'};
 const tenant={id:'t',status:'active'};
 assert.equal(assertInventoryIdentity(ctx,user,tenant).role,'supply_chain');
});
