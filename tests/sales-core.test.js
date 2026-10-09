const {test}=require('node:test'),assert=require('node:assert/strict'),{cents,period}=require('../lib/sales/core');
test('金额使用整数分，转换不丢失小数',()=>{assert.equal(cents('51,993.38'),5199338);assert.throws(()=>cents('-'));assert.throws(()=>cents('1.001'));});
test('跨月周拆分及季度、年度分组',()=>{assert.equal(period('2026-09-01','week'),'2026-09-01～2026-09-06');assert.equal(period('2026-09-30','week'),'2026-09-28～2026-09-30');assert.equal(period('2026-10-01','quarter'),'2026-Q4');assert.equal(period('2026-10-07','year'),'2026');});
test('京东报表成交金额横杠按零导入，空白或非法金额仍拒绝',async()=>{
 const ExcelJS=require('exceljs'),{parse}=require('../lib/sales/core');
 async function report(value){const w=new ExcelJS.Workbook(),s=w.addWorksheet('日报');s.addRow(['时间','成交金额']);s.addRow(['2026-04-01',value]);return Buffer.from(await w.xlsx.writeBuffer());}
 const rows=await parse(await report(' - '));assert.equal(rows.length,1);assert.equal(rows[0].cents,0);assert.equal(rows[0].date,'2026-04-01');
 for(const value of ['',null,'abc',-1,'1.001'])await assert.rejects(()=>report(value).then(parse));
});
