(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkbenchMetrics=api;})(globalThis,function(){
 function aggregate(rows,year){return Array.from({length:12},(_,i)=>{const period=year+'-'+String(i+1).padStart(2,'0'),matched=rows.filter(r=>r.period===period);return {period,cents:matched.length?matched.reduce((n,r)=>n+Number(r.cents),0):null,days:matched.reduce((n,r)=>n+r.days,0),lastDate:matched.reduce((last,r)=>r.lastDate>last?r.lastDate:last,'')};});}
 function goal(targets,shops,period){const ids=new Set(shops.filter(s=>s.data.status!=='已闭店').map(s=>s.id)),rows=targets.filter(t=>ids.has(t.shop_id)&&t.period===period);return {cents:rows.reduce((n,r)=>n+Number(r.cents),0),configured:new Set(rows.map(r=>r.shop_id)).size,shops:ids.size};}
 function progress(total,covered,target){return covered>0&&target.cents>0&&target.configured===target.shops?Number(total)/target.cents:null;}
 return {aggregate,goal,progress};
});
