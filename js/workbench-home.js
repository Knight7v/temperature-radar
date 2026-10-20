/* 观海 · 经营总览（驾驶舱）
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
 const state={range:'year',grain:'month',shop:'',brand:'',shops:[],targets:[],charts:{}};

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
  state.charts.trend=new Chart(el,{type:'line',
   data:{labels,datasets:[
    {label:curName,data:curData,borderColor:'#0665ff',backgroundColor:'rgba(6,101,255,.12)',fill:true,tension:.25,spanGaps:false,borderWidth:2.2,pointRadius:3,pointBackgroundColor:'#fff',pointBorderWidth:1.8,pointHoverRadius:5},
    {label:prevName,data:prevData,borderColor:'#b9c6da',borderDash:[4,3],fill:false,tension:.25,spanGaps:false,borderWidth:1.6,pointRadius:0,pointHoverRadius:4}
   ]},
   options:{responsive:true,maintainAspectRatio:false,animation:false,
    interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+'：'+(c.parsed.y==null?'未导入':c.parsed.y.toFixed(2)+' 万元')}}},
    scales:{x:{grid:{display:false},border:{display:false},ticks:{color:'#93a1b5',font:{size:10},maxRotation:0,autoSkipPadding:14}},
     y:{beginAtZero:true,grid:{color:'#eef2f8'},border:{display:false},ticks:{color:'#93a1b5',font:{size:10},callback:v=>Number(v).toLocaleString('zh-CN')}}}}});
  // 卡片刚从 hidden 变可见时容器宽度可能还没结算，补一次 resize 避免图表按默认 300px 绘制
  requestAnimationFrame(()=>{const c=state.charts.trend;if(c)try{c.resize();}catch{}});
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
   const prevSameEnd=`${prevYear}-${pad(TM)}-${pad(TD)}`;
   const trend={...trendWindow()};

   const [curS,prevYearS,prevSameS,trendS,trendPrevS,invS,wxS,qiS]=await Promise.allSettled([
    fetchData(`/api/sales?action=overview&start=${year}-01-01&end=${todayStr}&grain=month${filters()}`),
    fetchData(`/api/sales?action=overview&start=${prevYear}-01-01&end=${prevYear}-12-31&grain=month${filters()}`),
    fetchData(`/api/sales?action=overview&start=${prevYear}-01-01&end=${prevSameEnd}&grain=month${filters()}`),
    fetchData(`/api/sales?action=overview&start=${trend.start}&end=${trend.end}&grain=${state.grain}${filters()}`),
    fetchData(`/api/sales?action=overview&start=${trend.prevStart}&end=${trend.prevEnd}&grain=${state.grain}${filters()}`),
    fetchData('/api/inventory/overview'),
    session.authorizedFetch('/api/weather-summary').then(async r=>{
     if(r.status===503)return {unavailable:'天气数据源未配置'};
     if(!r.ok)throw new Error(r.status===403?'暂无查看权限':'数据加载失败');
     return (await r.json()).data;
    }),
    fetchData('/api/quality?action=stats').catch(()=>null)
   ]);

   const cur=curS.status==='fulfilled'?curS.value:null;
   const prevYearData=prevYearS.status==='fulfilled'?prevYearS.value:null;
   const prevSame=prevSameS.status==='fulfilled'?prevSameS.value:null;

   if(cur){
    renderHeadline(cur,prevYearData,prevSame);
    renderRanks(cur);
   }else{
    q('ghCoverage').textContent='销售数据加载失败：'+(curS.reason&&curS.reason.message||'未知错误');
    q('kMonth').textContent='—';q('kYear').textContent='—';
   }

   if(trendS.status==='fulfilled'&&trendS.value)renderTrend(trendS.value,trendPrevS.status==='fulfilled'?trendPrevS.value:null);
   else{q('ghTrendEmpty').hidden=false;q('ghTrendEmpty').textContent='趋势数据加载失败';}

   renderTodo(invS.status==='fulfilled'?invS.value:null,qiS.status==='fulfilled'?qiS.value:null);
   renderWeather(wxS.status==='fulfilled'?wxS.value:null);
   renderFresh(cur,invS.status==='fulfilled'?invS.value:null,qiS.status==='fulfilled'?qiS.value:null);
  }catch(e){
   q('ghCoverage').textContent=e.message||'数据加载失败';
  }finally{
   q('ghRefresh').disabled=false;
  }
 }

 /* 趋势区间：按筛选条范围 + 粒度算出起止，以及去年同期区间 */
 function trendWindow(){
  const end=new Date(TY,TM-1,TD);
  let start;
  if(state.range==='month')start=new Date(TY,TM-1,1);
  else if(state.range==='7'){start=new Date(end);start.setDate(end.getDate()-6);}
  else if(state.range==='30'){start=new Date(end);start.setDate(end.getDate()-29);}
  else start=new Date(TY,0,1);
  if(state.grain==='month'){start=new Date(start.getFullYear(),start.getMonth(),1);}
  return {start:fmtDate(start),end:fmtDate(end),prevStart:fmtDate(minusYear(start)),prevEnd:fmtDate(minusYear(end))};
 }

 /* ---------- 顶部三张 KPI ---------- */
 function renderHeadline(cur,prevYearData,prevSame){
  const curMonth=sumByPeriod(cur.rows).get(month)||0;
  const prevMonth=prevSame?sumByPeriod(prevSame.rows).get(`${prevYear}-${pad(TM)}`)||0:0;
  const yearTotal=Number(cur.total||0), prevYearTotal=prevSame?Number(prevSame.total||0):0;

  q('kMonth').textContent=wan(curMonth);
  q('kYear').textContent=wan(yearTotal);

  const mYoy=yoyText(curMonth,prevMonth);q('kMonthYoy').innerHTML=mYoy.html;
  const yYoy=yoyText(yearTotal,prevYearTotal);q('kYearYoy').innerHTML=yYoy.html;

  // 目标
  const mGoal=M.goal(state.targets,state.shops,month);
  const yGoal=M.goal(state.targets,state.shops,year,cur.shopTotals);
  const mRate=mGoal.cents>0?curMonth/mGoal.cents:null;
  const yRate=yGoal.cents>0?yearTotal/yGoal.cents:null;

  q('kMonthTarget').textContent=mGoal.cents?int(mGoal.cents/1e6):'待设置';
  q('kMonthRate').textContent=pct1(mRate);
  q('kYearTarget').textContent=yGoal.cents?int(yGoal.cents/1e6):'待设置';
  q('kYearRate').textContent=pct1(yRate);
  q('kYearRate').className=yRate!=null&&yRate>=1?'num up':'num';

  // 时间进度（以数据截止日为准）
  const latest=cur.rows.reduce((d,r)=>r.lastDate>d?r.lastDate:d,'')||todayStr;
  const dayNum=Number(latest.slice(8,10))||TD;
  const timeRate=dayNum/daysInMonth, remain=Math.max(0,daysInMonth-dayNum);

  q('kRate').textContent=mRate==null?'—':(mRate*100).toFixed(1);
  q('kTime').textContent='时间进度 '+pct1(timeRate);
  q('ghCoverage').textContent=`数据截至 ${latest} · 已覆盖 ${cur.covered||0} 个店铺日${cur.missing?` · 缺失 ${cur.missing} 个`:''}`;

  const gap=mGoal.cents?mGoal.cents-curMonth:null;
  const diff=mRate==null?null:timeRate-mRate;
  q('kGap').innerHTML=diff==null?'<span class="warnc">目标未设置完整</span>'
   :`${diff>0?'落后':'领先'} <span class="${diff>0?'warnc':'down'}">${(Math.abs(diff)*100).toFixed(1)}pt</span>${gap>0?` · 缺 <i class="num">${int(gap/1e6)}</i> 万`:''}`;
  q('kNeed').innerHTML=(gap>0&&remain>0)
   ?`剩余 ${remain} 天 · 日均需 <span class="warnc num">${wan(gap/remain)}</span> 万`
   :(gap!=null&&gap<=0?`已超额 <i class="num">${int(-gap/1e6)}</i> 万`:'目标未设置完整');

  // 目标进度卡
  gauge('gMonth',mRate,'#0665ff');
  gauge('gYear',yRate,'#0f9d58');
  q('gMonthVal').innerHTML=mRate==null?'—':(mRate*100).toFixed(1)+'<small>%</small>';
  q('gYearVal').innerHTML=yRate==null?'—':(yRate*100).toFixed(1)+'<small>%</small>';
  q('gMonthVal').style.color='#0665ff';
  q('gYearVal').style.color=yRate!=null&&yRate>=1?'#0f9d58':'#e0811a';
  q('gMonthCap').textContent=mGoal.cents?`月 · ${wan(curMonth)} / ${int(mGoal.cents/1e6)} 万`:'月 · 目标未设置';
  q('gYearCap').textContent=yGoal.cents?`年 · ${wan(yearTotal)} / ${int(yGoal.cents/1e6)} 万`:'年 · 目标未设置';

  // 说明
  if(mRate==null){
   const miss=mGoal.missing&&mGoal.missing.length?'（缺 '+mGoal.missing.slice(0,2).join('、')+(mGoal.missing.length>2?' 等':'')+'）':'';
   q('ghGoalNote').innerHTML=`本月目标覆盖 ${mGoal.configured}/${mGoal.shops} 家${miss}，无法计算完成率。<a class="gh-link" href="/sales.html#targets">去补齐目标</a>`;
  }else{
   const forecast=timeRate>0?curMonth/timeRate:null;
   const monthGap=forecast!=null&&mGoal.cents>forecast?mGoal.cents-forecast:0;
   q('ghGoalNote').innerHTML=`本月时间进度 ${(timeRate*100).toFixed(1)}%，目标完成 ${(mRate*100).toFixed(1)}%，<b>${diff>0?'落后':'领先'} ${(Math.abs(diff)*100).toFixed(1)} 个百分点</b>`
    +(monthGap?`；按当前节奏，月底预计缺口约 <b>${int(monthGap/1e6)} 万</b>`:'；按当前节奏可完成本月目标');
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
  if(!rows.length){box.innerHTML='<p class="gh-empty">没有可统计的店铺，请先在数据分析管理里维护店铺档案。</p>';q('ghRankBase').textContent='进度基准线 —';q('ghRankLag').textContent='—';return;}

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

 /* ---------- 待处理 ---------- */
 function renderTodo(inv,qi){
  const items=[];let latestSnap='';
  if(inv&&inv.date){
   latestSnap=inv.date;
   const cnt=k=>(inv.rows||[]).filter(r=>(r.businessAlerts||[]).includes(k)).length;
   const low=cnt('LOW_STOCK'),over=cnt('OVERSTOCK'),nosale=cnt('NO_SALES_30');
   if(low)items.push({cls:'red',ic:'缺',title:`${low} 个 SKU 缺货`,desc:'预计可售天数低于「备货天数 + 安全天数」，需尽快补货',href:'/inventory.html',go:'处理'});
   if(over||nosale)items.push({cls:'amber',ic:'积',title:`${over} 个 SKU 积压${nosale?` · ${nosale} 个 30 天无销`:''}`,desc:'预计可售天数超过上限或近 30 天无销量',href:'/inventory.html?view=all',go:'查看'});
  }
  if(qi&&qi.needsReview){
   items.push({cls:'blue',ic:'质',title:`${qi.needsReview} 条会话待复核`,desc:`会话池 ${qi.sessions} 条 · 已评分 ${qi.reviewed} 条 · AI 分析 ${qi.analyzed} 条${qi.average!=null?` · 均分 ${qi.average}`:''}`,href:'/quality.html',go:'复核'});
  }
  if(latestSnap){
   const gap=Math.round((Date.parse(todayStr)-Date.parse(latestSnap))/86400000);
   if(gap>=2)items.push({cls:'gray',ic:'库',title:`库存快照 ${gap} 天未更新`,desc:`最后一次导入 ${latestSnap}，建议补录今天的分仓库存`,href:'/inventory.html',go:'导入'});
  }
  q('ghTodoSub').textContent=items.length?items.length+' 项待办':'暂无待办';
  q('ghTodo').innerHTML=items.length?items.map(t=>`<a class="gh-todo-row" href="${t.href}"><span class="ic ${t.cls}">${t.ic}</span><span class="tx"><b>${esc(t.title)}</b><span>${esc(t.desc)}</span></span><span class="go">${t.go}</span></a>`).join('')
   :'<p class="gh-empty">库存、质检都没有需要立刻处理的事项。</p>';
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
  try{
   const [cur,prev]=await Promise.all([
    fetchData(`/api/sales?action=overview&start=${t.start}&end=${t.end}&grain=${state.grain}${filters()}`),
    fetchData(`/api/sales?action=overview&start=${t.prevStart}&end=${t.prevEnd}&grain=${state.grain}${filters()}`)
   ]);
   renderTrend(cur,prev);
  }catch(e){q('ghTrendEmpty').hidden=false;q('ghTrendEmpty').textContent=e.message||'趋势加载失败';}
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
