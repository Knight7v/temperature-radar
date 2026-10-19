const {apiHandler}=require('../../lib/http');
const {requireInventoryUser}=require('../../lib/inventory/access');
const service=require('../../lib/inventory/replenishment-service');

module.exports=apiHandler(async(req,res)=>{
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'不支持此请求'});
 const ctx=await requireInventoryUser(req,req.method==='GET'?['admin','operator','supply_chain','viewer']:['admin']);
 if(req.method==='GET')return res.json({success:true,data:await service.pushConfig(ctx)});
 return res.json({success:true,data:await service.configureWebhook(ctx,req.body?.webhook)});
});
