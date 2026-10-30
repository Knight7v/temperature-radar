(async()=>{
'use strict';
/* 质检准确率校准 —— 分层抽样 + 主管盲评 + 一致率统计
   流程只有三步：抽一批会话 → 逐条盲评给档位 → 出对照结果。
   页面只有一个刷新入口（refreshProgress），渲染函数之间互不调用，避免递归。 */

const session=WorkbenchSession.createSessionClient();
const get=id=>document.getElementById(id);
function node(tag,text,klass){const el=document.createElement(tag);if(text!=null)el.textContent=String(text);if(klass)el.className=klass;return el;}

const GRADES=[
 {grade:'A+',label:'优秀',hint:'95 分以上'},
 {grade:'A',label:'良好',hint:'85—94 分'},
 {grade:'B',label:'合格',hint:'70—84 分'},
 {grade:'C',label:'待改进',hint:'40—69 分'},
 {grade:'D',label:'不合格',hint:'40 分以下'}
];
const KIND_LABEL={fatal:'红线',critical:'关键项',standard:'非关键项'};

let plan=null;      /* {rubricVersion, size, criteria, grades, progress, pool} */
let rows=[];        /* 本轮样本列表（不含未评条目的 AI 档位） */
let index=0;        /* 当前在 rows 里的位置 */
let current=null;   /* 当前条目的详情 */
let choice='';      /* 当前选择的档位 */
let busy=false;

/* ---------------- 通用 ---------------- */
function fmtTime(value){return value?String(value).slice(5,16).replace('T',' '):'—';}
function pct(value){return value==null?'—':(Math.round(Number(value)*1000)/10)+'%';}
function gradeText(grade){const hit=GRADES.find(item=>item.grade===grade);return hit?`${hit.grade} ${hit.label}`:(grade||'—');}
function toneOf(rate,good,warn){return rate==null?'':rate>=good?'is-good':rate>=warn?'is-warn':'is-bad';}

async function api(action,{method='GET',body,params={}}={}){
 const query=new URLSearchParams({action,...params});
 const response=await session.authorizedFetch('/api/quality-calibration?'+query,{
  method,
  headers:body?{'Content-Type':'application/json'}:undefined,
  body:body?JSON.stringify(body):undefined
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'请求失败');
 return result.data;
}
async function run(button,task){
 if(button)button.disabled=true;
 try{await task();}
 catch(error){get('calStatus').textContent=error.message;}
 finally{if(button)button.disabled=false;}
}

/* ---------------- 进度与池子 ---------------- */
function refreshProgress(){
 const progress=(plan&&plan.progress)||{round:0,total:0,marked:0};
 const total=progress.total||0;
 const marked=progress.marked||0;
 get('kpiTotal').textContent=total||'—';
 get('kpiMarked').textContent=total?marked:'—';
 get('kpiLeft').textContent=total?Math.max(0,total-marked):'—';
 get('kpiPool').textContent=(plan&&plan.pool&&plan.pool.total)||'—';
 get('calStatus').textContent=total
  ? `规则版本 ${plan.rubricVersion}　第 ${progress.round} 轮　已评 ${marked} / ${total} 条`
  : '还没有校准轮次。点「开始新一轮校准」，系统会抽一批会话给您评。';
 const pool=plan&&plan.pool;
 if(pool&&pool.byGrade){
  const parts=GRADES.map(item=>`${item.grade} ${pool.byGrade[item.grade]||0}`).join('　');
  get('poolNote').textContent=`可抽样的会话共 ${pool.total} 条，按档位分布在：${parts}。抽样会刻意保证优秀（A+）和不及格（D）两端都有样本——如果纯随机抽，抽出来大半是 A 档，什么问题都看不出来。`;
 }
}

/* ---------------- 打分面板 ---------------- */
function renderGrades(){
 const box=get('gradeBtns');
 box.replaceChildren();
 for(const item of GRADES){
  const button=node('button',null,'qc-cal-grade'+(choice===item.grade?' on':''));
  button.type='button';
  button.dataset.grade=item.grade;
  button.title=item.hint;
  button.append(node('b',item.grade),node('span',item.label));
  button.addEventListener('click',()=>chooseGrade(item.grade));
  box.append(button);
 }
 const marked=Boolean(current&&current.marked);
 get('saveBtn').disabled=busy||!choice||marked&&choice===((current&&current.human&&current.human.grade)||'');
 get('saveBtn').textContent=marked?'重新保存':'保存并看 AI 结论';
}

function chooseGrade(grade){
 choice=grade;
 get('workStatus').textContent='';
 renderGrades();
}

function renderChat(messages){
 const box=get('messages');
 box.replaceChildren();
 if(!messages.length){box.append(node('p','这条会话没有可显示的文字消息。','qc-note'));return;}
 for(const message of messages){
  const row=node('div',null,'qc-msg'+(message.role==='agent'?' agent':''));
  row.append(node('span',message.role==='agent'?'客服':'顾客','qc-who'),node('div',message.text||'[无文字内容]','qc-bubble'));
  box.append(row);
 }
}

function renderReveal(){
 const box=get('aiReveal');
 box.replaceChildren();
 if(!current||!current.marked||!current.ai){box.hidden=true;return;}
 const ai=current.ai;
 const human=(current.human&&current.human.grade)||'';
 const same=ai.grade===human;
 box.hidden=false;
 const head=node('div');
 head.append(
  node('b','AI 结论：'),
  document.createTextNode(`${ai.grade||'—'}${ai.score==null?'':`（${Number(ai.score).toFixed(1)} 分）`}　`),
  node('span',same?'和您的判断一致':'和您的判断不同',same?'qc-cal-same':'qc-cal-off')
 );
 box.append(head);
 if(ai.summary)box.append(node('div',`AI 的判断依据：${ai.summary}`));
 box.append(node('div','这条已计入一致率统计；要改判断，重新选档位再保存一次即可。','qc-note'));
}

/* ---------------- 条目 ---------------- */
async function openItem(target){
 if(!rows.length)return;
 index=Math.max(0,Math.min(target,rows.length-1));
 const row=rows[index];
 busy=true;
 try{
  const detail=await api('detail',{params:{id:row.id}});
  current=detail;
  choice=detail.marked?((detail.human&&detail.human.grade)||''):'';
  get('itemMeta').textContent=`第 ${index+1} / ${rows.length} 条 · ${detail.agent||'未知客服'} · ${fmtTime(detail.startedAt)}`;
  get('chatMeta').textContent=`${(detail.messages||[]).length} 条消息`;
  renderChat(detail.messages||[]);
  get('issueSel').value=(detail.human&&detail.human.issue)||'';
  get('noteInput').value=(detail.human&&detail.human.note)||'';
  get('workStatus').textContent=detail.marked?'这条已经评过，可以改判断后重新保存':'';
  get('messages').scrollTop=0;
  renderReveal();
 }catch(error){
  get('workStatus').textContent=error.message;
 }finally{
  busy=false;
  renderGrades();
 }
}

async function loadRows(){
 const data=await api('list');
 rows=data.rows||[];
 plan.progress=data.progress||plan.progress;
 refreshProgress();
 if(!rows.length){get('workCard').hidden=true;return;}
 get('workCard').hidden=false;
 const firstUnmarked=rows.findIndex(row=>!row.marked);
 await openItem(firstUnmarked>=0?firstUnmarked:0);
}

async function nextItem(){
 if(!rows.length)return;
 if(!rows.some(row=>!row.marked)){
  await openItem((index+1)%rows.length);
  get('workStatus').textContent='本轮已经全部评完，点「看一致率结果」看结论。';
  return;
 }
 for(let step=1;step<=rows.length;step+=1){
  const target=(index+step)%rows.length;
  if(!rows[target].marked){openItem(target);return;}
 }
}

async function save(){
 if(busy||!current)return;
 if(!choice){get('workStatus').textContent='先选一个档位再保存';return;}
 busy=true;
 get('saveBtn').disabled=true;
 try{
  const data=await api('mark',{
   method:'POST',
   body:{id:current.id,grade:choice,issue:get('issueSel').value,note:get('noteInput').value}
  });
  plan.progress=data.progress||plan.progress;
  const row=rows[index];
  if(row){row.marked=true;row.humanGrade=choice;if(data.ai)row.aiGrade=data.ai.grade;}
  current.marked=true;
  current.human={grade:choice,issue:get('issueSel').value,note:get('noteInput').value};
  if(data.ai)current.ai=data.ai;
  refreshProgress();
  renderReveal();
  get('workStatus').textContent='已保存。看完 AI 结论，按回车或点「换一条」继续';
 }catch(error){
  get('workStatus').textContent=error.message;
 }finally{
  busy=false;
  renderGrades();
 }
}

/* ---------------- 抽样 ---------------- */
function buildIssueOptions(criteria){
 const select=get('issueSel');
 select.replaceChildren();
 const empty=node('option','不指定');
 empty.value='';
 select.append(empty);
 const groups=new Map();
 for(const item of criteria||[]){
  const key=KIND_LABEL[item.kind]||'其他';
  if(!groups.has(key)){
   const group=document.createElement('optgroup');
   group.label=key;
   groups.set(key,group);
   select.append(group);
  }
  const option=node('option',item.label);
  option.value=item.label;
  groups.get(key).append(option);
 }
}

async function startRound(){
 const progress=plan&&plan.progress;
 if(progress&&progress.marked>0){
  const ok=window.confirm(`第 ${progress.round} 轮已经评了 ${progress.marked} 条。开新一轮会换一批会话，上一轮的记录仍保留在统计里。确认继续？`);
  if(!ok)return;
 }
 const data=await api('start',{method:'POST',body:{force:true}});
 plan=Object.assign({},plan,{progress:data.progress,pool:data.pool||plan.pool});
 refreshProgress();
 await loadRows();
 get('workCard').scrollIntoView({behavior:'smooth',block:'start'});
}

/* ---------------- 一致率结果 ---------------- */
function renderKpis(summary){
 const box=get('statsKpis');
 box.replaceChildren();
 const items=[
  {label:'档位完全一致',value:pct(summary.exactRate),hint:`${summary.exact||0} / ${summary.marked||0} 条判定相同`,tone:toneOf(summary.exactRate,0.8,0.6)},
  {label:'差一档以内',value:pct(summary.closeRate),hint:`含完全一致，共 ${summary.close||0} 条`,tone:''},
  {label:'漏判（AI 放过）',value:summary.severeMiss||0,hint:'AI 判良好以上，您判不合格',tone:summary.severeMiss?'is-bad':'is-good'},
  {label:'误伤（AI 判重）',value:summary.severeAlarm||0,hint:'AI 判不合格，您判良好以上',tone:summary.severeAlarm?'is-warn':'is-good'},
  {label:'平均分差',value:summary.avgBias==null?'—':`${summary.avgBias>0?'+':''}${summary.avgBias}`,hint:'正数=AI 偏严，负数=AI 偏松',tone:''}
 ];
 for(const item of items){
  const card=node('div',null,'qc-cal-kpi'+(item.tone?' '+item.tone:''));
  card.append(node('span',item.label),node('strong',item.value),node('small',item.hint));
  box.append(card);
 }
}

function renderMatrix(summary){
 const table=get('statsMatrix');
 table.replaceChildren();
 const head=node('tr');
 head.append(node('th','AI ＼ 主管'));
 for(const item of GRADES)head.append(node('th',item.grade));
 table.append(head);
 for(const aiItem of GRADES){
  const tr=node('tr');
  tr.append(node('th',aiItem.grade));
  for(const humanItem of GRADES){
   const count=(summary.confusion&&summary.confusion[aiItem.grade]&&summary.confusion[aiItem.grade][humanItem.grade])||0;
   const gap=Math.abs(GRADES.findIndex(x=>x.grade===aiItem.grade)-GRADES.findIndex(x=>x.grade===humanItem.grade));
   const cell=node('td',count||'·',count?(gap===0?'qc-cal-hit':gap>=2?'qc-cal-miss':''):'');
   tr.append(cell);
  }
  table.append(tr);
 }
}

function renderMistakes(list){
 const table=get('statsMistakes');
 table.replaceChildren();
 const head=node('tr');
 head.append(node('th','客服'),node('th','AI 档位'),node('th','您的档位'),node('th','差多少'));
 table.append(head);
 if(!list||!list.length){
  const tr=node('tr');
  const cell=node('td','没有分歧，全部一致。','qc-note');
  cell.colSpan=4;
  tr.append(cell);
  table.append(tr);
  return;
 }
 const order=GRADES.map(item=>item.grade);
 for(const item of list){
  const tr=node('tr');
  const gap=Math.abs(order.indexOf(item.aiGrade)-order.indexOf(item.humanGrade));
  tr.append(
   node('td',item.agent||'未知客服'),
   node('td',`${item.aiGrade}${item.aiScore==null?'':`（${Number(item.aiScore).toFixed(1)}）`}`),
   node('td',item.humanGrade),
   node('td',gap>=2?'差两档以上':'差一档')
  );
  table.append(tr);
 }
}

function renderStats(data){
 const summary=data.summary||{};
 const verdict=data.verdict||{};
 get('statsCard').hidden=false;
 get('statsMeta').textContent=`已评 ${data.progress.marked} / ${data.progress.total} 条　规则版本 ${plan.rubricVersion||''}`;
 get('statsHeadline').textContent=verdict.headline||'';
 const details=get('statsDetails');
 details.replaceChildren();
 for(const text of verdict.details||[]){
  details.append(node('div',text,`qc-cal-detail ${verdict.level==='risk'?'risk':verdict.level==='watch'?'watch':''}`));
 }
 renderKpis(summary);
 renderMatrix(summary);
 renderMistakes(data.mistakes||[]);
 const foot=[];
 if(summary.weightedExactRate!=null){
  foot.push(`按全体会话的档位分布加权还原后，总体一致率约 ${pct(summary.weightedExactRate)}（覆盖 ${pct(summary.weightedCoverage)} 的会话档位）。`);
 }
 if(summary.far)foot.push(`另有 ${summary.far} 条判断差了两档以上。`);
 if(!summary.marked)foot.push('还没有评过的样本，先去上面逐条评。');
 get('statsFoot').textContent=foot.join(' ');
}

async function loadStats(){
 const data=await api('stats');
 renderStats(data);
 get('statsCard').scrollIntoView({behavior:'smooth',block:'start'});
}

/* ---------------- 启动 ---------------- */
get('startBtn').addEventListener('click',()=>run(get('startBtn'),startRound));
get('statsBtn').addEventListener('click',()=>run(get('statsBtn'),loadStats));
get('saveBtn').addEventListener('click',save);
get('nextBtn').addEventListener('click',()=>nextItem());

document.addEventListener('keydown',event=>{
 if(get('workCard').hidden||busy)return;
 const tag=(event.target.tagName||'').toLowerCase();
 if(['input','textarea','select'].includes(tag))return;
 const map={'1':'A+','2':'A','3':'B','4':'C','5':'D'};
 if(map[event.key]){event.preventDefault();chooseGrade(map[event.key]);return;}
 if(event.key==='Enter'){
  event.preventDefault();
  if(current&&current.marked)nextItem();else save();
 }
});

try{
 plan=await api('plan');
 buildIssueOptions(plan.criteria||[]);
 refreshProgress();
 if(plan.progress.total){await loadRows();}
}catch(error){
 get('calStatus').textContent=error.message;
}
})();
