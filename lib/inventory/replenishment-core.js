const PERIODS=[7,15,30];

function rawTurnover(stock,outflow,days){
 if(!Number.isFinite(stock)||!Number.isFinite(outflow)||outflow<=0)return null;
 return stock/outflow*days;
}

function turnover(stock,outflow,days){const raw=rawTurnover(stock,outflow,days);return raw===null?null:Math.round(raw*10)/10;}

function classifyTurnover(days){
 if(!Number.isFinite(days))return 'unknown';
 if(days<15)return 'replenish';
 if(days>45)return 'slow';
 return 'normal';
}

function planStage(plan={}){
 const operatorReady=Boolean(String(plan.demand||'').trim())&&Number.isSafeInteger(plan.batch1)&&plan.batch1>=0&&Number.isSafeInteger(plan.batch2)&&plan.batch2>=0;
 const supplyReady=Number.isSafeInteger(plan.recommendation)&&plan.recommendation>=0;
 return {operatorReady,supplyReady};
}

function buildReplenishmentRows(facts,plans=new Map()){
 return facts.filter(f=>f.kind==='sku').map(f=>{
  const plan=plans.get(f.warehouse)||{},stock=Number.isFinite(f.stock)?f.stock:null;
  const currentTurnover={},postBatch1Turnover={},alerts=[];
  for(const days of PERIODS){
   const outflow=f.sales?.[days];
   currentTurnover[days]=turnover(stock,outflow,days);
   postBatch1Turnover[days]=turnover(stock===null||!Number.isSafeInteger(plan.batch1)?null:stock+plan.batch1,outflow,days);
   const type=classifyTurnover(rawTurnover(stock,outflow,days));
   if(type!=='normal'&&type!=='unknown')alerts.push({period:days,type});
  }
  return {warehouse:f.warehouse,entityId:f.entityId,name:f.name||f.entityId,unit:f.unit||'件',stock,sales:{7:f.sales?.[7]??null,15:f.sales?.[15]??null,30:f.sales?.[30]??null},demand:plan.demand??'',recommendation:plan.recommendation??null,batch1:plan.batch1??null,batch2:plan.batch2??null,quantity:Number.isSafeInteger(plan.batch1)&&Number.isSafeInteger(plan.batch2)?plan.batch1+plan.batch2:null,revision:plan.revision??0,currentTurnover,postBatch1Turnover,alerts,...planStage(plan)};
 });
}

module.exports={PERIODS,turnover,classifyTurnover,planStage,buildReplenishmentRows};
