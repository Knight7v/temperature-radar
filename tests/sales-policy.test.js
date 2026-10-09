const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveShop,selectShops}=require('../js/sales-policy');
const shops=[{id:'a',data:{shopId:'10186122',name:'换新店',status:'运营中'}},{id:'b',data:{shopId:'20331832',status:'已闭店'}},{id:'c',data:{status:''}}];
test('文件店铺ID精确匹配；错误选择、未匹配和重复必须拒绝',()=>{
 assert.equal(resolveShop(shops,'10186122_交易概况_2026-04.xlsx','').id,'a');
 assert.throws(()=>resolveShop(shops,'10186122_交易概况.xlsx','b'),/不一致/);
 assert.throws(()=>resolveShop(shops,'99999999_交易概况.xlsx','a'),/未匹配/);
 assert.throws(()=>resolveShop([...shops,shops[0]],'10186122_交易概况.xlsx',''),/重复/);
 assert.throws(()=>resolveShop(shops,'日报.xlsx',''),/手动选择/);
 assert.equal(resolveShop(shops,'日报.xlsx','a').id,'a');
});
test('默认排除闭店，历史查询可显式选择全部或闭店',()=>{
 assert.deepEqual(selectShops(shops,{}).map(s=>s.id),['a','c']);
 assert.equal(selectShops(shops,{status:'all'}).length,3);
 assert.deepEqual(selectShops(shops,{status:'已闭店'}).map(s=>s.id),['b']);
 assert.equal(selectShops(shops,{shop:'b'}).length,0);
});
