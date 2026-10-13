const test = require('node:test');
const assert = require('node:assert/strict');
const {scoreConversation} = require('../lib/quality/machine-score');
const {resolveAssignment,validateAssignment} = require('../lib/quality/classification');
const shops=[
 {id:'11111111-1111-4111-8111-111111111111',data:{name:'格力旗舰店',brand:'格力'}},
 {id:'22222222-2222-4222-8222-222222222222',data:{name:'海尔星河专卖店',brand:'海尔'}}
];
const msg=(id,role,at,text)=>({id,role,at:`2026-10-10 ${at}`,text});
test('machine score explains objective deductions and links source messages',()=>{
 const result=scoreConversation({agent:'格力旗舰店售前-阿伟',messages:[msg(0,'customer','10:00:00','请问什么时候发货？'),msg(1,'agent','10:06:00','滚蛋')]});
 assert.equal(result.version,'chat-behavior-v1');
 assert.equal(result.score,50);
 assert.deepEqual(result.deductions.map(x=>x.points),[40,10]);
 assert.deepEqual(result.deductions[0].messageIds,[1]);
 assert.ok(result.warnings.some(x=>x.severity==='high'));
});
test('customer complaint and unverified claims warn without automatic guilt',()=>{
 const result=scoreConversation({agent:'客服',messages:[msg(0,'customer','10:00:00','我要投诉'),msg(1,'agent','10:00:20','我们可以申请补贴')]});
 assert.equal(result.score,100);
 assert.equal(result.deductions.length,0);
 assert.ok(result.warnings.some(x=>x.code==='complaint'));
 assert.ok(result.warnings.some(x=>x.code==='claim-check'));
});
test('unrecognized agent is unscorable; log anomalies do not deduct behavior score',()=>{
 const result=scoreConversation({agent:'待识别',anomalies:['缺少结束标记'],messages:[msg(0,'customer','10:00:00','你好')]});
 assert.equal(result.score,null);
 assert.ok(result.warnings.some(x=>x.code==='agent-unrecognized'));
 assert.ok(result.warnings.some(x=>x.code==='log-anomaly'));
});
test('explicit store assignment is tenant-catalog validated and group follows brand',()=>{
 assert.deepEqual(validateAssignment({shopId:shops[1].id},shops),{shopId:shops[1].id,shopName:'海尔星河专卖店',brand:'海尔',group:'海尔组',source:'selected'});
 assert.throws(()=>validateAssignment({shopId:'33333333-3333-4333-8333-333333333333'},shops),/店铺不存在/);
});
test('legacy sessions infer only unique exact shop-name evidence',()=>{
 assert.equal(resolveAssignment({agent:'格力旗舰店售前-阿伟'},shops).shopId,shops[0].id);
 assert.deepEqual(resolveAssignment({agent:'海尔客服'},shops),{shopId:null,shopName:'未关联店铺',brand:'海尔',group:'海尔组',source:'agent-brand'});
 assert.equal(resolveAssignment({agent:'待识别'},shops).brand,'未识别');
});
