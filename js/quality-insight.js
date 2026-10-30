(async()=>{
'use strict';
/* 客服质检 · 消费者洞察板块
   回答三个问题：顾客在问什么（售前/售后占比、主题排行）、客服哪里没答好（缺陷类型排行）、
   哪些问题还没闭环（逐条可点开原文）。统计全部来自 /api/quality-insight，不在前端二次计算口径。 */

const session=WorkbenchSession.createSessionClient();
const get=id=>document.getElementById(id);
function node(tag,text,klass){const el=document.createElement(tag);if(text!=null)el.textContent=String(text);if(klass)el.className=klass;return el;}

let meta={topics:[],gapTypes:[],stages:[],configured:false,model:''};
let stats=null;
let role='viewer';
let running=false;
let loaded=false;      /* 有没有真正拉过一次数据（没切到洞察视图前不白跑接口） */
let seq=0;             /* 请求令牌：日期连点两下时，只认最后一次的结果，避免旧数据盖新数据 */
const filters={stage:'',topic:'',gap:'',agent:''};
const SEVERITY_COLOR={high:'#d64545',medium:'#e08b1a',low:'#8b9ab3'};

function canWrite(){return ['admin','operator'].includes(role);}
function setStatus(message){const el=get('insStatus');if(el)el.textContent=message;}
function pct(value){return value==null?'—':Number(value).toFixed(1)+'%';}
function fmtTime(value){return value?String(value).slice(5,16).replace('T',' '):'—';}
/* 洞察不再有自己的日期选择器：口径与页面上方「分析日期」保持一致，
   一处切换，总览 / 会话 / 消费者洞察三个视图同时换。空值 = 全部历史。 */
function currentDate(){const el=get('aiDate');return el?(el.value||''):'';}
function insightVisible(){const view=get('viewInsight');return !!view&&!view.hidden;}
function renderScope(){
 const el=get('insDateLabel');
 if(!el)return;
 const date=currentDate();
 el.textContent=date?`范围：${date}`:'范围：全部日期';
 el.classList.toggle('is-empty',!date);
 el.title=date
  ?`跟随页面上方的「分析日期」：${date}。点这里可以去改（改完三个视图一起换）。`
  :'当前是全部历史（上方「分析日期」为空）。点这里可以选某一天。';
}

async function api(action,{method='GET',params={},body}={}){
 const query=new URLSearchParams({action,...params});
 const response=await session.authorizedFetch('/api/quality-insight?'+query,{
  method,
  headers:body?{'Content-Type':'application/json'}:undefined,
  body:body?JSON.stringify(body):undefined
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'请求失败');
 return result.data;
}

/* ---------------- 初始化 ---------------- */
async function loadMeta(){
 const data=await api('meta');
 meta={topics:data.topics||[],gapTypes:data.gapTypes||[],stages:data.stages||[],configured:!!data.configured,model:data.model||''};
 role=data.role||role;
 const topicSelect=get('insFilterTopic');
 for(const item of meta.topics){const option=node('option',item.label);option.value=item.id;topicSelect.append(option);}
 const gapSelect=get('insFilterGap');
 for(const item of meta.gapTypes){const option=node('option',item.label);option.value=item.id;gapSelect.append(option);}
 if(!canWrite())get('insRun').hidden=true;
 if(!meta.configured){
  get('insRun').disabled=true;
  get('insReport').disabled=true;
  setStatus('未配置 DeepSeek API Key，消费者洞察暂不可用。在 .env.local 填写 DEEPSEEK_API_KEY 后重启服务即可。');
  return;
 }
}

async function loadStats(){
 const token=++seq;
 renderScope();
 const data=await api('stats',{params:{date:currentDate(),limit:200}});
 if(token!==seq)return data;          /* 期间又切了日期，这条结果作废 */
 stats=data;
 loaded=true;
 render();
 return data;
}
/* 切到洞察视图才拉数据：一进质检页就请求一次是白花时间 */
async function ensureLoaded(){
 renderScope();
 if(!loaded)await loadStats();
}
/* 日期变了：已经看过的立刻重拉；还没看过的等切过去再拉，不白跑 */
async function reloadIfLoaded(){
 renderScope();
 if(!loaded)return null;
 return loadStats();
}
function focusDatePicker(){
 const input=get('aiDate');
 if(!input)return;
 input.focus();
 try{input.showPicker&&input.showPicker();}catch(error){}
 input.scrollIntoView({block:'center',behavior:'smooth'});
}

/* ---------------- 渲染 ---------------- */
function kpi(label,value,unit,hint,modifier){
 const box=node('div',null,'qc-ins-kpi'+(modifier?' '+modifier:''));
 box.append(node('span',label));
 const line=node('div',null,'qc-ins-kpi-line');
 line.append(node('strong',value));
 if(unit)line.append(node('em',unit));
 box.append(line);
 if(hint)box.append(node('small',hint));
 return box;
}

function renderKpis(){
 const box=get('insKpis');
 const coverage=(stats&&stats.coverage)||{sessions:0,analyzed:0,pending:0};
 const q=(stats&&stats.questions)||{};
 const analyzed=Number(coverage.analyzed)||0;
 const total=Number(coverage.sessions)||0;
 if(!analyzed){
  box.replaceChildren();
  setStatus(`这批范围共 ${total} 通会话，还没有做消费者洞察。点右上角「开始分析」，每批 25 条，可以随时停。`);
  return;
 }
 const coverageRate=total?Math.round(analyzed/total*1000)/10:null;
 const stageMap=new Map((stats.stages||[]).map(item=>[item.id,item]));
 const pre=stageMap.get('pre_sale')||{sessions:0,rate:0};
 const after=stageMap.get('after_sale')||{sessions:0,rate:0};
 const mixed=stageMap.get('mixed')||{sessions:0,rate:0};

 box.replaceChildren(
  kpi('已分析会话',analyzed,'/ '+total,coverageRate==null?'':'覆盖 '+coverageRate+'%'+(coverage.pending?' · 待分析 '+coverage.pending:''),(coverage.pending?'is-warn':'is-good')),
  kpi('顾客问题',q.total==null?'—':q.total,'条','平均 '+(q.perSession==null?'—':q.perSession)+' 条/会话'),
  kpi('没答清',q.unresolved==null?'—':q.unresolved,'条','占问题 '+pct(q.unresolvedRate),(q.unresolvedRate>=25?'is-bad':q.unresolvedRate>=12?'is-warn':'is-good')),
  kpi('有解答不足的会话',stats.sessionsWithGap==null?'—':stats.sessionsWithGap,'通','占会话 '+pct(stats.sessionsWithGapRate)),
  kpi('售前 : 售后',pre.sessions+' : '+after.sessions,'通',mixed.sessions?'含混合 '+mixed.sessions+' 通':'按会话主问题归类')
 );
 setStatus(`已分析 ${analyzed} 通（共 ${total} 通）${coverage.pending?`，还有 ${coverage.pending} 通没分析`:''}。点击下面任意主题或缺陷可以筛选问题清单。`);
}

function barList(container,items,{onClick,severityOf,meta:metaOf}={}){
 container.replaceChildren();
 if(!items.length){
  container.append(node('p','这批会话里没有统计到这一类。','qc-note'));
  return;
 }
 const max=Math.max(...items.map(item=>Number(item.questions)||0),1);
 items.forEach(item=>{
  const row=node('div',null,'qc-ins-bar');
  const head=node('div',null,'qc-ins-bar-head');
  const label=node('span','','qc-ins-bar-label');
  if(severityOf){const dot=node('i');dot.style.background=SEVERITY_COLOR[severityOf(item)]||'#8b9ab3';label.append(dot);}
  label.append(node('b',item.label));
  const count=node('small',`${item.questions} 条 · ${item.sessions} 通`);
  head.append(label,count);
  const track=node('div',null,'qc-ins-track');
  const fill=node('i');
  fill.style.width=Math.max(3,(Number(item.questions)||0)/max*100)+'%';
  if(severityOf)fill.style.background=SEVERITY_COLOR[severityOf(item)]||'#3b73e8';
  track.append(fill);
  row.append(head,track);
  if(item.unresolvedRate!=null)row.append(node('small','其中没答清 '+pct(item.unresolvedRate),'qc-ins-bar-foot'));
  if(metaOf&&metaOf(item))row.append(node('small',metaOf(item),'qc-ins-bar-foot'));
  if(onClick){
   row.classList.add('is-clickable');
   row.onclick=()=>onClick(item);
   row.title='点击筛选下方问题清单';
  }
  container.append(row);
 });
}

function renderTopics(){
 const all=(stats&&stats.topics)||[];
 // 「其他」放最后：它不是可行动的主题，混在排行里会挤掉真实问题
 const ordered=[...all.filter(item=>item.id!=='other'),...all.filter(item=>item.id==='other')];
 const topics=ordered.slice(0,12);
 barList(get('insTopics'),topics,{
  meta:item=>item.samples&&item.samples[0]?`例：${item.samples[0].text}`:''
 });
 if(ordered.length>topics.length)get('insTopics').append(node('p',`另有 ${ordered.length-topics.length} 类问题条数较少，未在此显示（导出可看全量）。`,'qc-note'));
 let index=0;
 for(const row of get('insTopics').querySelectorAll('.qc-ins-bar')){
  const item=topics[index++];
  if(!item)continue;
  row.classList.add('is-clickable');
  row.onclick=()=>{filters.topic=filters.topic===item.id?'':item.id;syncSelects();openPage=1;renderOpen();};
  row.title='点击筛选下方问题清单';
 }
}

function renderGaps(){
 const all=(stats&&stats.gaps)||[];
 const gaps=all.slice(0,10);
 barList(get('insGaps'),gaps,{severityOf:item=>item.severity,meta:item=>item.samples&&item.samples[0]?`例：${item.samples[0].detail||item.samples[0].text}`:''});
 let index=0;
 for(const row of get('insGaps').querySelectorAll('.qc-ins-bar')){
  const item=gaps[index++];
  if(!item)continue;
  row.classList.add('is-clickable');
  row.onclick=()=>{filters.gap=filters.gap===item.id?'':item.id;syncSelects();openPage=1;renderOpen();};
  row.title='点击筛选下方问题清单';
 }
}

function syncSelects(){
 get('insFilterTopic').value=filters.topic;
 get('insFilterGap').value=filters.gap;
 get('insFilterStage').value=filters.stage;
 get('insFilterAgent').value=filters.agent;
}

function currentOpen(){
 if(!stats)return [];
 return (stats.open||[]).filter(item=>{
  if(filters.topic&&item.topic!==filters.topic)return false;
  if(filters.gap&&!(item.gapTypes||[]).includes(filters.gap))return false;
  if(filters.agent&&!String(item.agent||'').includes(filters.agent))return false;
  if(filters.stage){
   const topic=(meta.topics||[]).find(entry=>entry.id===item.topic);
   const stage=topic&&topic.stage;
   if(stage&&stage!==filters.stage)return false;
  }
  return true;
 });
}

const OPEN_PAGE=20;
let openPage=1;

function renderOpen(){
 const box=get('insOpen');
 const all=currentOpen();
 const totalOpen=(stats&&stats.openTotal)||0;
 const pages=Math.max(1,Math.ceil(all.length/OPEN_PAGE));
 if(openPage>pages)openPage=pages;
 const list=all.slice((openPage-1)*OPEN_PAGE,openPage*OPEN_PAGE);
 const shown=Math.min(all.length,(stats&&stats.open||[]).length);
 get('insOpenMeta').textContent=stats?`共 ${totalOpen} 条没答清的问题${all.length!==totalOpen?`，当前筛选 ${all.length} 条`:''}${totalOpen>shown?`（列表最多取前 ${shown} 条，导出可拿全量）`:''}`:'';
 const table=node('table','','qc-table qc-ins-table');
 const thead=node('thead'),hrow=node('tr');
 for(const [label,width] of [['顾客问题',0],['主题',96],['客服哪里没答好',180],['客服说法',0],['客服',120],['时间',86],['',58]]){
  const th=node('th',label);if(width)th.style.width=width+'px';hrow.append(th);
 }
 thead.append(hrow);table.append(thead);
 const tbody=node('tbody');
 if(!list.length){
  const tr=node('tr'),td=node('td',stats&&stats.questions&&stats.questions.total?'当前筛选下没有没答清的问题。':'还没有分析结果，先点「开始分析」。','qc-note');
  td.colSpan=7;tr.append(td);tbody.append(tr);
 }
 for(const item of list){
  const tr=node('tr');
  const qCell=node('td',null,'qc-ins-q');
  qCell.append(node('span',item.text));
  if(item.repeat)qCell.append(node('em','（重复追问）'));
  tr.append(qCell);
  tr.append(node('td',(meta.topics.find(entry=>entry.id===item.topic)||{}).label||'其他'));
  const gapCell=node('td',null,'qc-ins-gaps');
  for(const gapId of item.gapTypes||[]){
   const gap=(meta.gapTypes.find(entry=>entry.id===gapId)||{});
   const tag=node('span',gap.label||'未说明不足','qc-ins-tag '+(gap.severity||'medium'));
   gapCell.append(tag);
  }
  if(!(item.gapTypes||[]).length)gapCell.append(node('span','看不出','qc-ins-tag low'));
  tr.append(gapCell);
  tr.append(node('td',item.gapDetail||'—','qc-ins-detail'));
  tr.append(node('td',item.agent||'未识别'));
  tr.append(node('td',fmtTime(item.startedAt),'qc-time'));
  const op=node('td');
  const button=node('button','看原文');button.type='button';
  button.onclick=event=>{
   event.stopPropagation();
   if(window.QualityReview)window.QualityReview.open(item.sessionId);
   else setStatus('原文面板未加载，请刷新页面重试。');
  };
  op.append(button);tr.append(op);
  tbody.append(tr);
 }
 table.append(tbody);
 box.replaceChildren(table);
 if(all.length>OPEN_PAGE){
  const pager=node('div',null,'qc-pager');
  pager.append(node('span',`第 ${openPage} / ${pages} 页 · 每页 ${OPEN_PAGE} 条`,'qc-note'));
  const prev=node('button','上一页');prev.type='button';prev.disabled=openPage<=1;
  prev.onclick=()=>{openPage=Math.max(1,openPage-1);renderOpen();};
  const next=node('button','下一页');next.type='button';next.disabled=openPage>=pages;
  next.onclick=()=>{openPage=Math.min(pages,openPage+1);renderOpen();};
  pager.append(prev,next);
  box.append(pager);
 }
}

function renderAgents(){
 const box=get('insAgents');
 const agents=(stats&&stats.agents)||[];
 if(!agents.length){box.replaceChildren(node('p','还没有按客服汇总的数据。','qc-note'));return;}
 const table=node('table','','qc-table qc-ins-table');
 const thead=node('thead'),hrow=node('tr');
 for(const [label,width] of [['客服',150],['会话数',76],['顾客问题',84],['没答清',76],['没答清率',86],['主要不足',0]]){
  const th=node('th',label);if(width)th.style.width=width+'px';hrow.append(th);
 }
 thead.append(hrow);table.append(thead);
 const tbody=node('tbody');
 for(const row of agents){
  const tr=node('tr');
  tr.append(node('td',row.agent||'未识别'));
  tr.append(node('td',row.sessions));
  tr.append(node('td',row.questions));
  tr.append(node('td',row.unresolved));
  const rate=node('td',pct(row.unresolvedRate),'qc-ai-score-cell '+(row.unresolvedRate>=25?'is-bad':row.unresolvedRate>=12?'is-warn':'is-good'));
  tr.append(rate);
  const cell=node('td',null,'qc-ai-marks');
  if(!(row.gaps||[]).length)cell.append(node('em','没有答不清的问题'));
  (row.gaps||[]).forEach((gap,index)=>{
   if(index)cell.append(document.createTextNode('、'));
   cell.append(node('u',gap.label+' '+gap.count));
  });
  tr.append(cell);
  tbody.append(tr);
 }
 table.append(tbody);
 box.replaceChildren(table);
}

function renderReport(){
 const box=get('insReportBox');
 const report=stats&&stats.report;
 if(!report){
  box.replaceChildren(node('p','还没有生成。点右上角「生成总结」，约 20 秒（同一批数据 6 小时内不重复生成）。','qc-note'));
  return;
 }
 box.replaceChildren();
 box.append(node('p',report.headline||'','qc-ins-headline'));
 const findings=node('div',null,'qc-ins-findings');
 for(const item of report.findings||[]){
  const row=node('div',null,'qc-ins-finding '+item.level);
  row.append(node('b',item.title),node('span',item.detail));
  findings.append(row);
 }
 if(findings.children.length)box.append(findings);
 const actions=report.actions||[];
 if(actions.length){
  const table=node('table','','qc-table qc-ins-table');
  const thead=node('thead'),hrow=node('tr');
  for(const [label,width] of [['优先级',64],['做什么',0],['谁来做',96],['解决什么',0]]){
   const th=node('th',label);if(width)th.style.width=width+'px';hrow.append(th);
  }
  thead.append(hrow);table.append(thead);
  const tbody=node('tbody');
  for(const item of actions){
   const tr=node('tr');
   tr.append(node('td',item.priority,'qc-ins-prio '+(item.priority==='P0'?'p0':item.priority==='P1'?'p1':'p2')));
   tr.append(node('td',item.action));
   tr.append(node('td',item.owner||'—'));
   tr.append(node('td',item.why||'—','qc-ins-detail'));
   tbody.append(tr);
  }
  table.append(tbody);
  box.append(node('div','行动建议','qc-ins-sub'),table);
 }
 if((report.watch||[]).length){
  const watch=node('div',null,'qc-ins-watch');
  watch.append(node('b','还要留意'));
  for(const item of report.watch)watch.append(node('span',item));
  box.append(watch);
 }
 if(report.generatedAt||report.createdAt){
  box.append(node('p',`生成于 ${fmtTime(report.createdAt||report.generatedAt)} · ${report.model||meta.model}`+(report.cached?'（缓存结果，数据没变就不重新生成）':''),'qc-note'));
 }
}

function render(){
 renderKpis();
 renderTopics();
 renderGaps();
 renderOpen();
 renderAgents();
 renderReport();
}

/* ---------------- 交互 ---------------- */
function bindFilter(select,key){
 select.onchange=()=>{filters[key]=select.value;openPage=1;renderOpen();};
}
bindFilter(get('insFilterTopic'),'topic');
bindFilter(get('insFilterGap'),'gap');
bindFilter(get('insFilterStage'),'stage');
get('insFilterAgent').oninput=()=>{filters.agent=get('insFilterAgent').value.trim();openPage=1;renderOpen();};
get('insReset').onclick=()=>{
 filters.topic='';filters.gap='';filters.stage='';filters.agent='';
 syncSelects();openPage=1;renderOpen();
};
/* 范围和上面的「分析日期」是同一个：这里不再放日期框，点一下跳过去改 */
get('insDateLabel').onclick=focusDatePicker;
get('insDateLabel').onkeydown=event=>{
 if(event.key==='Enter'||event.key===' '){event.preventDefault();focusDatePicker();}
};

get('insRun').onclick=async()=>{
 if(running)return;
 if(!meta.configured){setStatus('未配置 DeepSeek API Key。');return;}
 running=true;
 const runButton=get('insRun'),stopButton=get('insStop');
 runButton.disabled=true;stopButton.hidden=false;
 let done=0,failed=0;
 try{
  while(running){
   const data=await api('batch',{method:'POST',body:{limit:25,date:currentDate()}});
   if(!data.total)break;
   done+=data.ok;failed+=data.failed;
   const fresh=await loadStats();
   const pending=(fresh.coverage&&fresh.coverage.pending)||0;
   setStatus(`正在分析… 本次已完成 ${done} 条${failed?`（失败 ${failed} 条）`:''}，剩余 ${pending} 条。可以随时点「停止」。`);
   if(!pending||data.total<25)break;
  }
  setStatus(`分析结束：本次完成 ${done} 条${failed?`，失败 ${failed} 条`:''}。`+(failed?' 失败大多是网络或限流，再点一次「开始分析」会接着没做完的继续。':''));
 }catch(error){
  setStatus('分析中断：'+error.message);
 }finally{
  running=false;
  runButton.disabled=false;stopButton.hidden=true;
 }
};
get('insStop').onclick=()=>{running=false;setStatus('已停止，正在收尾（当前这批跑完就停）…');};

get('insReport').onclick=async()=>{
 const button=get('insReport');
 button.disabled=true;
 const original=button.textContent;
 button.textContent='生成中…';
 try{
  const report=await api('report',{method:'POST',body:{date:currentDate()}});
  stats=stats||{};stats.report=report;renderReport();
 }catch(error){
  get('insReportBox').replaceChildren(node('p','生成失败：'+error.message,'qc-note'));
 }finally{
  button.disabled=false;button.textContent=original;
 }
};

get('insExport').onclick=async()=>{
 const params=new URLSearchParams({action:'export'});
 const date=currentDate();
 if(date)params.set('date',date);
 const response=await session.authorizedFetch('/api/quality-insight?'+params);
 if(!response.ok){
  const result=await response.json().catch(()=>({}));
  setStatus(result.error||'导出失败');
  return;
 }
 const url=URL.createObjectURL(await response.blob());
 const link=node('a');
 link.href=url;
 link.download=`消费者洞察-${date||'全部日期'}.csv`;
 link.click();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
 setStatus('已导出 CSV，可用 Excel 打开。');
};

/* 给主脚本（js/quality.js）调用：改「分析日期」或切到洞察视图时用它同步 */
window.QualityInsight={
 ensure(){return ensureLoaded().catch(error=>{setStatus('加载失败：'+error.message);});},
 reload(){return reloadIfLoaded().catch(error=>{setStatus('加载失败：'+error.message);});},
 get date(){return currentDate();}
};

/* ---------------- 启动 ---------------- */
try{
 const identity=await session.getIdentity();
 role=(identity.user&&identity.user.role)||'viewer';
 await loadMeta();
 renderScope();
 /* 只有本来就停在洞察视图（例如带 #insight 打开）时才立刻拉，否则等切过去再拉 */
 if(insightVisible())await loadStats();
 else setStatus('切到「消费者洞察」时再加载当天的数据。');
}catch(error){
 setStatus('加载失败：'+error.message);
}
})();
