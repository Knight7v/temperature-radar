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
test('invalid rates and duplicate ordinals are rejected',()=>{
 assert.throws(()=>sampleSessions([make(1,'甲')],{rate:0}),/比例/);
 assert.throws(()=>sampleSessions([make(1,'甲'),make(1,'乙')],{rate:15}),/编号/);
});
