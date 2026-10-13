'use strict';
const fs=require('node:fs'),path=require('node:path');
const {getInventoryPool}=require('../db/inventory-client');
let ready;
function ensureSalesStructureSchema(){
 if(!ready)ready=(async()=>{const pool=getInventoryPool();for(const name of ['0006_sales_structure.sql','0007_sales_structure_settlement.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../db/migrations',name),'utf8'));})().catch(error=>{ready=null;throw error;});
 return ready;
}
module.exports={ensureSalesStructureSchema};
