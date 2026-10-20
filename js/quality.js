(async()=>{
'use strict';
/* 客服质检页 —— AI 判定 + 主管复核
   页面只有四块：导入（折叠）→ 质检工作台 → AI 分析明细 → 单条复核
   AI 分析明细是主体，展开成三段：结论概览 / 按客服 / 每条会话 */
const session=WorkbenchSession.createSessionClient();
const get=id=>document.getElementById(id);
function node(tag,text,klass){const el=document.createElement(tag);if(text!=null)el.textContent=String(text);if(klass)el.className=klass;return el;}

let role='viewer';
/* 只有管理员与运营能发起 AI 分析、改判和导入；客服等只读角色只能查看结论 */
function canWrite(){return ['admin','operator'].includes(role);}
let catalog={categories:[],shops:[]};
let aiMeta={criteria:[],configured:false,model:'',rubricVersion:''};
let aiConnected=false;
let previewId=null;
let tab='pending';
let level='';
let page=1;
let rows=[];
let total=0;
let counts=null;
let current=null;
let busy=false;

const KIND={fatal:'红线',critical:'关键项',standard:'非关键项'};

/* ---------------- 通用工具 ---------------- */
function fmtTime(value){return value?String(value).slice(5,16).replace('T',' '):'—';}
function gradeClass(score){
 if(score==null||score==='')return '';
 const n=Number(score);
 return n>=85?'is-good':n>=70?'is-ok':n>=40?'is-warn':'is-bad';
}
function gradeOfScore(n){
 if(n>=95)return{grade:'A+',label:'优秀'};
 if(n>=85)return{grade:'A',label:'良好'};
 if(n>=70)return{grade:'B',label:'合格'};
 if(n>=40)return{grade:'C',label:'待改进'};
 return{grade:'D',label:'不合格'};
}
function setStatus(message){const el=get('status');if(el)el.textContent=message;}
function setAiStatus(message){const el=get('aiStatus');if(el)el.textContent=message;}
function setKpi(id,value){const el=get(id);if(!el)return;const strong=el.querySelector('strong');if(strong)strong.textContent=value;}
async function run(button,task,onError){
 if(button)button.disabled=true;
 try{await task();}
 catch(error){(onError||setAiStatus)(error.message);}
 finally{if(button)button.disabled=false;}
}
function statusChip(status){
 const map={pending:['待复核','qc-pill warn'],reviewed:['已复核','qc-pill ok'],draft:['草稿','qc-pill']};
 const item=map[status]||map.pending;
 return node('span',item[0],item[1]);
}

/* ---------------- 接口 ---------------- */
async function api(action,{method='GET',body,params={},sampling=false}={}){
 const query=new URLSearchParams({action,...params});
 const headers=body instanceof ArrayBuffer?{'x-quality-filename':encodeURIComponent(get('file').files[0].name)}:body?{'Content-Type':'application/json'}:undefined;
 const response=await session.authorizedFetch((sampling?'/api/quality-analysis-v2?':'/api/quality?')+query,{method,headers,body:body instanceof ArrayBuffer?body:body?JSON.stringify(body):undefined});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'请求失败');
 return result.data;
}
async function aiApi(action,{method='GET',body,params={}}={}){
 const query=new URLSearchParams({action,...params});
 const response=await session.authorizedFetch('/api/quality-ai?'+query,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'请求失败');
 return result.data;
}

/* ---------------- 1. 质检工作台 ---------------- */
async function loadStats(){
 if(!aiMeta.configured){
  for(const id of ['kpiReview','kpiPending','kpiDone','kpiRisk'])setKpi(id,'—');
  get('aiOverview').replaceChildren(node('p','尚未配置 DeepSeek API Key，AI 分析暂不可用。','qc-note'));
  get('aiAgents').replaceChildren();
  return;
 }
 const data=await aiApi('stats',{params:{date:get('aiDate').value}});
 const s=data.summary||{},pool=data.pool||{};
 const analyzed=Number(s.analyzed)||0,reviewed=Number(s.reviewed)||0,poolTotal=Number(pool.total)||0;
 counts={pending:Math.max(0,analyzed-reviewed),all:analyzed,done:reviewed};
 setKpi('kpiReview',counts.pending);
 setKpi('kpiPending',Math.max(0,poolTotal-analyzed));
 setKpi('kpiDone',Number(data.reviewedToday)||0);
 setKpi('kpiRisk',Number(s.grade_d)||0);
 renderCounts();
 renderOverview(data);
 renderAgents(data);
 get('importSummary').textContent=poolTotal
  ?`抽检池 ${poolTotal} 条 · 已出 AI 结论 ${analyzed} 条 · 点开可导入新文件`
  :'支持 UTF-8 的 .log / .txt，单文件最大 3 MB';
}
function renderCounts(){
 if(!counts)return;
 get('cntPending').textContent=counts.pending;
 get('cntAll').textContent=counts.all;
 get('cntDone').textContent=counts.done;
}
function renderOverview(data){
 const box=get('aiOverview');
 const s=data.summary||{},pool=data.pool||{};
 const analyzed=Number(s.analyzed)||0;
 if(!analyzed){
  box.replaceChildren(node('p','还没有 AI 分析结果。选好日期后点右上角「批量 AI 分析」，10 条约 1 分钟。','qc-note'));
  return;
 }
 const avg=s.average==null?null:Number(s.average);
 const segments=[
  ['A 级',(Number(s.grade_ap)||0)+(Number(s.grade_a)||0),'#12894a'],
  ['B 级',Number(s.grade_b)||0,'#0665ff'],
  ['C 级',Number(s.grade_c)||0,'#a86a08'],
  ['D 级',Number(s.grade_d)||0,'#d64545']
 ];
 const coverage=Number(pool.total)?Math.round(analyzed/Number(pool.total)*1000)/10:null;

 const c1=node('div',null,'qc-ov-score');
 c1.append(node('span','平均分'));
 const big=node('strong',avg==null?'—':avg.toFixed(1));
 big.className=gradeClass(avg);
 c1.append(big,node('em','/100'));
 const meta=node('div',null,'qc-ov-meta');
 meta.append(node('div',`已分析 ${analyzed} 条`));
 if(coverage!=null)meta.append(node('div',`抽检覆盖 ${coverage}%`));
 if(Number(s.needs_review))meta.append(node('div',`${s.needs_review} 条含「待复核」项`,'qc-ov-flag'));
 c1.append(meta);

 const c2=node('div');
 c2.append(node('div','等级分布','qc-ov-title'));
 const bar=node('div',null,'qc-bar');
 for(const [label,count,color] of segments){
  if(!count)continue;
  const piece=node('i');
  piece.style.width=(count/analyzed*100)+'%';
  piece.style.background=color;
  piece.title=`${label} ${count} 条`;
  bar.append(piece);
 }
 if(!bar.children.length)bar.append(node('i','',''));
 c2.append(bar);
 const legend=node('div',null,'qc-legend');
 for(const [label,count,color] of segments){
  const dot=node('i');
  dot.style.background=color;
  const item=node('span');
  item.append(dot,node('span',label+' '),node('b',count));
  legend.append(item);
 }
 c2.append(legend);

 const c3=node('div');
 c3.append(node('div','最常失分的项','qc-ov-title'));
 const list=node('div',null,'qc-top-list');
 const issues=data.topIssues||[];
 if(!issues.length)list.append(node('p','本批没有被判不合格的评分项。','qc-note'));
 issues.forEach((item,index)=>{
  const row=node('div',null,'qc-top-item');
  row.append(node('span',String(index+1),'qc-rank'),node('span',item.label,'qc-top-label'),node('span',item.times+' 次','qc-cnt'));
  list.append(row);
 });
 c3.append(list);

 box.replaceChildren(c1,c2,c3);
}
function renderAgents(data){
 const box=get('aiAgents');
 const agents=data.agents||[];
 if(!agents.length){box.replaceChildren(node('p','还没有可以按客服汇总的数据。','qc-note'));return;}
 const table=node('table',null,'qc-table');
 const thead=node('thead'),hrow=node('tr');
 for(const [label,width] of [['客服',150],['会话数',86],['平均分',86],['最低分',86],['D 级',72],['主要问题',0]]){
  const th=node('th',label);
  if(width)th.style.width=width+'px';
  hrow.append(th);
 }
 thead.append(hrow);table.append(thead);
 const tbody=node('tbody');
 for(const row of agents){
  const tr=node('tr');
  tr.append(node('td',row.agent||'未识别'));
  tr.append(node('td',row.sessions));
  tr.append(node('td',row.average==null?'—':Number(row.average).toFixed(1),'qc-ai-score-cell '+gradeClass(row.average)));
  tr.append(node('td',row.min_score==null?'—':Number(row.min_score).toFixed(1)));
  const dCell=node('td',Number(row.grade_d)||0);
  if(Number(row.grade_d))dCell.className='qc-ai-score-cell is-bad';
  tr.append(dCell);
  const issues=(row.issues||[]);
  const cell=node('td',null,'qc-ai-marks');
  if(!issues.length)cell.append(node('em','无明显失分项'));
  issues.forEach((item,index)=>{
   if(index)cell.append(document.createTextNode('、'));
   cell.append(node('u',item.label));
  });
  tr.append(cell);
  tbody.append(tr);
 }
 table.append(tbody);
 box.replaceChildren(table);
}

/* ---------------- 3. 每条会话 ---------------- */
async function loadSessions(){
 const params={analyzed:1,page};
 if(tab==='pending')params.status='pending';
 else if(tab==='reviewed')params.status='reviewed';
 if(level)params.level=level;
 const agent=get('filterAgent').value.trim();
 if(agent)params.agent=agent;
 const data=await aiApi('list',{params});
 rows=data.rows||[];
 total=Number(data.total)||0;
 renderSessions();
}
function renderSessions(){
 const box=get('aiSessions');
 const table=node('table',null,'qc-table qc-ai-sessions');
 const thead=node('thead'),hrow=node('tr');
 for(const [label,width] of [['开始时间',104],['客服',132],['AI 分',66],['等级',54],['主要问题',0],['状态',76],['主管分',66],['操作',58]]){
  const th=node('th',label);
  if(width)th.style.width=width+'px';
  hrow.append(th);
 }
 thead.append(hrow);table.append(thead);
 const tbody=node('tbody');
 if(!rows.length){
  const tr=node('tr'),td=node('td','没有符合条件的会话。','qc-note');
  td.colSpan=8;tr.append(td);tbody.append(tr);
 }
 for(const row of rows){
  const marks=row.marks||[];
  const fails=marks.filter(item=>item.status==='fail');
  const pendings=marks.filter(item=>item.status==='pending');
  const tr=node('tr');
  tr.append(node('td',fmtTime(row.started_at),'qc-time'));
  tr.append(node('td',row.agent||'未识别'));
  tr.append(node('td',row.score==null?'—':Number(row.score).toFixed(1),'qc-ai-score-cell '+gradeClass(row.score)));
  tr.append(node('td',row.grade||'—','qc-grade'));
  const issues=node('td',null,'qc-ai-marks');
  if(!fails.length&&!pendings.length)issues.append(node('em','无明显问题 · 抽样校准'));
  fails.forEach((item,index)=>{
   if(index)issues.append(document.createTextNode('、'));
   issues.append(node('u',item.label));
  });
  if(pendings.length)issues.append(node('em',`（另 ${pendings.length} 项待复核）`));
  tr.append(issues);
  const status=node('td');
  status.append(statusChip(row.review_status));
  tr.append(status);
  tr.append(node('td',row.review_score==null?'—':Number(row.review_score).toFixed(1),'qc-ai-score-cell '+(row.review_score==null?'':gradeClass(row.review_score))));
  const op=node('td');
  const button=node('button',row.review_status==='reviewed'?'查看':'复核');
  button.type='button';
  button.onclick=event=>{event.stopPropagation();openReview(row.session_id);};
  op.append(button);tr.append(op);
  tr.onclick=()=>openReview(row.session_id);
  tr.style.cursor='pointer';
  tbody.append(tr);
 }
 table.append(tbody);
 box.replaceChildren(table);
 const pager=get('aiPager');
 pager.replaceChildren();
 const pages=Math.max(1,Math.ceil(total/50));
 const label=`共 ${total} 条`;
 pager.append(node('span',label+(pages>1?` · 第 ${page}/${pages} 页`:'')+` · 按 AI 分从低到高`,'qc-note'));
 if(pages>1){
  const prev=node('button','上一页');prev.type='button';prev.disabled=page<=1;
  prev.onclick=()=>{page=Math.max(1,page-1);run(prev,loadSessions);};
  const next=node('button','下一页');next.type='button';next.disabled=page>=pages;
  next.onclick=()=>{page=Math.min(pages,page+1);run(next,loadSessions);};
  pager.append(prev,next);
 }
 if(level)get('aiSessionsMeta').textContent='仅看 D 级会话，点「全部」取消筛选';
 else get('aiSessionsMeta').textContent='';
}
async function refreshAll(){
 try{await loadStats();}catch(error){setAiStatus(error.message);}
 try{await loadSessions();}catch(error){get('aiSessions').replaceChildren(node('p',error.message,'qc-note'));}
}

/* ---------------- 4. 单条复核 ---------------- */
function flagsFrom(criteria){
 const set=new Set();
 for(const item of criteria){
  if(item.status!=='fail'&&item.status!=='pending')continue;
  for(const evidence of item.evidence||[])if(evidence.messageId!=null)set.add(Number(evidence.messageId));
 }
 return set;
}
function renderChat(messages,flags){
 const box=get('messages');
 box.replaceChildren();
 if(!messages.length){box.append(node('p','这条会话没有可显示的文本消息。','qc-note'));return;}
 for(const message of messages){
  const row=node('div',null,'qc-msg'+(message.role==='agent'?' agent':'')+(flags.has(Number(message.id))?' flag':''));
  row.id='qc-msg-'+message.id;
  row.append(node('span',message.role==='agent'?'客服':'顾客','qc-who'),node('div',message.text||'[无文字内容]','qc-bubble'));
  box.append(row);
 }
}
function jumpTo(id){
 const el=get('qc-msg-'+id);
 if(!el)return;
 el.scrollIntoView({behavior:'smooth',block:'center'});
 el.classList.add('focus');
 setTimeout(()=>el.classList.remove('focus'),2200);
}
function critRow(item,expanded){
 const row=node('div',null,'qc-crit-row '+item.status);
 const name=node('span',null,'qc-crit-name');
 name.append(node('span',item.label));
 if(item.kind!=='standard')name.append(node('small',KIND[item.kind]||''));
 row.append(name);
 row.append(node('span',item.reason||item.note||'','qc-crit-why'));
 const right=node('span',null,'qc-crit-right');
 if(item.kind==='standard'&&item.status==='pass')right.append(node('span',(item.score==null?5:item.score)+' 分','qc-crit-score'));
 const select=node('select');
 select.dataset.criterion=item.id;
 const options=item.status==='pending'
  ?[['','待复核（未定）'],['pass','合格'],['fail','不合格'],['na','不适用']]
  :[['pass','合格'],['fail','不合格'],['na','不适用']];
 for(const [value,label] of options){const option=node('option',label);option.value=value;select.append(option);}
 select.value=item.status==='pending'?'':item.status;
 select.className='qc-crit-select '+(select.value||'pending');
 if(!canWrite())select.disabled=true;
 const aiStatus=item.status,aiScore=item.score;
 select.onchange=()=>{
  const value=select.value;
  if(value===aiStatus){item.status=aiStatus;item.score=aiScore;}
  else{item.status=value||'pending';if(item.kind==='standard')item.score=value==='pass'?5:value==='fail'?1:null;}
  select.className='qc-crit-select '+(value||'pending');
  row.className='qc-crit-row '+item.status;
  renderScore();
 };
 right.append(select);
 row.append(right);
 if(expanded&&(item.evidence||[]).length){
  const evidence=node('div',null,'qc-crit-ev');
  for(const entry of item.evidence.slice(0,3)){
   const chip=node('button','“'+String(entry.quote||'').slice(0,28)+'”');
   chip.type='button';
   chip.title='跳到原文';
   chip.onclick=()=>jumpTo(entry.messageId);
   evidence.append(chip);
  }
  row.append(evidence);
 }
 return row;
}
function renderCriteria(){
 const box=get('aiCriteria');
 box.replaceChildren();
 const order={fail:0,pending:1,pass:2,na:3};
 const list=[...current.criteria].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9));
 const focus=list.filter(item=>item.status==='fail'||item.status==='pending');
 const rest=list.filter(item=>item.status==='pass'||item.status==='na');
 if(focus.length){
  box.append(node('div',`需要处理 ${focus.length} 项`,'qc-crit-group'));
  for(const item of focus)box.append(critRow(item,true));
 }else{
  box.append(node('div','AI 没有标记出问题项，直接确认即可。','qc-crit-group ok'));
 }
 if(rest.length){
  const details=node('details',null,'qc-crit-rest');
  details.append(node('summary',`其余 ${rest.length} 项判定（点开可改判）`));
  const inner=node('div',null,'qc-crit-rest-body');
  for(const item of rest)inner.append(critRow(item,false));
  details.append(inner);
  box.append(details);
 }
}
function computeLocal(criteria){
 const standard=criteria.filter(item=>item.kind==='standard');
 const fatalFail=criteria.some(item=>item.kind==='fatal'&&item.status==='fail');
 const criticalFail=criteria.some(item=>item.kind==='critical'&&item.status==='fail');
 const scored=standard.filter(item=>item.status!=='na'&&item.status!=='pending'&&[5,3,1].includes(Number(item.score)));
 const avg=scored.length?scored.reduce((sum,item)=>sum+Number(item.score),0)/(scored.length*5):1;
 const standardScore=Math.round(avg*30*100)/100;
 const criticalScore=(fatalFail||criticalFail)?0:70;
 const score=Math.round((fatalFail?0:criticalScore+standardScore)*100)/100;
 return{score,...gradeOfScore(score)};
}
function renderScore(){
 if(!current||!current.criteria.length)return;
 const box=get('reviewScore');
 box.replaceChildren();
 box.append(node('span','主管分','qc-score-label'));
 if(current.aiScore!=null){
  box.append(node('span','AI '+Number(current.aiScore).toFixed(1),'qc-score-from'));
  box.append(node('span','→','qc-score-arrow'));
 }
 const local=computeLocal(current.criteria);
 const big=node('b',local.score.toFixed(1));
 big.className=gradeClass(local.score);
 box.append(big,node('span',local.grade+' · '+local.label,'qc-score-grade'));
}
async function openReview(sessionId){
 if(busy)return;
 busy=true;
 try{
  const [detail,result]=await Promise.all([
   api('detail',{sampling:true,params:{id:sessionId}}),
   aiApi('result',{params:{sessionId}}).catch(()=>null)
  ]);
  if(!detail)throw Error('会话不存在');
  const messages=(detail.data&&detail.data.messages)||[];
  current={sessionId,detail,result:null,criteria:[],aiScore:null,aiGrade:null,original:{},note:''};
  get('reviewCard').hidden=false;
  get('reviewMeta').textContent=`#${detail.ordinal} · ${detail.agent} · ${detail.started_at} · ${messages.length} 条消息`;
  const reviewed=detail.status==='reviewed';
  get('reviewStatus').textContent=reviewed?'已复核':'待复核';
  const index=rows.findIndex(row=>row.session_id===sessionId);
  get('reviewProgress').textContent=rows.length?`第 ${index+1} / ${rows.length} 条`:'';
  if(result){
   const analysis=result.data||{};
   current.result=result;
   current.criteria=JSON.parse(JSON.stringify(analysis.criteria||[]));
   current.aiScore=result.score==null?null:Number(result.score);
   current.aiGrade=result.grade||'';
   for(const item of current.criteria)current.original[item.id]=item.status;
   current.note=reviewed&&detail.review?String(detail.review.note||''):'';
   get('reviewAiTag').textContent=`AI ${current.aiScore==null?'—':current.aiScore.toFixed(1)} 分 · ${current.aiGrade||'—'}`;
   get('reviewAiTag').className='qc-pill '+gradeClass(current.aiScore);
   get('reviewNote').value=current.note;
   get('reviewNote').disabled=false;
   get('confirmReview').disabled=false;
   renderChat(messages,flagsFrom(current.criteria));
   renderCriteria();
   renderScore();
  }else{
   get('reviewAiTag').textContent='还没有 AI 结果';
   get('reviewAiTag').className='qc-pill';
   get('reviewNote').value='';
   get('reviewNote').disabled=true;
   get('confirmReview').disabled=true;
   renderChat(messages,new Set());
   get('aiCriteria').replaceChildren(node('p','这条会话还没有做过 AI 分析，无法复核。回到上面点「批量 AI 分析」。','qc-note'));
   get('reviewScore').replaceChildren();
  }
  get('reviewCard').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(error){
  setAiStatus(error.message);
 }finally{
  busy=false;
 }
}

/* ---------------- 启动 ---------------- */
async function loadCatalog(){
 const meta=await api('meta',{sampling:true});
 catalog={categories:meta.categories||[],shops:meta.shops||[]};
 role=meta.role||role;
 const select=get('importShop');
 select.replaceChildren();
 const auto=node('option','自动识别 / 待关联');auto.value='';
 select.append(auto);
 for(const shop of catalog.shops){
  const data=shop.data||{};
  const option=node('option',(data.name||'未命名店铺')+(data.brand?' · '+data.brand:''));
  option.value=shop.id;
  select.append(option);
 }
}
async function loadAiMeta(){
 try{
  const data=await aiApi('meta');
  aiMeta={criteria:data.criteria||[],configured:!!data.configured,model:data.model||'',rubricVersion:data.rubricVersion||''};
  if(!data.configured){
   const badge=get('aiBadge');
   badge.textContent='未配置 DeepSeek API Key';
   badge.className='qc-ai-chip bad';
   get('aiBatch').disabled=true;
   setAiStatus('在项目根目录 .env.local 填写 DEEPSEEK_API_KEY 后重启服务即可启用。');
   return;
  }
  const badge=get('aiBadge');
  badge.textContent=`${data.model} · 规则 ${data.rubricVersion} · 正在自检…`;
  badge.className='qc-ai-chip';
  get('aiBatch').disabled=false;
  const check=await aiApi('verify');
  if(check.ok){
   aiConnected=true;
   badge.textContent=`已连接 ${data.model} · 规则 ${data.rubricVersion}`+(check.balance==null?'':` · 余额 ¥${check.balance.toFixed(2)}`);
   badge.className='qc-ai-chip ok';
   if(check.available===false)setAiStatus('API Key 可用但余额不足，调用会失败，请到 DeepSeek 控制台充值。');
  }else{
   aiConnected=false;
   badge.textContent='API Key 无效';
   badge.className='qc-ai-chip bad';
   get('aiBatch').disabled=true;
   setAiStatus('DeepSeek 拒绝了这个 API Key：'+(check.error||'未知原因'));
  }
 }catch(error){
  const badge=get('aiBadge');
  badge.textContent='AI 服务不可用';
  badge.className='qc-ai-chip bad';
  setAiStatus(error.message);
 }
}

try{
 const identity=await session.getIdentity();
 WorkbenchShell.mountShell({container:get('shell'),activeModule:'quality',identity,onLogout:async()=>{await session.logout();location.replace('/login.html');}});
 role=(identity.user&&identity.user.role)||'viewer';
 if(!canWrite()){
  get('aiBatch').hidden=true;
  get('confirmReview').hidden=true;
  get('reviewNote').disabled=true;
  const imp=document.getElementById('importCard');if(imp)imp.hidden=true;
  const bd=document.getElementById('boardCard');if(bd)bd.classList.add('is-readonly');
 }
 await loadCatalog();
}catch(error){
 location.replace('/login.html?returnTo=%2Fquality.html');
 return;
}

/* 顶部四个 KPI 是快捷入口 */
get('kpiReview').addEventListener('click',()=>switchTab('pending'));
get('kpiDone').addEventListener('click',()=>switchTab('reviewed'));
get('kpiRisk').addEventListener('click',()=>{
 level='d';
 switchTab('all');
});
get('kpiPending').addEventListener('click',()=>{
 document.getElementById('boardCard').scrollIntoView({behavior:'smooth',block:'center'});
 get('aiBatch').focus();
});
for(const id of ['kpiReview','kpiDone','kpiRisk','kpiPending']){
 get(id).addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();get(id).click();}});
}
function switchTab(next){
 tab=next;
 page=1;
 if(next!=='all')level='';
 for(const button of get('aiTabs').querySelectorAll('button[data-tab]'))button.classList.toggle('on',button.dataset.tab===next);
 run(null,loadSessions);
}

