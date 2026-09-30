const {apiHandler}=require('../lib/http');const {InventoryError}=require('../lib/inventory/errors');
module.exports=apiHandler(async(req,res)=>{const secret=process.env.CRON_SECRET;if(!secret||req.headers.authorization!==`Bearer ${secret}`)throw new InventoryError('UNAUTHORIZED','未授权',401);return res.status(200).json({success:true,data:{status:'ready',message:'库存推送调度入口已接入，待配置租户快照与企业微信后执行'}});});
