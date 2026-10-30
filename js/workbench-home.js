/* 观星台 · 经营总览（驾驶舱）
   口径约定：
   - 金额一律「分」存储、页面展示万元；时间进度按「数据截止日 / 当月天数」，与完成率同一时间基准。
   - 同比一律同期对比（今年 1-1~今日 vs 去年 1-1~去年今日），不用整月对不完整月。
   - 目标完成率只在目标覆盖完整时给数，否则显示 — 并说明缺哪几家。 */
(async function(){
 'use strict';
 const q=id=>document.getElementById(id);
 const session=WorkbenchSession.createSessionClient();
 const statusEl=q('workbenchStatus');
 const M=WorkbenchMetrics, Life=globalThis.SalesLifecycle;

 const pad=n=>String(n).padStart(2,'0');
 const fmtDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
 const wan=cents=>(Number(cents||0)/1e6).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const int=v=>Math.round(Number(v)||0).toLocaleString('zh-CN');
 const pct1=v=>v==null?'—':(v*100).toFixed(1)+'%';
 const signedPt=v=>v==null?'—':(v>0?'+':'')+(v*100).toFixed(1)+'pt';
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

 let canSales=true;
 try{const who=await session.getIdentity();canSales=['admin','operator','viewer'].includes((who.user||{}).role||'viewer');}catch{}
 const fetchData=async url=>{
  if(!canSales&&String(url).startsWith('/api/sales'))throw new Error('暂无查看权限');
  const r=await session.authorizedFetch(url);
  if(!r.ok)throw new Error(r.status===403?'暂无查看权限':'数据加载失败（'+r.status+'）');
  return (await r.json()).data;
 };

 /* ---------- 时间基准 ---------- */
 const todayStr=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [TY,TM,TD]=todayStr.split('-').map(Number);
 const year=String(TY), prevYear=String(TY-1);
 const month=`${year}-${pad(TM)}`, monthStart=month+'-01';
 const daysInMonth=new Date(TY,TM,0).getDate();
 const state={range:'year',grain:'month',shop:'',brand:'',shops:[],targets:[],charts:{},anchor:'',window:null};

 const filters=()=>{
  const p=[];
  if(state.shop)p.push('shop='+encodeURIComponent(state.shop));
  if(state.brand)p.push('brand='+encodeURIComponent(state.brand));
  return p.length?'&'+p.join('&'):'';
 };
 const minusYear=d=>{const x=new Date(d.getTime());x.setFullYear(d.getFullYear()-1);return x;};

 /* ---------- 汇总工具 ---------- */
 const sumByPeriod=rows=>{const m=new Map();for(const r of rows){const k=r.period;m.set(k,(m.get(k)||0)+Number(r.cents||0));}return m;};
 const periodLabel=(p,grain)=>{
  if(grain==='month')return Number(p.slice(5,7))+'月';
  if(grain==='week')return p.slice(5,10); // 周粒度 period 形如 2026-01-13～2026-01-19，取起始日
  return p.slice(5);
 };
 const shiftPeriodYear=p=>{
  // 周区间跨年（2026-01-13～2026-01-19）两端年份都要减 1，否则会错配到今年
  if(p.includes('～'))return p.replace(/(\d{4})/g,y=>String(Number(y)-1));
  return String(Number(p.slice(0,4))-1)+p.slice(4);
 };
 // 后端周粒度的 period 是「周一～周日」区间字符串，去年同一日期不一定落在同名区间，
 // 所以拿去年对应日期重新推导它所在的周区间，才能真正对齐同期。
 function weekKey(dateStr){
  const x=new Date(dateStr+'T00:00:00Z'),day=x.getUTCDate(),offset=(x.getUTCDay()+6)%7;
  const last=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).getUTCDate();
  return dateStr.slice(0,8)+pad(Math.max(1,day-offset))+'～'+dateStr.slice(0,8)+pad(Math.min(last,day-offset+6));
 }
 // 今年某个周期 → 去年同期对应的周期键
 const prevKeyOf=(p,grain)=>grain==='week'?weekKey(shiftPeriodYear(p.slice(0,10))):shiftPeriodYear(p);

 /* ---------- 半环仪表 ---------- */
 function gauge(canvasId,rate,color){
  const el=q(canvasId);if(!el||typeof Chart==='undefined')return;
  const v=rate==null?0:Math.max(0,Math.min(rate,1));
  if(state.charts[canvasId])state.charts[canvasId].destroy();
  state.charts[canvasId]=new Chart(el,{type:'doughnut',
   data:{datasets:[{data:[v,Math.max(0,1-v)],backgroundColor:[color,'#e6edf9'],borderWidth:0,borderRadius:v>0&&v<1?4:0}]},
   options:{responsive:true,maintainAspectRatio:false,cutout:'76%',rotation:-90,circumference:180,animation:false,
    plugins:{legend:{display:false},tooltip:{enabled:false}}}});
 }

/* ---------- 趋势图 ---------- */
function drawTrend(labels,curData,prevData,curName,prevName){
 const el=q('ghTrend');
 if(state.charts.trend)state.charts.trend.destroy();
 const blue='#0665ff';
 // 只在最后一个有数据的点留一个标记，其余点不画：点太密会把曲线变成「串珠」
 let lastIdx=-1;curData.forEach((v,i)=>{if(v!=null)lastIdx=i;});
 const curPoints=curData.map((_,i)=>(i===lastIdx?3.6:0));
 state.charts.trend=new Chart(el,{type:'line',
  data:{labels,datasets:[
   {label:curName,data:curData,borderColor:blue,fill:true,tension:.32,spanGaps:false,borderWidth:2.2,
    borderCapStyle:'round',borderJoinStyle:'round',
    backgroundColor:c=>{
     const area=c.chart&&c.chart.chartArea;
     if(!area)return 'rgba(6,101,255,.10)';
     const g=c.chart.ctx.createLinearGradient(0,area.top,0,area.bottom);
     g.addColorStop(0,'rgba(6,101,255,.22)');g.addColorStop(.55,'rgba(6,101,255,.06)');g.addColorStop(1,'rgba(6,101,255,0)');
     return g;
    },
    pointRadius:curPoints,pointBackgroundColor:blue,pointBorderColor:'#fff',pointBorderWidth:2,
    pointHitRadius:14,pointHoverRadius:5.5,pointHoverBorderWidth:2.5,pointHoverBorderColor:'#fff',pointHoverBackgroundColor:blue},
   {label:prevName,data:prevData,borderColor:'#c2cee0',borderDash:[5,4],fill:false,tension:.32,spanGaps:false,borderWidth:1.6,
    pointRadius:0,pointHitRadius:14,pointHoverRadius:4,pointHoverBorderWidth:2,pointHoverBorderColor:'#fff',pointHoverBackgroundColor:'#c2cee0'}
  ]},
  options:{responsive:true,maintainAspectRatio:false,animation:false,
   interaction:{mode:'index',intersect:false},
   plugins:{legend:{display:false},tooltip:{displayColors:true,boxWidth:8,boxHeight:8,boxPadding:3,usePointStyle:true,padding:9,cornerRadius:7,
    callbacks:{label:c=>c.dataset.label+'：'+(c.parsed.y==null?'未导入':c.parsed.y.toFixed(2)+' 万元')}}},
   scales:{x:{grid:{display:false},border:{display:false},ticks:{color:'#93a1b5',font:{size:10},maxRotation:0,autoSkipPadding:14}},
    y:{beginAtZero:true,grid:{color:'#eef2f8'},border:{display:false},ticks:{color:'#93a1b5',font:{size:10},callback:v=>Number(v).toLocaleString('zh-CN')}}}}});
 // 卡片刚从 hidden 变可见时容器宽度可能还没结算，补一次 resize 避免图表按默认 300px 绘制
 requestAnimationFrame(()=>{const c=state.charts.trend;if(c)try{c.resize();}catch{}});
}

 /* ---------- 第一张 KPI：跟着时间周期走（本月 / 近7天 / 近30天 / 本年） ---------- */
function renderPeriodKpi(cur,prev){
 const r=state.range;
 const label=r==='month'?'月累计销售额':r==='7'?'近 7 天销售额':r==='30'?'近 30 天销售额':'本年累计销售额';
 const total=Number(cur&&cur.total||0),prevTotal=prev?Number(prev.total||0):0;
 q('kPeriodLabel').textContent=label;
 q('kPeriod').textContent=wan(total);
 q('kPeriodYoy').innerHTML=yoyText(total,prevTotal).html;
 q('kPeriodPrev').textContent=prevTotal?`去年同期 ${wan(prevTotal)} 万`:'';

 let html='';
 // 统一口径：日均 vs 目标日均（月目标/当月天数、年目标/365），四个区间都能横向比；目标完成率交给目标进度卡，避免两处重复
 const days=state.window?Math.round((Date.parse(state.window.end)-Date.parse(state.window.start))/86400000)+1:(r==='7'?7:r==='30'?30:daysInMonth);
 const g=r==='year'?M.goal(state.targets,state.shops,year,cur&&cur.shopTotals):M.goal(state.targets,state.shops,month);
 const goalDaily=g.cents?(r==='year'?g.cents/365:g.cents/daysInMonth):null;
 html=`日均 <i class="num">${wan(days?total/days:0)}</i> 万 · 目标日均 <i class="num">${goalDaily?wan(goalDaily):'—'}</i> 万`;
 q('kPeriodGoal').innerHTML=html;

 // 当期贡献最高的店铺：给大数字一个「钱从哪来」的参照（按单店/单品牌筛选时不再显示）
 const topEl=q('kPeriodTop');
 const totals=cur&&cur.shopTotals;
 if(topEl){
  if(!state.shop&&!state.brand&&totals&&total>0){
   const names=new Map((cur.rows||[]).map(r=>[r.shopId,r.shop]));
   const list=Object.keys(totals).map(id=>({name:names.get(id)||'',cents:Number(totals[id])||0}))
    .filter(x=>x.cents>0&&x.name).sort((a,b)=>b.cents-a.cents);
   if(list.length>1){
    const t=list[0],share=t.cents/total*100;
    topEl.innerHTML=`贡献最高 <b>${esc(t.name)}</b> <i class="num">${share.toFixed(1)}%</i>`;
   }else topEl.textContent='';
  }else topEl.textContent='';
 }
}

/* ---------- KPI ---------- */
 function yoyText(now,prev){
  if(!prev)return {html:'<span class="warnc">基数缺失</span>'};
  const r=now/prev-1;
  const cls=r>=0?'up':'down',arrow=r>=0?'▲':'▼';
  return {html:`<span class="${cls}">${arrow} ${(Math.abs(r)*100).toFixed(1)}%</span>`};
 }

 /* ---------- 主流程 ---------- */
 async function loadDashboard(){
  q('ghRefresh').disabled=true;
  try{
   // 店铺与目标
   if(!state.shops.length){
    const [shops,targets]=await Promise.all([fetchData('/api/sales?action=shops'),fetchData('/api/sales?action=targets').catch(()=>[])]);
    state.shops=shops||[];state.targets=targets||[];
    fillFilters();
   }
   // 第一轮：今年累计（用它确定「数据截止日」）+ 库存/气温/质检
   const [curS,invS,wxS,qiS]=await Promise.allSettled([
    fetchData(`/api/sales?action=overview&start=${year}-01-01&end=${todayStr}&grain=month${filters()}`),
    fetchData('/api/inventory/overview'),
    session.authorizedFetch('/api/weather-summary').then(async r=>{
     if(r.status===503)return {unavailable:'天气数据源未配置'};
     if(!r.ok)throw new Error(r.status===403?'暂无查看权限':'数据加载失败');
     return (await r.json()).data;
    }),
    fetchData('/api/quality?action=stats').catch(()=>null)
   ]);

   const cur=curS.status==='fulfilled'?curS.value:null;
   state.anchor=cur&&cur.rows?cur.rows.reduce((d,r)=>r.lastDate>d?r.lastDate:d,''):'';
   if(!state.anchor)state.anchor=todayStr;

   // 第二轮：趋势区间（窗口终点要用第一轮算出的截止日，所以不能并到第一轮）
   await refreshTrend();

   if(cur){
    renderHeadline(cur,cur.shopTotals);
    renderRanks(cur);
   }else{
    q('ghCoverage').textContent='销售数据加载失败：'+(curS.reason&&curS.reason.message||'未知错误');
    q('kPeriod').textContent='—';
   }

   renderInventory(invS.status==='fulfilled'?invS.value:null);
   renderQuality(qiS.status==='fulfilled'?qiS.value:null);
   renderWeather(wxS.status==='fulfilled'?wxS.value:null);
   renderFresh(cur,invS.status==='fulfilled'?invS.value:null,qiS.status==='fulfilled'?qiS.value:null);
  }catch(e){
   q('ghCoverage').textContent=e.message||'数据加载失败';
  }finally{
   q('ghRefresh').disabled=false;
  }
 }

/* 趋势区间：按筛选条范围 + 粒度算出起止，以及去年同期区间
   终点优先用「数据截止日」，不用今天——数据没导的日子不该算进区间，否则近7天会有两天空白 */
function trendWindow(){
 const endStr=state.anchor||todayStr;
 const [ay,am,ad]=endStr.split('-').map(Number);
 const end=new Date(ay,am-1,ad);
 let start;
 if(state.range==='month')start=new Date(ay,am-1,1);
 else if(state.range==='7'){start=new Date(end);start.setDate(end.getDate()-6);}
 else if(state.range==='30'){start=new Date(end);start.setDate(end.getDate()-29);}
 else start=new Date(ay,0,1);
 if(state.grain==='month'){start=new Date(start.getFullYear(),start.getMonth(),1);}
 if(start>end)start=new Date(end);
 return {start:fmtDate(start),end:fmtDate(end),prevStart:fmtDate(minusYear(start)),prevEnd:fmtDate(minusYear(end))};
}

 /* ---------- 目标进度卡（月/年双半环 + 节奏说明 + 覆盖情况） ---------- */
function renderHeadline(cur,shopTotals){
 const curMonth=sumByPeriod(cur.rows).get(month)||0;
 const yearTotal=Number(cur.total||0);

 const mGoal=M.goal(state.targets,state.shops,month);
 const yGoal=M.goal(state.targets,state.shops,year,shopTotals);
 const mRate=mGoal.cents>0?curMonth/mGoal.cents:null;
 const yRate=yGoal.cents>0?yearTotal/yGoal.cents:null;

 // 时间进度（以数据截止日为准）
 const latest=cur.rows.reduce((d,r)=>r.lastDate>d?r.lastDate:d,'')||todayStr;
 const dayNum=Number(latest.slice(8,10))||TD;
 const timeRate=dayNum/daysInMonth, remain=Math.max(0,daysInMonth-dayNum);

 // 覆盖提示只说到「数据截止日」，不把今天之前没导的两天算成「缺失」，否则和趋势图的缺失数对不上
 const lagDays=Math.round((Date.parse(todayStr)-Date.parse(latest))/86400000);
 const lagFrom=lagDays>0?new Date(Date.parse(latest)+86400000).toISOString().slice(5,10)+' 起未导入':'';
 q('ghCoverage').textContent=`数据截至 ${latest}${lagFrom?`（${lagFrom}）`:''} · 已覆盖 ${cur.covered||0} 个店铺日`;

 // 双半环
 gauge('gMonth',mRate,'#0665ff');
 gauge('gYear',yRate,'#0f9d58');
 q('gMonthVal').innerHTML=mRate==null?'—':(mRate*100).toFixed(1)+'<small>%</small>';
 q('gYearVal').innerHTML=yRate==null?'—':(yRate*100).toFixed(1)+'<small>%</small>';
 q('gMonthVal').style.color='#0665ff';
 q('gYearVal').style.color=yRate!=null&&yRate>=1?'#0f9d58':'#e0811a';
 q('gMonthCap').textContent=mGoal.cents?`月 · ${wan(curMonth)} / ${int(mGoal.cents/1e6)} 万`:'月 · 目标未设置';
 q('gYearCap').textContent=yGoal.cents?`年累计 ${wan(yearTotal)} / ${int(yGoal.cents/1e6)} 万`:'年 · 目标未设置';

 // 一句话说清节奏：时间过到哪、完成到哪、差多少、剩几天要多少、月底预计缺口
 const gap=mGoal.cents?mGoal.cents-curMonth:null;
 const diff=mRate==null?null:timeRate-mRate;
 if(mRate==null){
  const miss=mGoal.missing&&mGoal.missing.length?'（缺 '+mGoal.missing.slice(0,2).join('、')+(mGoal.missing.length>2?' 等':'')+'）':'';
  q('ghGoalNote').innerHTML=`本月目标覆盖 ${mGoal.configured}/${mGoal.shops} 家${miss}，无法计算完成率。<a class="gh-link" href="/sales.html#targets">去补齐目标</a>`;
 }else{
  const forecast=timeRate>0?curMonth/timeRate:null;
  const monthGap=forecast!=null&&mGoal.cents>forecast?mGoal.cents-forecast:0;
  const parts=[
   `时间进度 <b>${(timeRate*100).toFixed(1)}%</b>`,
   `完成 <b>${(mRate*100).toFixed(1)}%</b>`,
   `${diff>0?'落后':'领先'} <b>${(Math.abs(diff)*100).toFixed(1)}pt</b>`,
   `剩 ${remain} 天日均需 <b>${wan(gap>0?gap/remain:0)} 万</b>`,
   monthGap?`月底预计缺口 <b>${int(monthGap/1e6)} 万</b>`:'按当前节奏可完成'
  ];
  q('ghGoalNote').innerHTML=parts.join(' · ');
 }

 // 覆盖情况
 const monthTargets=state.targets.filter(t=>/^\d{4}-(0[1-9]|1[0-2])$/.test(t.period)&&t.period.slice(0,4)===year);
 const byShop=new Map();
 for(const t of monthTargets)byShop.set(t.shop_id,(byShop.get(t.shop_id)||0)+1);
 const partial=[...byShop.values()].filter(n=>n<12).length;
 const inc=state.targets.filter(t=>t.period===year&&Number(t.cents)===0).length;
 q('gfCover').textContent=`${mGoal.configured} / ${mGoal.shops} 家`;
 q('gfPartial').textContent=`${partial} 家`;
 q('gfInc').textContent=`${inc} 家`;
}

 /* ---------- 趋势 ---------- */
 function renderTrend(cur,prev){
  const grain=state.grain;
  const curMap=sumByPeriod(cur.rows||[]),prevMap=sumByPeriod(prev?prev.rows||[]:[]);
  let periods;
  if(grain==='month'&&state.range==='year')periods=Array.from({length:12},(_,i)=>`${year}-${pad(i+1)}`);
  // 只按「今年」的周期铺 x 轴；去年同期的点通过 shiftPeriodYear 映射过来，
  // 不能把两套日期混在一起排序，否则 x 轴会一半今年一半去年。
  else periods=[...curMap.keys()].sort();

  const curData=periods.map(p=>curMap.has(p)?curMap.get(p)/1e6:null);
  const prevData=periods.map(p=>{const k=prevKeyOf(p,grain);return prevMap.has(k)?prevMap.get(k)/1e6:null;});
  const hasAny=curData.some(v=>v!=null)||prevData.some(v=>v!=null);
  q('ghTrendEmpty').hidden=hasAny;

  const curName=year+' 年', prevName=prevYear+' 年';
  q('lgCur').textContent=curName;
  q('lgPrev').textContent=prevName+'（同期）';
  q('ghTrendSub').textContent=`万元 · ${curName} vs ${prevName}`;
  drawTrend(periods.map(p=>periodLabel(p,grain)),curData,prevData,curName,prevName);
  renderPeriodKpi(cur,prev);

  // 区间合计同比
  const curSum=curData.reduce((n,v)=>n+(v||0),0), prevSum=prevData.reduce((n,v)=>n+(v||0),0);
  const box=q('lgYoy');
  if(!prevSum){box.textContent='— 去年同期无数据';box.className='gh-legend-yoy';box.style.color='#93a1b5';}
  else{const r=curSum/prevSum-1;box.textContent=`区间同比 ${r>=0?'+':''}${(r*100).toFixed(1)}%`;box.className='gh-legend-yoy';box.style.color=r>=0?'#d93a3a':'#0f9d58';}
  q('lgTail').textContent=(cur.missing||cur.zeroDays)?`覆盖 ${cur.covered||0} 个店铺日 · 缺失 ${cur.missing||0} 个`:'未导入的日期按空白留出';
 }

 /* ---------- 店铺达成 ---------- */
 function renderRanks(cur){
  const latest=cur.rows.reduce((d,r)=>r.lastDate>d?r.lastDate:d,'')||todayStr;
  const timeRate=(Number(latest.slice(8,10))||TD)/daysInMonth;
  const totals=new Map();
  for(const r of cur.rows)if(r.period===month)totals.set(r.shopId,(totals.get(r.shopId)||0)+Number(r.cents||0));
  const tMap=new Map(state.targets.filter(t=>t.period===month).map(t=>[t.shop_id,Number(t.cents)]));

  let list=state.shops.filter(s=>Life.operatingInRange(s,monthStart,`${month}-${pad(daysInMonth)}`));
  if(state.brand)list=list.filter(s=>(s.data||{}).brand===state.brand);
  if(state.shop)list=list.filter(s=>s.id===state.shop);

  const rows=list.map(s=>{
   const cents=totals.get(s.id)||0, target=tMap.has(s.id)?tMap.get(s.id):null;
   const rate=target>0?cents/target:(target===0?null:null);
   return {name:(s.data||{}).name||'未命名店铺',cents,target,rate,incremental:target===0};
  }).sort((a,b)=>{const x=a.rate,y=b.rate;if(x==null&&y==null)return b.cents-a.cents;if(x==null)return 1;if(y==null)return -1;return y-x;});

  const box=q('ghRanks');
  if(!rows.length){box.innerHTML='<p class="gh-empty">没有可统计的店铺，请先在销售分析里维护店铺档案。</p>';q('ghRankBase').textContent='进度基准线 —';q('ghRankLag').textContent='—';return;}

  box.innerHTML=rows.map((r,i)=>{
   let barCls='',pctText='—',lag=false;
   if(r.rate!=null){barCls=r.rate<timeRate*0.5?'bad':r.rate<timeRate?'warn':'';pctText=(r.rate*100).toFixed(1)+'%';lag=r.rate<timeRate;}
   const nm=esc(r.name)+(r.incremental?'<em>增量</em>':(r.target==null?'<em>未设目标</em>':''));
   return `<div class="gh-rank"><span class="no${i<3?' top':''}">${i+1}</span><span class="nm" title="${esc(r.name)}">${nm}</span>`
    +`<span class="bar"><i class="${barCls}" style="width:${r.rate==null?0:Math.min(100,r.rate*100).toFixed(1)}%"></i><u style="left:${(timeRate*100).toFixed(1)}%"></u></span>`
    +`<span class="pct${lag?' lag':''}">${pctText}</span></div>`;
  }).join('');

  const behind=rows.filter(r=>r.rate!=null&&r.rate<timeRate).length;
  const noTarget=rows.filter(r=>r.target==null&&!r.incremental).length;
  q('ghRankBase').textContent=`进度基准线 ${(timeRate*100).toFixed(1)}%（时间进度 ${latest.slice(5)}）`;
  q('ghRankLag').textContent=noTarget?`${rows.length} 家中 ${noTarget} 家未设目标`:(behind?`${rows.length} 家中 ${behind} 家落后`:'各店均超时间进度');
 }

 /* ---------- 库存监控（独立板块） ---------- */
function renderInventory(inv){
 const box=q('ghInventory');
 if(!inv||!inv.date){
  box.innerHTML='<p class="gh-empty">库存快照不可用，请先导入分仓库存。</p>';
  q('ghInvSub').textContent='快照 —';
  return;
 }
 const rows=inv.rows||[],sum=inv.summary||{};
 const cnt=k=>rows.filter(r=>(r.businessAlerts||[]).includes(k)).length;
 const low=cnt('LOW_STOCK'),over=cnt('OVERSTOCK'),nosale=cnt('NO_SALES_30');
 const wh=new Set(rows.map(r=>r.warehouse).filter(Boolean)).size;
 const avail=Object.values(sum.availableByUnit||{}).reduce((n,v)=>n+Number(v||0),0);
 const lag=Math.round((Date.parse(todayStr)-Date.parse(inv.date))/86400000);

 q('ghInvSub').textContent='快照 '+inv.date.slice(5);
 const cell=(v,l,cls)=>`<div class="gh-metric ${cls||''}"><b class="num">${v}</b><span>${l}</span></div>`;
 box.innerHTML='<div class="gh-metrics">'
  +cell(low,'缺货','red')+cell(over,'积压','amber')+cell(nosale,'30 天无销','')
  +'</div>'
  +`<div class="gh-mod-line">${wh||'—'} 个仓 · ${sum.count||rows.length} 个 SKU · 可用 <i class="num">${int(avail)}</i> 件/套</div>`
  +`<div class="gh-mod-note ${lag>=2?'warn':''}">${lag>=2?`快照已 ${lag} 天未更新，建议补录今天的分仓库存`:`快照 ${inv.date.slice(5)} 已是最新导入`}</div>`;
}

/* ---------- 客服质检（独立板块） ---------- */
function renderQuality(qi){
 const box=q('ghQuality');
 if(!qi){
  box.innerHTML='<p class="gh-empty">质检数据不可用或暂无查看权限。</p>';
  q('ghQualSub').textContent='—';
  return;
 }
 const d=qi.analyzedAt?String(qi.analyzedAt).slice(5,10):(qi.latest||'');
 q('ghQualSub').textContent=d?'分析 '+d:'—';
 const cell=(v,l,cls)=>`<div class="gh-metric ${cls||''}"><b class="num">${v}</b><span>${l}</span></div>`;
 box.innerHTML='<div class="gh-metrics">'
  +cell(qi.needsReview||0,'待复核','blue')
  +cell(qi.average==null?'—':qi.average,'AI 均分','')
  +cell(qi.gradeD||0,'D 级','red')
  +'</div>'
  +`<div class="gh-mod-line">会话池 <i class="num">${int(qi.sessions)}</i> 条 · 主管已评分 <i class="num">${int(qi.reviewed)}</i> 条 · AI 已分析 <i class="num">${int(qi.analyzed)}</i> 条</div>`
  +`<div class="gh-mod-note ${qi.needsReview?'warn':''}">${qi.needsReview?`有 ${qi.needsReview} 条 AI 判定需人工确认，主管评分才是最终结果`:'暂无需人工复核的会话'}</div>`;
}

/* ---------- 气温机会 ---------- */
 function renderWeather(wx){
  const box=q('ghWeather');
  if(!wx||wx.unavailable||!wx.totalCities){
   box.innerHTML='<p class="gh-empty">'+(wx&&wx.unavailable?esc(wx.unavailable):'天气数据暂不可用')+'</p>';
   q('ghWeatherSub').textContent='未来 7 天';
   return;
  }
  const hot=wx.hotCities||[];
  q('ghWeatherSub').textContent='未来 7 天';
  if(!hot.length){
   box.innerHTML=`<p class="gh-empty">${wx.totalCities} 个城市未来 7 天暂无高温重点区，按常规节奏备货即可。</p>`;
   return;
  }
  const top=hot[0];
  const cities=hot.slice(0,5).map(c=>`<span class="gh-wx-city"><b>${esc(c.name)}</b> ${c.maxTemp==null?'—':c.maxTemp+'℃'}</span>`).join('');
  const bars=(top.forecast||[]).slice(0,7);
  const maxT=Math.max.apply(null,bars.concat([35]));
  const minT=Math.min.apply(null,bars.concat([28]));
  const barsHtml=bars.map((t,i)=>{
   const h=Math.max(0,Math.min(1,(t-minT)/Math.max(1,maxT-minT)));
   const px=Math.round(6+h*32);
   const label=i===0?'今天':new Date(Date.parse(todayStr)+i*86400000).getUTCDate();
   return `<div><b>${t}°</b><i style="height:${px}px"></i><span>${label}</span></div>`;
  }).join('');
  const hotDays=top.hotDays||0;
  const tip=hotDays>=3
   ?`<b>建议：</b>${esc(top.name)}未来 7 天有 ${hotDays} 天最高温 ≥35℃，1.5P 挂机可提前 2 天向对应大区仓库铺货。`
   :`<b>提示：</b>高温区集中在${hot.slice(0,3).map(c=>esc(c.name)).join('、')}，可持续关注 7 天曲线再决定铺货节奏。`;
  box.innerHTML=`<div class="gh-wx-top"><strong class="num">${wx.heatFocusCount||hot.length}</strong><span>个高温重点关注区 / ${wx.totalCities} 城</span></div>`
   +`<div class="gh-wx-cities">${cities}</div>`
   +(bars.length?`<div class="gh-wx-week"><div class="gh-wx-week-h">${esc(top.name)}<br>未来 7 天</div><div class="gh-wx-bars">${barsHtml}</div></div>`:'')
   +`<div class="gh-wx-tip">${tip}</div>`;
 }

 /* ---------- 数据新鲜度 ---------- */
 function renderFresh(cur,inv,qi){
  const parts=[];
  const saleDate=cur&&cur.rows?cur.rows.reduce((d,r)=>r.lastDate>d?r.lastDate:d,''):'';
  if(saleDate)parts.push({k:'销售',v:saleDate.slice(5),stale:Math.round((Date.parse(todayStr)-Date.parse(saleDate))/86400000)>=2});
  if(inv&&inv.date)parts.push({k:'库存',v:inv.date.slice(5),stale:Math.round((Date.parse(todayStr)-Date.parse(inv.date))/86400000)>=2});
  if(qi&&(qi.analyzedAt||qi.latest))parts.push({k:'质检',v:String(qi.analyzedAt||qi.latest).slice(5,10),stale:false});
  const anyStale=parts.some(p=>p.stale);
  const text=parts.map(p=>`${p.k} ${p.v}`).join(' · ');

  const fresh=q('workbenchFreshness');
  if(fresh&&text){
   fresh.hidden=false;
   fresh.innerHTML=`<i class="wb-fresh-dot ${anyStale?'warn':'ok'}"></i>${esc(text)}`;
   fresh.title='销售 / 库存 / 质检各自的最新数据日期，黄色表示该模块数据滞后 2 天以上';
  }
  q('ghFootFresh').textContent=text||'—';
 }

 /* ---------- 筛选下拉 ---------- */
 function fillFilters(){
  const brands=[...new Set(state.shops.map(s=>(s.data||{}).brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh'));
  q('ghBrand').innerHTML='<option value="">全部品牌</option>'+brands.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');
  const active=state.shops.filter(s=>Life.operatingInRange(s,todayStr,todayStr));
  q('ghShop').innerHTML='<option value="">全部店铺（'+active.length+' 家在营）</option>'
   +active.map(s=>`<option value="${esc(s.id)}">${esc((s.data||{}).name||'未命名店铺')}</option>`).join('');
 }

 /* ---------- 交互 ---------- */
 function bind(){
  q('ghRange').addEventListener('click',e=>{
   const btn=e.target.closest('button[data-range]');if(!btn)return;
   state.range=btn.dataset.range;
   for(const b of q('ghRange').querySelectorAll('button'))b.classList.toggle('on',b===btn);
   // 区间变了，默认换个更合适的粒度
   state.grain=state.range==='year'?'month':'day';
   for(const b of q('ghGrain').querySelectorAll('button'))b.classList.toggle('on',b.dataset.grain===state.grain);
   refreshTrend();
  });
  q('ghGrain').addEventListener('click',e=>{
   const btn=e.target.closest('button[data-grain]');if(!btn)return;
   state.grain=btn.dataset.grain;
   for(const b of q('ghGrain').querySelectorAll('button'))b.classList.toggle('on',b===btn);
   refreshTrend();
  });
  q('ghShop').addEventListener('change',e=>{state.shop=e.target.value;loadDashboard();});
  q('ghBrand').addEventListener('change',e=>{state.brand=e.target.value;loadDashboard();});
  q('ghRefresh').addEventListener('click',()=>loadDashboard());
 }

async function refreshTrend(){
 const t=trendWindow();
 state.window=t;
 try{
  const [cur,prev]=await Promise.all([
   fetchData(`/api/sales?action=overview&start=${t.start}&end=${t.end}&grain=${state.grain}${filters()}`),
   fetchData(`/api/sales?action=overview&start=${t.prevStart}&end=${t.prevEnd}&grain=${state.grain}${filters()}`)
  ]);
  renderTrend(cur,prev);
 }catch(e){
  q('ghTrendEmpty').hidden=false;q('ghTrendEmpty').textContent=e.message||'趋势加载失败';
  q('kPeriod').textContent='—';q('kPeriodYoy').textContent='—';q('kPeriodGoal').textContent='数据加载失败';
 }
}

 /* ---------- 启动 ---------- */
 try{
  const identity=await session.getIdentity();
  WorkbenchShell.mountShell({container:q('workbenchShell'),activeModule:'home',identity,onLogout:async()=>{await session.logout();location.replace('/login.html');}});
  statusEl.hidden=true;q('ghHome').hidden=false;
  bind();
  await loadDashboard();
 }catch(e){
  if(e.code==='SESSION_EXPIRED')location.replace('/login.html?returnTo='+encodeURIComponent(location.pathname));
  else{statusEl.className='workbench-error';statusEl.textContent=(e.message||'加载失败')+'，请刷新重试。';}
 }
})();