/* 分段切换 / 查询 */
for(const button of get('aiTabs').querySelectorAll('button[data-tab]')){
 button.onclick=()=>switchTab(button.dataset.tab);
}
get('search').onclick=()=>{page=1;run(get('search'),loadSessions);};
get('filterAgent').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();page=1;run(get('search'),loadSessions);}});
get('aiDate').onchange=()=>{page=1;refreshAll();};
get('closeDetail').onclick=()=>{get('reviewCard').hidden=true;current=null;};

/* 批量分析 */
get('aiBatch').onclick=()=>run(get('aiBatch'),async()=>{
 const limit=Number(get('aiLimit').value)||10;
 setAiStatus(`正在调用 DeepSeek 分析 ${limit} 条会话，请勿关闭页面…`);
 const data=await aiApi('batch',{method:'POST',body:{date:get('aiDate').value,limit,concurrency:3}});
 setAiStatus(data.total
  ?`本次分析 ${data.total} 条：成功 ${data.ok} 条${data.failed?`，失败 ${data.failed} 条（${(data.results.find(item=>!item.ok)||{}).error||''}）`:''}。`
  :'没有需要分析的会话（当前日期下都已分析过）。');
 await refreshAll();
});

/* 导出 */
get('exportBtn').onclick=()=>run(get('exportBtn'),async()=>{
 const params=new URLSearchParams({action:'export'});
 const date=get('aiDate').value;
 if(date)params.set('date',date);
 const response=await session.authorizedFetch('/api/quality-ai?'+params);
 if(!response.ok){
  const result=await response.json().catch(()=>({}));
  throw Error(result.error||'导出失败');
 }
 const url=URL.createObjectURL(await response.blob());
 const link=node('a');
 link.href=url;
 link.download=`客服质检-${date||'全部日期'}.csv`;
 link.click();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
 setAiStatus('已导出 CSV，可用 Excel 打开。');
});

