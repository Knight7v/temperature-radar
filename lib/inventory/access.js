const {requireUser}=require('../auth');
const {getInventoryPool}=require('../db/inventory-client');
const {InventoryError}=require('./errors');
function assertInventoryIdentity(ctx,user,tenant,allowed=['admin','operator','viewer']){
 if(!user||!tenant||user.id!==ctx.userId||user.tenantId!==ctx.tenantId||tenant.id!==ctx.tenantId)throw new InventoryError('UNAUTHORIZED','登录身份无效',401);
 if(user.status!=='active'||tenant.status!=='active'||!allowed.includes(user.role))throw new InventoryError('FORBIDDEN','当前账号没有此操作权限',403);
 return {userId:user.id,tenantId:tenant.id,role:user.role};
}
async function requireInventoryUser(req,allowed){let ctx;try{ctx=await requireUser(req);}catch{throw new InventoryError('UNAUTHORIZED','请重新登录',401);}const db=getInventoryPool();const u=(await db.query('SELECT id,tenant_id AS "tenantId",role,status FROM users WHERE id=$1 AND tenant_id=$2',[ctx.userId,ctx.tenantId])).rows[0];const t=(await db.query('SELECT id,status FROM tenants WHERE id=$1',[ctx.tenantId])).rows[0];return assertInventoryIdentity(ctx,u,t,allowed);}
function requireRole(ctx,allowed){if(!allowed.includes(ctx.role))throw new InventoryError('FORBIDDEN','当前账号没有此操作权限',403);}
module.exports={assertInventoryIdentity,requireInventoryUser,requireRole};
