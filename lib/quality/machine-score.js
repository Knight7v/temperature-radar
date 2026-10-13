'use strict';

// This is a narrow, reproducible text-behavior pre-score. It never replaces the supervisor review.
const VERSION='chat-behavior-v1';
const epoch=value=>Date.parse(String(value||'').replace(' ','T')+'+08:00');
const offensive=/(?:傻逼|滚蛋|你有病|去死|蠢货|废物)/;
const complaint=/(?:投诉|工商|消协|315|媒体曝光)/;
const claim=/(?:国补|补贴|质保|保修|安装|优惠券|折扣|降价|赔付)/;
function scoreConversation(session){
 const messages=Array.isArray(session?.messages)?session.messages:[];
 const warnings=[],deductions=[];
 const warn=(severity,code,label,messageIds=[])=>warnings.push({severity,code,label,messageIds});
 const deduct=(code,points,label,messageIds)=>deductions.push({code,points,label,messageIds});
 const agents=messages.filter(x=>x.role==='agent'&&x.text);
 const customers=messages.filter(x=>x.role==='customer'&&x.text);
 if(!agents.length||String(session?.agent||'')==='待识别')warn('high','agent-unrecognized','未识别到客服有效发言，机器无法评分；请核对客服识别关键词。');
 if(!customers.length)warn('medium','customer-unrecognized','未识别到顾客有效发言，机器无法评价回应。');
 const abusive=agents.find(x=>offensive.test(x.text));
 if(abusive){deduct('abusive-language',40,'客服出现明确侮辱性用语', [abusive.id]);warn('high','abusive-language','疑似辱骂顾客，需主管立即核对原文。',[abusive.id]);}
 let longest=null;
 for(let i=0;i<messages.length;i++){
  const customer=messages[i];if(customer.role!=='customer'||!customer.text)continue;
  const reply=messages.slice(i+1).find(x=>x.role==='agent'&&x.text);if(!reply)continue;
  const seconds=Math.round((epoch(reply.at)-epoch(customer.at))/1000);
  if(Number.isFinite(seconds)&&seconds>=120&&(!longest||seconds>longest.seconds))longest={seconds,ids:[customer.id,reply.id]};
 }
 if(longest){
  const points=longest.seconds>=300?10:5;
  deduct('slow-reply',points,`顾客发言后人工回复间隔 ${longest.seconds} 秒`,longest.ids);
  warn(longest.seconds>=300?'high':'medium','slow-reply','回复间隔较长；请结合排班、离线状态和会话背景核对。',longest.ids);
 }
 const complained=customers.find(x=>complaint.test(x.text));
 if(complained)warn('medium','complaint','顾客提及投诉或敏感诉求，请核对处理和升级情况。',[complained.id]);
 const promised=agents.find(x=>claim.test(x.text));
 if(promised)warn('low','claim-check','客服提及商品、活动或售后承诺，请结合当时政策核实。',[promised.id]);
 if(Array.isArray(session?.anomalies)&&session.anomalies.length)warn('medium','log-anomaly','日志结构或时间异常：'+session.anomalies.join('、')+'；此项不计入客服扣分。');
 const score=agents.length&&customers.length&&String(session?.agent||'')!=='待识别'?Math.max(0,100-deductions.reduce((sum,x)=>sum+x.points,0)):null;
 return{version:VERSION,score,maxScore:100,deductions,warnings,provisional:true};
}
module.exports={VERSION,scoreConversation};
