'use strict';
const {createHash}=require('node:crypto');
/* 单批抽检上限：一份导出文件基本就是一个工作日的记录。一天 100 条已经是一个主管
   认真复核完的量（每条要通读对话 + 判 19 项），再多了只能草草点过，反而失真。
   所以 700 通 × 15% = 105 时按 100 抽，并把「被上限压了多少」如实报给前端。 */
const SAMPLE_CAP=100;
function fail(message){throw Object.assign(Error(message),{status:422});}
function sampleSessions(sessions,{rate=15,seed='',cap=SAMPLE_CAP}={}){
 if(!Array.isArray(sessions))fail('会话列表无效');
 if(!Number.isInteger(Number(rate))||Number(rate)<1||Number(rate)>100)fail('抽检比例须为1%至100%');
 const limit=Number.isFinite(Number(cap))&&Number(cap)>0?Math.floor(Number(cap)):0; /* 0 = 不限 */
 const requestedRate=Number(rate),ordinals=new Set();
 for(const session of sessions){if(!Number.isInteger(session.ordinal)||ordinals.has(session.ordinal))fail('会话编号无效或重复');ordinals.add(session.ordinal);}
 const names=session=>String(session.agent||'').split('、').map(value=>value.trim()).filter(value=>value&&value!=='待识别');
 const allAgents=new Set(sessions.flatMap(names));
 const hash=session=>createHash('sha256').update(String(seed)+'|'+session.ordinal).digest('hex');
 const ranked=[...sessions].sort((a,b)=>hash(a).localeCompare(hash(b))||a.ordinal-b.ordinal);
 const uncovered=new Set(allAgents),selected=[],picked=new Set();
 while(uncovered.size){
  let best=null,count=0;
  for(const session of ranked){if(picked.has(session.ordinal))continue;const covered=names(session).filter(name=>uncovered.has(name)).length;if(covered>count){best=session;count=covered;}}
  if(!best)break;
  selected.push(best);picked.add(best.ordinal);for(const name of names(best))uncovered.delete(name);
 }
 const minimumForCoverage=selected.length;
 const quota=Math.ceil(sessions.length*requestedRate/100);
 /* 上限只压「比例名额」，不压「每位客服都得抽到」——人少时要保证覆盖，人多了才受 100 约束 */
 const cappedQuota=limit?Math.min(quota,limit):quota;
 const target=Math.max(cappedQuota,minimumForCoverage);
 for(const session of ranked){if(selected.length>=target)break;if(!picked.has(session.ordinal)){selected.push(session);picked.add(session.ordinal);}}
 selected.sort((a,b)=>a.ordinal-b.ordinal);
 return{selected,selectedOrdinals:selected.map(session=>session.ordinal),total:sessions.length,target,requestedRate,actualRate:sessions.length?Math.round(selected.length/sessions.length*10000)/100:0,agentCount:allAgents.size,minimumForCoverage,quota,cappedQuota,cap:limit,capApplied:quota>cappedQuota&&minimumForCoverage<=cappedQuota,coverageRaisedSample:minimumForCoverage>cappedQuota};
}
module.exports={sampleSessions,SAMPLE_CAP};