/* 确认复核 —— 改判后写回 */
get('confirmReview').onclick=async()=>{
 if(!current)return;
 const button=get('confirmReview');
 button.disabled=true;
 try{
  const overrides={};
  for(const item of current.criteria){
   const select=get('aiCriteria').querySelector('select[data-criterion="'+item.id+'"]');
   if(!select||!select.value)continue;
   if(select.value!==current.original[item.id])overrides[item.id]=select.value;
  }
  const doneId=current.sessionId;
  const data=await aiApi('review',{method:'POST',body:{sessionId:doneId,overrides,note:get('reviewNote').value}});
  get('reviewStatus').textContent=`已复核 · 主管分 ${data.review.score}（AI ${data.review.aiScore}）`;
  await refreshAll();
  const nextInQueue=rows.find(row=>row.session_id!==doneId&&row.review_status!=='reviewed');
  const index=rows.findIndex(row=>row.session_id===doneId);
  const fallback=rows[index+1]||rows[index-1];
  const next=tab==='pending'?nextInQueue||fallback:fallback||nextInQueue;
  if(next)await openReview(next.session_id);
  else{current=null;get('reviewCard').hidden=true;}
 }catch(error){
  get('reviewStatus').textContent=error.message;
 }finally{
  button.disabled=!current||!current.result;
 }
};

