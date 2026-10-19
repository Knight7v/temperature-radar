const test=require('node:test');
const assert=require('node:assert/strict');
const route=require('../api/index');

function response(){return {statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}

test('API router preserves public paths and dispatches rewritten paths',async()=>{
 const direct=response();
 await route({method:'GET',url:'/api/auth/me',headers:{},query:{}},direct);
 assert.equal(direct.statusCode,401);
 const rewritten=response(),req={method:'GET',url:'/api/index?route=auth/me',headers:{},query:{route:'auth/me'}};
 await route(req,rewritten);
 assert.equal(rewritten.statusCode,401);
 assert.equal(req.query.route,undefined);
 const missing=response();
 await route({method:'GET',url:'/api/missing',query:{},headers:{}},missing);
 assert.equal(missing.statusCode,404);
});

test('weather cron rejects a token in the URL',async()=>{
 const old=process.env.CRON_SECRET;
 process.env.CRON_SECRET='router-test-secret';
 try{
  const res=response();
  await route({method:'GET',url:'/api/cron-push',headers:{},query:{token:'router-test-secret'}},res);
  assert.equal(res.statusCode,401);
 }finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}
});
