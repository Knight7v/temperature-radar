const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sampleSessions}=require('../lib/quality/sampling');
const make=(ordinal,agent)=>({ordinal,agent,messages:[]});
test('default sample is 15 percent and covers every identified agent',()=>{
 const sessions=[...Array.from({length:30},(_,i)=>make(i+1,'客服甲')),...Array.from({length:10},(_,i)=>make(i+31,'客服乙'))];
 const result=sampleSessions(sessions,{seed:'same-file'});
 assert.equal(result.requestedRate,15);
 assert.equal(result.target,6);
 assert.equal(result.selected.length,6);
 assert.deepEqual(new Set(result.selected.map(s=>s.agent)),new Set(['客服甲','客服乙']));
 assert.deepEqual(sampleSessions(sessions,{seed:'same-file'}).selected.map(s=>s.ordinal),result.selected.map(s=>s.ordinal));
});
test('agent coverage can exceed the percentage quota and is reported',()=>{
 const sessions=['甲','乙','丙','丁','戊'].map((agent,i)=>make(i+1,agent));
 const result=sampleSessions(sessions,{rate:15,seed:'five'});
 assert.equal(result.selected.length,5);
 assert.equal(result.minimumForCoverage,5);
 assert.equal(result.coverageRaisedSample,true);
});
test('one multi-agent conversation covers both agents, without duplicate picks',()=>{
 const sessions=[make(1,'甲、乙'),make(2,'甲'),make(3,'乙'),make(4,'待识别')];
 const result=sampleSessions(sessions,{rate:15,seed:'multi'});
 assert.equal(result.selected.length,1);
 assert.equal(result.selected[0].ordinal,1);
 assert.equal(result.agentCount,2);
});
test('single-batch cap holds at 100: 700 sessions at 15 percent picks 100, not 105',()=>{
 const sessions=Array.from({length:700},(_,i)=>make(i+1,'客服甲'));
 const result=sampleSessions(sessions,{rate:15,seed:'big'});
 assert.equal(result.quota,105);
 assert.equal(result.cappedQuota,100);
 assert.equal(result.cap,100);
 assert.equal(result.capApplied,true);
 assert.equal(result.target,100);
 assert.equal(result.selected.length,100);
 assert.equal(new Set(result.selected.map(s=>s.ordinal)).size,100);
});
test('cap does not cut the sample below the percentage when under the limit',()=>{
 const sessions=Array.from({length:200},(_,i)=>make(i+1,'客服甲'));
 const result=sampleSessions(sessions,{rate:15,seed:'mid'});
 assert.equal(result.quota,30);
 assert.equal(result.capApplied,false);
 assert.equal(result.selected.length,30);
});
test('agent coverage wins over the cap, and the overshoot is reported',()=>{
 const sessions=Array.from({length:150},(_,i)=>make(i+1,'客服'+(i+1)));
 const result=sampleSessions(sessions,{rate:15,seed:'many-agents'});
 assert.equal(result.minimumForCoverage,150);
 assert.equal(result.selected.length,150);
 assert.equal(result.capApplied,false);
 assert.equal(result.coverageRaisedSample,true);
 assert.ok(result.selected.length>result.cap);
});
test('cap can be switched off explicitly',()=>{
 const sessions=Array.from({length:700},(_,i)=>make(i+1,'客服甲'));
 const result=sampleSessions(sessions,{rate:15,seed:'big',cap:0});
 assert.equal(result.cappedQuota,105);
 assert.equal(result.selected.length,105);
 assert.equal(result.capApplied,false);
});
test('invalid rates and duplicate ordinals are rejected',()=>{
 assert.throws(()=>sampleSessions([make(1,'甲')],{rate:0}),/比例/);
 assert.throws(()=>sampleSessions([make(1,'甲'),make(1,'乙')],{rate:15}),/编号/);
});