/* ---------------- 导入聊天记录 ---------------- */
get('file').onchange=()=>{
 previewId=null;
 get('previewBox').hidden=true;
 const file=get('file').files[0];
 setStatus(file?`已选择 ${file.name}，点击「校验与预览」。`:'请选择聊天记录文件。');
};
function renderPreview(data,sampling){
 previewId=data.id;
 get('previewBox').hidden=false;
 const summary=data.summary;
 get('sampleStats').textContent=`默认抽检 ${sampling.requestedRate}%：共 ${sampling.total} 通会话，实际抽检 ${sampling.selected} 通（${sampling.actualRate}%），覆盖 ${sampling.agentCount} 位客服。`+(sampling.coverageRaisedSample?' 为确保每位客服均被抽检，实际数量高于比例名额。':'');
 get('previewStats').replaceChildren(
  ...[['会话',summary.conversations],['消息',summary.messages],['缺少结束标记',summary.missingEnd],['结束时间冲突',summary.endTimeConflicts],['未识别客服',summary.withoutAgent]].map(([label,value])=>{
   const box=node('div',null,'qc-stat');
   box.append(node('strong',value),node('span',label));
   return box;
  })
 );
 get('previewWarning').textContent=summary.withoutAgent
  ?`有 ${summary.withoutAgent} 通会话未识别客服发言，请检查「客服名称关键词」。确认后仍可人工复核。`
  :'预览已完成。确认导入后系统会给出抽检结果。';
 const examples=get('previewExamples');
 examples.replaceChildren();
 for(const item of data.examples||[])examples.append(node('p',`会话 ${item.ordinal} · ${item.agent} · ${item.startedAt} · 证据提示 ${item.evidenceCount} 条${item.anomalies.length?' · 异常：'+item.anomalies.join('、'):''}`));
 setStatus(`已读取 ${data.filename}，请核对预览后确认导入。`);
}
get('preview').onclick=()=>run(get('preview'),async()=>{
 const file=get('file').files[0];
 if(!file)throw Error('请先选择 .log 或 .txt 文件');
 if(!/\.(log|txt)$/i.test(file.name))throw Error('仅支持 LOG、TXT 格式的聊天记录');
 if(!file.size||file.size>3*1024*1024)throw Error('文件不能为空，且不能超过 3 MB');
 setStatus('正在解析聊天记录…');
 const buffer=await file.arrayBuffer();
 const data=await api('preview',{method:'POST',body:buffer,params:{agentHint:get('agentHint').value.trim()}});
 const sampling=await api('preview',{sampling:true,params:{id:data.id,rate:get('rate').value}});
 renderPreview(data,sampling);
},setStatus);
get('rate').onchange=()=>{
 if(!previewId)return;
 run(get('rate'),async()=>{
  const sampling=await api('preview',{sampling:true,params:{id:previewId,rate:get('rate').value}});
  get('sampleStats').textContent=`抽检 ${sampling.requestedRate}%：共 ${sampling.total} 通会话，实际抽检 ${sampling.selected} 通（${sampling.actualRate}%），覆盖 ${sampling.agentCount} 位客服。`+(sampling.coverageRaisedSample?' 为确保每位客服均被抽检，实际数量高于比例名额。':'');
 },setStatus);
};
get('confirm').onclick=()=>run(get('confirm'),async()=>{
 if(!previewId)throw Error('请先预览文件');
 const result=await api('confirm',{sampling:true,method:'POST',body:{id:previewId,rate:Number(get('rate').value),shopId:get('importShop').value||null}});
 get('previewBox').hidden=true;
 setStatus(result.duplicate
  ?'此文件已导入过，已显示已有抽检会话。'
  :`成功导入 ${result.sampling.total} 通会话，抽检 ${result.sampling.selected} 通（${result.sampling.actualRate}%），覆盖 ${result.sampling.agentCount} 位客服。`);
 page=1;
 await refreshAll();
},setStatus);

await loadAiMeta();
await refreshAll();
})();
