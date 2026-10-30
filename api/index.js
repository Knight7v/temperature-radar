'use strict';

// Keep the public API paths while deploying a single Vercel Function.
const handlers=Object.freeze({
 '/api/auth/login':()=>require('../handlers/auth/login'),
 '/api/auth/logout':()=>require('../handlers/auth/logout'),
 '/api/auth/me':()=>require('../handlers/auth/me'),
 '/api/auth/password':()=>require('../handlers/auth/password'),
 '/api/auth/refresh':()=>require('../handlers/auth/refresh'),
 '/api/auth/register':()=>require('../handlers/auth/register'),
 '/api/auth/users':()=>require('../handlers/auth/users'),
 '/api/cron-inventory':()=>require('../handlers/cron-inventory'),
 '/api/cron-push':()=>require('../handlers/cron-push'),
 '/api/design':()=>require('../handlers/design'),
 '/api/inventory/export':()=>require('../handlers/inventory/export'),
 '/api/inventory/followups':()=>require('../handlers/inventory/followups'),
 '/api/inventory/import-confirm':()=>require('../handlers/inventory/import-confirm'),
 '/api/inventory/import-preview':()=>require('../handlers/inventory/import-preview'),
 '/api/inventory/overview':()=>require('../handlers/inventory/overview'),
 '/api/inventory/pairings':()=>require('../handlers/inventory/pairings'),
 '/api/inventory/push-config':()=>require('../handlers/inventory/push-config'),
 '/api/inventory/replenishment':()=>require('../handlers/inventory/replenishment'),
 '/api/inventory/rules':()=>require('../handlers/inventory/rules'),
 '/api/push':()=>require('../handlers/push'),
 '/api/product-knowledge':()=>require('../handlers/product-knowledge'),
 '/api/quality-ai':()=>require('../handlers/quality-ai'),
 '/api/quality-insight':()=>require('../handlers/quality-insight'),
 '/api/quality-analysis-v2':()=>require('../handlers/quality-analysis-v2'),
 '/api/quality-calibration':()=>require('../handlers/quality-calibration'),
 '/api/quality-sampling-v2':()=>require('../handlers/quality-sampling-v2'),
 '/api/quality-sampling':()=>require('../handlers/quality-sampling'),
 '/api/quality':()=>require('../handlers/quality'),
 '/api/sales-structure':()=>require('../handlers/sales-structure'),
 '/api/sales':()=>require('../handlers/sales'),
 '/api/service-agents':()=>require('../handlers/service-agents'),
 '/api/tenant/config':()=>require('../handlers/tenant/config'),
 '/api/weather-summary':()=>require('../handlers/weather-summary'),
 '/api/weather':()=>require('../handlers/weather')
});

module.exports=(req,res)=>{
 const rewritten=typeof req.query?.route==='string'?req.query.route:null;
 const route=rewritten?'/api/'+rewritten.replace(/^\/+/, ''):new URL(req.url,'http://localhost').pathname;
 const load=Object.hasOwn(handlers,route)?handlers[route]:null;
 if(!load)return res.status(404).json({error:'接口不存在'});
 if(rewritten)delete req.query.route;
 return load()(req,res);
};
