(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkbenchMetrics=api;})(globalThis,function(){
 const Life=(typeof module==='object'&&module.exports)?require('./sales-lifecycle'):globalThis.SalesLifecycle;
 function aggregate(rows,year){return Array.from({length:12},(_,i)=>{const period=year+'-'+String(i+1).padStart(2,'0'),matched=rows.filter(r=>r.period===period);return {period,cents:matched.length?matched.reduce((n,r)=>n+Number(r.cents),0):null,days:matched.reduce((n,r)=>n+r.days,0),lastDate:matched.reduce((last,r)=>r.lastDate>last?r.lastDate:last,'')};});}
 // 目标覆盖率与完成率必须与销售额同口径：已闭店的店铺不参与；
 // 传了当期各店销售额时，既无目标又无销售额的空档案也不拖累覆盖率（未传则保留提示，便于发现漏设目标的店铺）。
 function goal(targets,shops,period,shopTotals){
  const totals=shopTotals||null,rows=targets.filter(t=>t.period===period),withTarget=new Set(rows.map(r=>r.shop_id));
  const ids=new Set(shops.filter(s=>Life.operatingInPeriod(s,period)&&Life.effectiveStatus(s)!=='已闭店'&&(totals?withTarget.has(s.id)||Number(totals[s.id]||0)>0:true)).map(s=>s.id)),
   hit=rows.filter(t=>ids.has(t.shop_id)),covered=new Set(hit.map(r=>r.shop_id));
  return {cents:hit.reduce((n,r)=>n+Number(r.cents),0),configured:covered.size,shops:ids.size,missing:shops.filter(s=>ids.has(s.id)&&!covered.has(s.id)).map(s=>(s.data||{}).name||'未命名店铺')};
 }
 function progress(total,covered,target){return covered>0&&target.cents>0&&target.configured===target.shops?Number(total)/target.cents:null;}
 return {aggregate,goal,progress};
});
