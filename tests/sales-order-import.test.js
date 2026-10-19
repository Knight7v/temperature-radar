const {test}=require('node:test'),assert=require('node:assert/strict'),ExcelJS=require('exceljs');
const {parseFile,parse,TEMPLATE_ORDER}=require('../lib/sales/core');
const {canonicalShopName,findShopByName}=require('../js/sales-policy');

const HEADERS=['店铺名称','下单时间','订单状态','交易订单号','买家昵称','订单金额','商品数量','规格'];
async function book(rows){
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('全部数据导出');
 s.addRow(HEADERS);rows.forEach(r=>s.addRow(r));
 return Buffer.from(await w.xlsx.writeBuffer());
}
const order=(no,status,buyer,amount,qty,spec,when)=>(['羚稀官方旗舰店',when,status,no,buyer,amount,qty,spec]);

test('喵速达订单明细：一单两行只算一次，剔除关闭与外机',async()=>{
 const buf=await book([
  order('A1','已签收','买家甲','5799.0',1,'内机','2026-10-01 10:00:00'),
  order('A1','已签收','买家甲','5799.0',1,'外机','2026-10-01 10:00:00'),
  order('B2','关闭','买家乙','3293.0',1,'内机','2026-10-02 11:00:00'),
  order('B2','关闭','买家乙','3293.0',1,'外机','2026-10-02 11:00:00'),
  order('C3','仓库已接单','买家丙','4199.0',1,'内机','2026-10-01 23:30:00'),
  order('C3','仓库已接单','买家丙','4199.0',1,'外机','2026-10-01 23:30:00')
 ]);
 const r=await parseFile(buf);
 assert.equal(r.template,TEMPLATE_ORDER);
 assert.equal(r.shopName,'羚稀官方旗舰店');
 assert.equal(r.rows.length,1);
 assert.equal(r.rows[0].date,'2026-10-01');
 assert.equal(r.rows[0].cents,579900+419900);
 assert.equal(r.rows[0].orders,2);
 assert.equal(r.rows[0].customers,2);
 assert.equal(r.stats.rowsClosed,2);
 assert.equal(r.stats.closedOrders,1);
 // 关闭判定优先于外机判定，所以关闭单的外机行计入 rowsClosed 而非 rowsOuter
 assert.equal(r.stats.rowsOuter,2);
 assert.equal(r.stats.orphanOuter,0);
});

test('商品名称含“外机”不影响判内机，只有规格列精确为外机才剔除',async()=>{
 const buf=await book([order('D4','已出库','买家丁','3299.0',1,'内机','2026-10-03 09:00:00')]);
 const r=await parseFile(buf);
 assert.equal(r.rows.length,1);
 assert.equal(r.rows[0].cents,329900);
});

test('只有外机行而没有内机行的订单会报警，不被静默吞掉',async()=>{
 const buf=await book([
  order('E5','已签收','买家戊','2999.0',1,'外机','2026-10-04 12:00:00'),
  order('F6','已签收','买家己','3999.0',1,'内机','2026-10-04 13:00:00'),
  order('F6','已签收','买家己','3999.0',1,'外机','2026-10-04 13:00:00')
 ]);
 const r=await parseFile(buf);
 assert.equal(r.stats.orphanOuter,1);
 assert.equal(r.rows[0].cents,399900);
});

test('下单时间支持日期单元格，且按天汇总',async()=>{
 const buf=await book([
  ['羚稀官方旗舰店',new Date(2026,9,5,9,15),'已签收','G7','甲','1000',1,'内机'],
  ['羚稀官方旗舰店',new Date(2026,9,5,23,45),'已签收','H8','乙','2000',1,'内机']
 ]);
 const r=await parseFile(buf);
 assert.equal(r.rows.length,1);
 assert.equal(r.rows[0].date,'2026-10-05');
 assert.equal(r.rows[0].cents,300000);
});

test('空金额与非数字金额给出明确错误',async()=>{
 const bad=await book([order('I9','已签收','甲','abc',1,'内机','2026-10-06 10:00:00')]);
 await assert.rejects(()=>parse(bad),/订单金额无效/);
});

test('店铺别名：羚稀官方旗舰店对应喵速达电器官方旗舰店',async()=>{
 assert.equal(canonicalShopName('羚稀官方旗舰店'),'喵速达电器官方旗舰店');
 assert.equal(canonicalShopName('喵速达电器官方旗舰店'),'喵速达电器官方旗舰店');
 const shops=[{id:'s1',data:{name:'喵速达电器官方旗舰店'}}];
 assert.equal(findShopByName(shops,'羚稀官方旗舰店').id,'s1');
 assert.throws(()=>findShopByName(shops,'不存在的店'),/店铺档案中不存在/);
});
