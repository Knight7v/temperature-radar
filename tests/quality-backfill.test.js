const {test}=require('node:test');
const assert=require('node:assert/strict');
const {planLegacySample}=require('../lib/quality/backfill');
test('legacy import receives a stable 15% sample across all agents',()=>{
 const sessions=[...Array.from({length:30},(_,i)=>({ordinal:i+1,agent:'客服甲',status:'pending'})),...Array.from({length:10},(_,i)=>({ordinal:i+31,agent:'客服乙',status:'pending'}))];
 const plan=planLegacySample(sessions,'old-hash');
 assert.equal(plan.sampling.total,40);
 assert.equal(plan.sampling.selected,6);
 assert.equal(plan.sampling.agentCount,2);
 assert.deepEqual(new Set(sessions.filter(s=>plan.selectedOrdinals.includes(s.ordinal)).map(s=>s.agent)),new Set(['客服甲','客服乙']));
});
test('legacy draft and reviewed sessions remain in the sample',()=>{
 const sessions=Array.from({length:20},(_,i)=>({ordinal:i+1,agent:'客服甲',status:i===19?'reviewed':i===18?'draft':'pending'}));
 const plan=planLegacySample(sessions,'old-hash');
 assert.ok(plan.selectedOrdinals.includes(20));
 assert.ok(plan.selectedOrdinals.includes(19));
 assert.ok(plan.sampling.selected>=3);
});
