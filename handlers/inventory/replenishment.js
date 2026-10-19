const {apiHandler}=require('../../lib/http');
const {requireInventoryUser}=require('../../lib/inventory/access');
const service=require('../../lib/inventory/replenishment-service');

module.exports=apiHandler(async(req,res)=>{
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'不支持此请求'});
 const ctx=await requireInventoryUser(req,['admin','operator','supply_chain','viewer']);
 if(req.method==='GET')return res.json({success:true,data:await service.report(ctx,req.query||{})});
 return res.json({success:true,data:await service.savePlan(ctx,req.body||{})});
});
