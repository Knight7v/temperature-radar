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
test('多值筛选：shop/brand/platform/owner/executor 支持逗号分隔多选（Excel 式筛选）',()=>{
 assert.deepEqual(selectShops(shops,{status:'all',shop:'a,c'}).map(s=>s.id),['a','c']);
 assert.deepEqual(selectShops(shops,{status:'all',shop:'a, b'}).map(s=>s.id),['a','b']);
 assert.equal(selectShops(shops,{status:'all',shop:'a,b'}).length,2);
 /* 单值写法兼容 */
 assert.deepEqual(selectShops(shops,{status:'all',shop:'a'}).map(s=>s.id),['a']);
 /* 空串与纯逗号等价于不筛选 */
 assert.equal(selectShops(shops,{status:'all',shop:','}).length,3);
 /* 字段多值：任一命中即保留 */
 const brandShops=[{id:'x',data:{brand:'格力'}},{id:'y',data:{brand:'海尔'}},{id:'z',data:{brand:'美的'}}];
 assert.deepEqual(selectShops(brandShops,{status:'all',brand:'格力,美的'}).map(s=>s.id),['x','z']);
 assert.deepEqual(selectShops(brandShops,{status:'all',brand:'格力'}).map(s=>s.id),['x']);
 /* 品类多选 */
 const catShops=[{id:'k1',data:{category:'空调'}},{id:'k2',data:{category:'冰箱'}},{id:'k3',data:{category:'其他'}}];
 assert.deepEqual(selectShops(catShops,{status:'all',category:'空调,冰箱'}).map(s=>s.id),['k1','k2']);
 assert.deepEqual(selectShops(catShops,{status:'all',category:'其他'}).map(s=>s.id),['k3']);
 assert.equal(selectShops(catShops,{status:'all',category:''}).length,3);
});
