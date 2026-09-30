const yauzl=require('yauzl');const {InventoryError}=require('./errors');
function guardXlsx(buffer){return new Promise((resolve,reject)=>{yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(err,zip)=>{
 if(err)return reject(new InventoryError('INVALID_XLSX','文件不是有效的Excel工作簿',422));let count=0,total=0,done=false;const names=new Set();
 const fail=()=>{if(done)return;done=true;zip.close();reject(new InventoryError('UNSAFE_XLSX','Excel文件过大、损坏、加密或包含宏，请重新导出',422));};
 zip.on('error',fail);zip.on('entry',entry=>{if(++count>2000||names.has(entry.fileName)||entry.fileName.includes('vbaProject')||(entry.generalPurposeBitFlag&1)||entry.uncompressedSize>64*1024*1024)return fail();names.add(entry.fileName);if(entry.fileName.endsWith('/'))return zip.readEntry();zip.openReadStream(entry,(e,stream)=>{if(e)return fail();stream.on('error',fail);stream.on('data',chunk=>{total+=chunk.length;if(total>64*1024*1024){stream.destroy();fail();}});stream.on('end',()=>{if(!done)zip.readEntry();});});});
 zip.on('end',()=>{if(!done){done=true;if(!names.has('[Content_Types].xml')||!names.has('xl/workbook.xml'))return reject(new InventoryError('INVALID_XLSX','缺少Excel工作簿结构',422));resolve();}});zip.readEntry();
 });});}
module.exports={guardXlsx};
