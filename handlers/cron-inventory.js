const {apiHandler}=require('../lib/http');
const {InventoryError}=require('../lib/inventory/errors');
const {runDaily}=require('../lib/inventory/replenishment-service');
const {recordTaskRun}=require('../lib/notifications');
const {getInventoryPool}=require('../lib/db/inventory-client');
module.exports=apiHandler(async(req,res)=>{
 if(req.method!=='GET')return res.status(405).json({error:'不支持此请求'});
 const secret=process.env.CRON_SECRET;
 if(!secret||req.headers.authorization!==`Bearer ${secret}`)throw new InventoryError('UNAUTHORIZED','未授权',401);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 try{
  const data=await runDaily(date);
  await recordTaskRun(getInventoryPool(),'inventory-daily',true,'库存日结完成（'+date+'）');
  return res.status(200).json({success:true,data});
 }catch(error){
  await recordTaskRun(getInventoryPool(),'inventory-daily',false,error.message||String(error));
  throw error;
 }
});
