'use strict';
const {sampleSessions}=require('./sampling');
function planLegacySample(sessions,seed,rate=15){
 const sample=sampleSessions(sessions,{rate,seed});
 const selected=new Set(sample.selectedOrdinals);
 for(const session of sessions)if(session.status==='draft'||session.status==='reviewed')selected.add(session.ordinal);
 const selectedOrdinals=[...selected].sort((a,b)=>a-b);
 return{selectedOrdinals,sampling:{total:sample.total,target:sample.target,selected:selectedOrdinals.length,requestedRate:sample.requestedRate,actualRate:sessions.length?Math.round(selectedOrdinals.length/sessions.length*10000)/100:0,agentCount:sample.agentCount,coverageRaisedSample:sample.coverageRaisedSample,preservedReviews:selectedOrdinals.length-sample.selected.length}};
}
module.exports={planLegacySample};
