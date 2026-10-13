'use strict';
const {createHash}=require('node:crypto');
function fail(message){throw Object.assign(Error(message),{status:422});}
function sampleSessions(sessions,{rate=15,seed=''}={}){
 if(!Array.isArray(sessions))fail('会话列表无效');
 if(!Number.isInteger(Number(rate))||Number(rate)<1||Number(rate)>100)fail('抽检比例须为1%至100%');
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
 const minimumForCoverage=selected.length,quota=Math.ceil(sessions.length*requestedRate/100),target=Math.max(quota,minimumForCoverage);
 for(const session of ranked){if(selected.length>=target)break;if(!picked.has(session.ordinal)){selected.push(session);picked.add(session.ordinal);}}
 selected.sort((a,b)=>a.ordinal-b.ordinal);
 return{selected,selectedOrdinals:selected.map(session=>session.ordinal),total:sessions.length,target,requestedRate,actualRate:sessions.length?Math.round(selected.length/sessions.length*10000)/100:0,agentCount:allAgents.size,minimumForCoverage,coverageRaisedSample:minimumForCoverage>quota};
}
module.exports={sampleSessions};
