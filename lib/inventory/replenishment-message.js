function safe(value,max=120){return String(value??'').replace(/[<>`\r\n]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}

function formatDailyAlert({snapshotDate,rows}){
 const lines=[`## 库存周转每日预警`,`库存快照：${safe(snapshotDate,20)}`];
 for(const row of rows){
  lines.push(`\n**${safe(row.warehouse,60)}** · ${safe(row.name,65)}（${safe(row.entityId,50)}）`);
  for(const alert of row.alerts){
   const raw=Number.isFinite(row.stock)&&row.sales?.[alert.period]>0?row.stock/row.sales[alert.period]*alert.period:null;
   const value=raw===null?row.currentTurnover[alert.period]:raw.toFixed(2);
   lines.push(`${alert.period}天周转 ${value} 天 · ${alert.type==='replenish'?'补货预警':'滞销预警'}`);
  }
 }
 lines.push('\n规则：周转 < 15 天触发补货预警；周转 > 45 天触发滞销预警。');
 return lines.join('\n');
}

function splitDailyAlerts(rows,snapshotDate){
 const batches=[];let current=[];
 for(const row of rows){
  const candidate=[...current,row];
  if(current.length&&Buffer.byteLength(formatDailyAlert({snapshotDate,rows:candidate}),'utf8')>3500){batches.push({snapshotDate,rows:current});current=[row];}
  else current=candidate;
 }
 if(current.length)batches.push({snapshotDate,rows:current});
 return batches;
}

function formatPlanNotice(stage,plan){
 const head=stage==='operator'?'运营已填写补货需求与数量':'供应链已填写补货建议';
 const lines=[`## ${head}`,`日期：${safe(plan.date,20)}`,`仓库：${safe(plan.warehouse,60)}`,`商品：${safe(plan.name||plan.entityId,65)}（${safe(plan.entityId,50)}）`];
 if(stage==='operator')lines.push(`补货需求：${safe(plan.demand,400)}`,`批次1：${plan.batch1} 件；批次2：${plan.batch2} 件；小计：${plan.batch1+plan.batch2} 件`);
 else lines.push(`补货建议：${plan.recommendation} 件`);
 return lines.join('\n').slice(0,3900);
}

module.exports={formatDailyAlert,formatPlanNotice,splitDailyAlerts};
