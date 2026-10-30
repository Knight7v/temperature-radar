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
let aiMeta={criteria:[],categories:[],configured:false,model:'',rubricVersion:''};
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
let needsOnly=false;      /* 只看「需要人判断」的：没分析、低分、有不合格项 */
let stopAnalyze=false;    /* 全量分析的停止开关 */
const BLIND_RATE=12;      /* 盲评比例：约 12% 的会话先隐藏 AI 分数，让人独立判断 */

/* 盲评样本用会话 ID 稳定哈希挑选：同一条会话永远是同一个结论，不会每次刷新都变 */
function isBlindSample(sessionId){
 let hash=2166136261;
 const text=String(sessionId||'');
 for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)>>>0;}
 return hash%100<BLIND_RATE;
}

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

/* ---------------- 视图切换与抽屉 ----------------
   页面从一个长页拆成三个视图：总览（报表）/ 会话（队列）/ 洞察。
   复核与导入都是右侧抽屉，打开时不改变列表位置，关掉回到原处。 */
const VIEWS=['overview','sessions','insight'];
const viewScroll={overview:0,sessions:0,insight:0};
let activeView='overview';
function switchView(name){
 if(!VIEWS.includes(name))name='overview';
 if(name===activeView)return;
 viewScroll[activeView]=window.scrollY;
 activeView=name;
 for(const button of get('viewTabs').querySelectorAll('button[data-view]')){
  const on=button.dataset.view===name;
  button.classList.toggle('on',on);
  button.setAttribute('aria-selected',on?'true':'false');
 }
 get('viewOverview').hidden=name!=='overview';
 get('viewSessions').hidden=name!=='sessions';
 get('viewInsight').hidden=name!=='insight';
 window.scrollTo({top:viewScroll[name]||0,behavior:'auto'});
 try{history.replaceState(null,'','#'+name);}catch(error){}
 /* 洞察和总览/会话共用顶部「分析日期」，切过去时才第一次拉数据 */
 if(name==='insight'&&window.QualityInsight)window.QualityInsight.ensure();
}
function openDrawer(el){
 if(!el)return;
 el.hidden=false;
 const scrim=get('scrim');
 if(scrim)scrim.hidden=false;
 document.body.classList.add('qc-locked');
 requestAnimationFrame(()=>el.classList.add('is-open'));
}
function closeDrawer(el){
 if(!el)return;
 el.classList.remove('is-open');
 el.hidden=true;
 if(get('reviewCard').hidden&&get('importCard').hidden){
  const scrim=get('scrim');
  if(scrim)scrim.hidden=true;
  document.body.classList.remove('qc-locked');
 }
}
function stepReview(delta){
 if(!current||!rows.length)return;
 const index=rows.findIndex(row=>row.session_id===current.sessionId);
 const target=rows[index+delta];
 if(target)openReview(target.session_id);
}
function updateStepButtons(){
 const index=current?rows.findIndex(row=>row.session_id===current.sessionId):-1;
 const prev=get('prevBtn'),next=get('nextBtn');
 if(prev)prev.disabled=index<=0;
 if(next)next.disabled=index<0||index>=rows.length-1;
}

/* ---------------- 规则速查 ----------------
   19 条规则的只读速查面板。内容直接来自 meta 接口返回的评分标准，与 AI 判定同源，
   规则文件一改这里自动跟着变，不会出现「说明书和实际打分两张皮」。
   从复核抽屉某项点问号可以直达对应规则，并显示这一项在当次会话里的 AI 判定。 */
const RULE_PREFIX={fatal:'R',critical:'K',standard:'S'};
const RULE_KINDNAME={fatal:'红线',critical:'关键项',standard:'非关键项'};
const RULE_WEIGHT={fatal:'命中即整单 0 分',critical:'70 分 · 一票否决',standard:'5 分 · 按档计分'};
const RULE_STATUS={pass:'合格',fail:'不合格',na:'不适用',pending:'待复核'};
let ruleIndex=null;      /* 带 R1/K1/S1 编号的规则表 */
let ruleKind='';         /* 当前的类别筛选 */
let ruleQuery='';        /* 当前的搜索词 */
let ruleOpenAll=false;
let ruleFocusId='';      /* 从复核抽屉点进来的那一项，渲染时高亮 */

function ruleList(){
 if(ruleIndex)return ruleIndex;
 const counters={fatal:0,critical:0,standard:0};
 ruleIndex=(aiMeta.criteria||[]).map(item=>{
  const kind=RULE_KINDNAME[item.kind]?item.kind:'standard';
  counters[kind]+=1;
  return Object.assign({},item,{kind,code:RULE_PREFIX[kind]+counters[kind]});
 });
 return ruleIndex;
}
function ruleSearchText(item){
 const parts=[item.code,item.label,item.definition||''];
 for(const key of ['failWhen','passWhen','naWhen'])for(const line of(item[key]||[]))parts.push(line);
 if(item.scoring)for(const key of Object.keys(item.scoring))parts.push(String(item.scoring[key]));
 return parts.join(' ').toLowerCase();
}
/* 当次会话在这一项上的 AI 判断：盲评没展开时不显示，否则等于提前泄题 */
function ruleJudgement(id){
 if(!current||!Array.isArray(current.criteria))return null;
 if(current.blind&&!current.revealed)return null;
 return current.criteria.find(item=>item.id===id)||null;
}
function ruleCard(item,open){
 const art=node('article',null,'qc-rl is-'+item.kind+(open?' is-open':'')+(item.id===ruleFocusId?' is-hit':''));
 art.dataset.id=item.id;
 art.dataset.kind=item.kind;
 const head=node('button',null,'qc-rl-head');
 head.type='button';
 head.setAttribute('aria-expanded',open?'true':'false');
 head.append(node('span',item.code,'qc-rl-code'));
 const name=node('span',null,'qc-rl-name');
 name.append(node('b',item.label),node('em',`${RULE_KINDNAME[item.kind]} · ${RULE_WEIGHT[item.kind]}`));
 head.append(name,node('span',open?'收起':'展开','qc-rl-caret'));
 art.append(head,node('p',item.definition||'','qc-rl-def'));

 const body=node('div',null,'qc-rl-body');
 const hit=ruleJudgement(item.id);
 if(hit){
  const now=node('div',null,'qc-rl-now '+hit.status);
  now.append(node('b','本条 AI 判定：'+String(RULE_STATUS[hit.status]||hit.status||'待复核')
   +(item.kind==='standard'&&hit.score!=null?`（${hit.score} 分）`:'')));
  if(hit.reason)now.append(node('span',hit.reason));
  for(const entry of(hit.evidence||[]).slice(0,2))now.append(node('q',String(entry.quote||'')));
  body.append(now);
 }
 for(const [key,label] of [['failWhen','判不合格'],['passWhen','判合格'],['naWhen','判不适用']]){
  const lines=item[key]||[];
  if(!lines.length)continue;
  const grp=node('div',null,'qc-rl-grp '+key.replace('When',''));
  grp.append(node('b',label));
  const list=node('ul');
  for(const line of lines)list.append(node('li',line));
  grp.append(list);
  body.append(grp);
 }
 if(item.scoring){
  const grp=node('div',null,'qc-rl-grp scoring');
  grp.append(node('b','给分档（5 / 3 / 1）'));
  const list=node('ul');
  for(const key of ['5','3','1'])if(item.scoring[key])list.append(node('li',`${key} 分 —— ${item.scoring[key]}`));
  grp.append(list);
  body.append(grp);
 }
 if(item.appliesTo&&item.appliesTo.length){
  /* 咨询场景名称以评分标准自带的 categories 为准，店铺分类只作补充，避免露出英文 id */
  const catMap=new Map([...(catalog.categories||[]),...(aiMeta.categories||[])].map(entry=>[entry.id,entry.label]));
  const stages=item.appliesTo.map(id=>catMap.get(id)||id);
  body.append(node('p','只在以下咨询场景里判这一项：'+stages.join('、'),'qc-rl-scope'));
 }
 art.append(body);
 head.onclick=()=>{
  const on=art.classList.toggle('is-open');
  head.setAttribute('aria-expanded',on?'true':'false');
  head.lastChild.textContent=on?'收起':'展开';
 };
 return art;
}
function renderRules(keepScroll){
 const box=get('rulesList');
 if(!box)return;
 /* 换搜索词或换类别后内容变短，旧滚动位置会卡在半张卡片中间，回到顶部 */
 const keep=keepScroll?box.scrollTop:0;
 const all=ruleList();
 const counts={fatal:0,critical:0,standard:0};
 for(const item of all)counts[item.kind]+=1;
 const setCount=(id,value)=>{const el=get(id);if(el)el.textContent=value;};
 setCount('rtAll',all.length);setCount('rtFatal',counts.fatal);setCount('rtCritical',counts.critical);setCount('rtStandard',counts.standard);
 for(const button of get('rulesTabs').querySelectorAll('button[data-kind]')){
  const on=button.dataset.kind===ruleKind;
  button.classList.toggle('on',on);
  button.setAttribute('aria-selected',on?'true':'false');
 }
 box.replaceChildren();
 if(!all.length){
  box.append(node('p','规则还没加载出来。关掉重开一次；如果还是空，说明接口没连上，可以让管理员看一眼服务状态。','qc-note'));
  return;
 }
 const tokens=ruleQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
 const visible=all.filter(item=>{
  if(ruleKind&&item.kind!==ruleKind)return false;
  if(!tokens.length)return true;
  const text=ruleSearchText(item);
  return tokens.every(token=>text.includes(token));
 });
 if(!visible.length){
  const empty=node('div',null,'qc-rules-empty');
  empty.append(node('p',`没有匹配「${ruleQuery.trim()}」的规则。`));
  empty.append(node('p','试个更短的词：返现、单字、链接、时效、发票、投诉、退换货。','qc-note'));
  const reset=node('button','清空筛选','');
  reset.type='button';
  reset.onclick=()=>{
   ruleKind='';ruleQuery='';
   const input=get('rulesSearch');if(input)input.value='';
   renderRules();
   const search=get('rulesSearch');if(search)search.focus();
  };
  empty.append(reset);
  box.append(empty);
 }else{
  /* 搜索时自动展开命中项：速查是「马上看到答案」，不该再让人点一次 */
  for(const item of visible)box.append(ruleCard(item,ruleOpenAll||tokens.length>0||item.id===ruleFocusId));
 }
 const meta=get('rulesMeta');
 if(meta)meta.textContent=tokens.length
  ?`匹配 ${visible.length} 条 / 共 ${all.length} 条`
  :`共 ${all.length} 条 · 红线 ${counts.fatal} · 关键项 ${counts.critical} · 非关键项 ${counts.standard}`;
 box.scrollTop=keep;
}
function renderRuleScale(){
 const box=get('rulesScale');
 if(!box)return;
 box.replaceChildren();
 const chips=[
  ['100 分结构','关键项 70 + 非关键项 30'],
  ['红线','任一命中 → 整单 0 分'],
  ['关键项','任一不合格 → 70 分全扣'],
  ['非关键项','7 项 × 5/3/1 档'],
  ['等级','A+ ≥95 · A ≥85 · B ≥70 · C ≥40 · D <40']
 ];
 for(const [title,text] of chips){
  const chip=node('span',null,'qc-rules-chip');
  chip.append(node('b',title),node('span',text));
  box.append(chip);
 }
 const ver=get('rulesVer');
 if(ver)ver.textContent=(aiMeta.rubricVersion||'')+(aiMeta.model?` · ${aiMeta.model}`:'');
}
function scrollRulesTo(id){
 const box=get('rulesList');
 if(!box||!id)return;
 const el=box.querySelector(`article.qc-rl[data-id="${id}"]`);
 if(!el)return;
 const offset=el.getBoundingClientRect().top-box.getBoundingClientRect().top+box.scrollTop;
 box.scrollTop=Math.max(0,offset-10);
 setTimeout(()=>el.classList.remove('is-hit'),2600);
}
function openRules(criterionId){
 const card=get('rulesCard');
 if(!card)return;
 ruleFocusId=criterionId||'';
 ruleKind='';
 ruleQuery='';
 const input=get('rulesSearch');
 if(input)input.value='';
 renderRuleScale();
 renderRules();
 card.hidden=false;
 document.body.classList.add('qc-locked');
 requestAnimationFrame(()=>card.classList.add('is-open'));
 if(criterionId)requestAnimationFrame(()=>scrollRulesTo(criterionId));
 else{const box=get('rulesList');if(box)box.scrollTop=0;if(input)input.focus();}
 /* 规则还没加载出来（接口慢或刚打开页面就点了）：补一次，回来再看在不在，在就重画 */
 if(!ruleList().length)loadAiMeta().then(()=>{
  ruleIndex=null;
  if(get('rulesCard').hidden)return;
  renderRuleScale();
  renderRules();
  if(ruleFocusId)scrollRulesTo(ruleFocusId);
 }).catch(()=>{});
}
function closeRules(){
 const card=get('rulesCard');
 if(!card||card.hidden)return;
 card.classList.remove('is-open');
 card.hidden=true;
 ruleFocusId='';
 if(get('reviewCard').hidden&&get('importCard').hidden)document.body.classList.remove('qc-locked');
}

/* ---------------- 接口 ---------------- */
async function api(action,{method='GET',body,params={},sampling=false,filename}={}){
 const query=new URLSearchParams({action,...params});
 const headers=body instanceof ArrayBuffer?{'x-quality-filename':encodeURIComponent(filename||get('file').files[0].name)}:body?{'Content-Type':'application/json'}:undefined;
 const response=await session.authorizedFetch((sampling?'/api/quality-analysis-v2?':'/api/quality?')+query,{method,headers,body:body instanceof ArrayBuffer?body:body?JSON.stringify(body):undefined});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'请求失败');
 return result.data;
}
/* 铁律：页面顶部的「分析日期」是质检页唯一的日期来源，下方所有视图（总览 / 会话 / 消费者洞察）
   以及以后新增的任何 tab 都必须跟它走。统一在这里注入 date，不让各个 tab 自己拼参数——
   以前「会话」列表和总览里的「高风险预览」漏传 date，就出现过上面选 10-25、下面还列着
   3 月会话的错位。新增只读接口时，把 action 名加进 DATE_ACTIONS 即可，不要再单独传日期。 */
const DATE_ACTIONS=new Set(['list','stats','export']);
async function aiApi(action,{method='GET',body,params={}}={}){
 const input=get('aiDate');
 const merged={...params};
 if(DATE_ACTIONS.has(action)&&input&&!('date' in merged))merged.date=input.value||'';
 const query=new URLSearchParams({action,...merged});
 const response=await session.authorizedFetch('/api/quality-ai?'+query,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'请求失败');
 return result.data;
}

/* ---------------- 1. 质检工作台 ----------------
   「分析日期」默认 = 最近一次导入那批会话的发生日期，不是今天也不是空（空=全库）。
   主管每天进来就是看昨天/今天刚导的那批，默认值必须直接落在那一批上。 */
let dateDefaulted=false;
async function loadStats(){
 if(!aiMeta.configured){
  for(const id of ['kpiReview','kpiPending','kpiDone','kpiRisk'])setKpi(id,'—');
  get('aiOverview').replaceChildren(node('p','尚未配置 DeepSeek API Key，AI 分析暂不可用。','qc-note'));
  get('aiAgents').replaceChildren();
  return;
 }
 const data=await aiApi('stats',{params:{date:get('aiDate').value}});
 const input=get('aiDate');
 const latest=data.latest||null;
 const latestTitle=latest&&latest.date?`最近一次导入：${latest.date}（${latest.filename}，${latest.sessions} 通）。改这里可以看别的日期。`:'';
 if(!dateDefaulted){
  dateDefaulted=true;
  if(latestTitle&&latest.date&&!input.value){
   input.value=latest.date;
   input.title=latestTitle;
   /* 洞察视图可能已经先加载过（带 #insight 打开时），这里补一次同步 */
   if(window.QualityInsight)window.QualityInsight.reload();
   return refreshAll();      /* 换日期重拉一遍，否则首屏显示的是全库数字 */
  }
 }
 if(latestTitle&&!input.title)input.title=latestTitle;
 const s=data.summary||{},pool=data.pool||{};
 const analyzed=Number(s.analyzed)||0,reviewed=Number(s.reviewed)||0;
 /* 三个口径不能混：visible=列表能看到的（抽检∪已分析），sampledTotal=本次抽检，
    sampledAnalyzed=抽检里已出结论的。用混了就会出现「未分析」是负数或者对不上 */
 const visible=Number(pool.total)||0;
const sampledTotal=Number(pool.sampled||pool.total)||0;
const sampledAnalyzed=Number(pool.sampled_analyzed)||0;
/* 京小智的答复在导出里是「暂不支持展示」的占位符，内容缺失，打出来的分是假的。
   这类会话照样进列表能看原文，但不计入「待分析」，否则会永远挂着一批做不完的活 */
const skipped=Number(pool.sampled_skipped)||0;
/* 四个数一律用后端算好的 pool 字段，前端不再自己相减：
   pending / todo / all / done 必须和四个 tab 的列表条数一一对上，否则主管会发现数字不一致 */
const todo=pool.sampled_todo!=null?Number(pool.sampled_todo)||0:Math.max(0,sampledTotal-sampledAnalyzed-skipped);
 counts={
  pending:pool.pending!=null?Number(pool.pending)||0:Math.max(0,analyzed-reviewed),
  todo,
  all:visible,
  done:pool.reviewed!=null?Number(pool.reviewed)||0:reviewed
 };
 setKpi('kpiReview',counts.pending);
 setKpi('kpiPending',todo);
 setKpi('kpiDone',Number(data.reviewedToday)||0);
 setKpi('kpiRisk',Number(s.grade_d)||0);
 renderCounts();
 renderOverview(data);
 renderAgents(data);
 get('importSummary').textContent=sampledTotal
  ?`本期抽检 ${sampledTotal} 条 · 已出 AI 结论 ${sampledAnalyzed} 条${skipped?` · ${skipped} 条京小智回复未导出（不评分，可看原文）`:''} · 点开可导入新文件`
  :'支持 UTF-8 的 .log / .txt，单文件最大 3 MB';
}
function renderCounts(){
 if(!counts)return;
 get('cntPending').textContent=counts.pending;
 if(get('cntTodo'))get('cntTodo').textContent=counts.todo;
 get('cntAll').textContent=counts.all;
 const nav=get('navCntAll');if(nav)nav.textContent=counts.all;
 get('cntDone').textContent=counts.done;
}
function renderOverview(data){
 const box=get('aiOverview');
 const s=data.summary||{},pool=data.pool||{};
 const analyzed=Number(s.analyzed)||0;
 /* 高风险卡只在真有 D 级会话时出现，避免空卡占位 */
 const riskTotal=Number(s.grade_d)||0;
 if(get('riskCount'))get('riskCount').textContent=riskTotal;
 if(get('riskCard'))get('riskCard').hidden=!riskTotal;
 if(!analyzed){
  box.replaceChildren(node('p','还没有 AI 分析结果。点右上角「分析全部未分析」，会把本次抽检的会话全部跑一遍（大约 20~30 秒一批，可随时停）。','qc-note'));
  return;
 }
 const avg=s.average==null?null:Number(s.average);
 const segments=[
  ['A 级',(Number(s.grade_ap)||0)+(Number(s.grade_a)||0),'#12894a'],
  ['B 级',Number(s.grade_b)||0,'#0665ff'],
  ['C 级',Number(s.grade_c)||0,'#a86a08'],
  ['D 级',Number(s.grade_d)||0,'#d64545']
 ];
 // 覆盖率的分母要扣掉「机器人回复未导出」的会话，否则分母永远追不上
 const coverageBase=Math.max(0,Number(pool.sampled||pool.total)-(Number(pool.sampled_skipped)||0));
 const coverage=coverageBase?Math.round((Number(pool.sampled_analyzed)||0)/coverageBase*1000)/10:null;

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

/* 总览页的「优先处理」：直接列 5 条 D 级会话，点一条就开抽屉，不用先跳列表 */
async function loadRiskPreview(){
 const box=get('riskList');
 if(!box)return;
 if(get('riskCard')&&get('riskCard').hidden){box.replaceChildren();return;}
 const data=await aiApi('list',{params:{page:1,scope:'sampled',level:'d'}}).catch(()=>null);
 if(!data){
  box.replaceChildren(node('p','高风险会话加载失败，点「查看全部」到会话页重试。','qc-note'));
  return;
 }
 const list=(data.rows||[]).slice(0,5);
 if(!list.length){box.replaceChildren(node('p','本批没有 D 级会话。','qc-note'));return;}
 box.replaceChildren();
 for(const row of list){
  const marks=(row.marks||[]).filter(item=>item.status==='fail');
  const button=node('button',null,'qc-risk-row');
  button.type='button';
  button.append(
   node('span',row.agent||'未识别','qc-risk-who'),
   node('span',fmtTime(row.started_at),'qc-risk-time'),
   node('span',row.score==null?'—':Number(row.score).toFixed(1),'qc-risk-score'),
   node('span',marks.length?marks.map(item=>item.label).join('、'):'AI 未给出具体失分项','qc-risk-why'),
   node('span','复核 →','qc-risk-open')
  );
  button.onclick=()=>openReview(row.session_id);
  box.append(button);
 }
}

/* ---------------- 3. 每条会话 ---------------- */
async function loadSessions(){
 /* 默认看「本次抽检入库」的全部会话，未分析的也要出现——以前只显示已分析的，
    等于把 145 条没跑 AI 的样本藏起来了，主管根本不知道它们存在 */
 const params={page,scope:'sampled'};
 /* 待复核只算「已经出过 AI 结论但还没人复核」的；没跑过分析的单独一个 tab，
    否则 145 条未分析会混进待复核队列，主管看到的数字对不上 */
 if(tab==='pending'){params.status='pending';params.analyzed=1;}
 else if(tab==='todo')params.analyzed=0;
 else if(tab==='reviewed')params.status='reviewed';
 if(level)params.level=level;
 if(needsOnly)params.needsOnly=1;
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
  /* 没跑过 AI 的样本也要显示出来，否则主管会以为抽检池只有几十条 */
  const analyzed=row.score!=null;
  const tr=node('tr');
  tr.append(node('td',fmtTime(row.started_at),'qc-time'));
  tr.append(node('td',row.agent||'未识别'));
  tr.append(node('td',analyzed?Number(row.score).toFixed(1):'待分析','qc-ai-score-cell '+(analyzed?gradeClass(row.score):'is-none')));
  tr.append(node('td',row.grade||'—','qc-grade'));
  const issues=node('td',null,'qc-ai-marks');
  if(!analyzed)issues.append(node('em','还没跑 AI 分析','qc-ai-none'));
  else if(!fails.length&&!pendings.length)issues.append(node('em','无明显问题 · 抽样校准'));
  fails.forEach((item,index)=>{
   if(index)issues.append(document.createTextNode('、'));
   issues.append(node('u',item.label));
  });
  if(pendings.length)issues.append(node('em',`（另 ${pendings.length} 项待复核）`));
  tr.append(issues);
  const status=node('td');
  status.append(analyzed?statusChip(row.review_status):node('span','待分析','qc-pill warn'));
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
 pager.append(node('span',label+(pages>1?` · 第 ${page}/${pages} 页`:'')+` · 按风险从高到低，未分析的排最后`,'qc-note'));
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
 try{await loadRiskPreview();}catch(error){}
 try{await loadSessions();}catch(error){get('aiSessions').replaceChildren(node('p',error.message,'qc-note'));}
}

/* 每轮请求 25 条（后端上限 50）。这个数只影响进度更新的粗细，选多选少总耗时一样，
   所以不再做成下拉框——省得主管以为「每批 25 条」是本次只分析 25 条。 */
const ANALYZE_BATCH=25;
/* ---------------- 3.5 全量分析：抽多少就分析多少 ----------------
   循环调用直到没有剩余，中途可停；已分析过的下次自动跳过（后端按 rubric 版本判断），不会重复花钱。 */
async function analyzeAllUnanalyzed({importId='',date='',batchSize=ANALYZE_BATCH,concurrency=3,onProgress}={}){
 stopAnalyze=false;
 let ok=0,failed=0,rounds=0,remaining=null;
 for(;;){
  if(stopAnalyze)break;
  if(rounds>=80)break;                 /* 安全阀：最多 80 轮，防止意外死循环 */
  rounds+=1;
  const body={limit:batchSize,concurrency,sampledOnly:true};
  if(importId)body.importId=importId;
  else if(date)body.date=date;
  const data=await aiApi('batch',{method:'POST',body});
  if(!data.total)break;
  ok+=Number(data.ok)||0;
  failed+=Number(data.failed)||0;
  remaining=Number(data.remaining)||0;
  if(onProgress)onProgress({ok,failed,remaining,rounds});
  await refreshAll().catch(()=>{});
  if(!remaining)break;
  if(!Number(data.ok))break;           /* 整批全失败就停下，避免对着故障接口空烧额度 */
 }
 return{ok,failed,remaining,stopped:stopAnalyze};
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
/* 顾客ID 与「这通对话完不完整」
   质检要能回到京东后台核对，就得有完整顾客ID；log 里只有 m****dm 这种掩码。
   会话记录列表（xlsx）还原后这里显示完整ID，并把「log 条数 vs 后台条数」摆出来看。 */
function renderCustomer(data){
 const box=get('reviewCustomer');
 if(!box)return;
 box.replaceChildren();
 const list=data.sessionList||null;
 const full=data.customerId||'';
 const masked=data.customerMasked||'';
 if(!full&&!masked){box.hidden=true;/* 老会话连掩码都没存，不占地方 */}
 else{
  box.hidden=false;
  box.append(node('span','顾客ID','qc-cust-label'));
  if(full){
   const chip=node('button',full,'qc-cust-id');
   chip.type='button';
   chip.title='点击复制，可直接到京东后台搜索';
   chip.onclick=async()=>{
    try{await navigator.clipboard.writeText(full);chip.textContent='已复制';setTimeout(()=>{chip.textContent=full;},1200);}
    catch{setStatus('复制失败，请手动选中 ID 复制');}
   };
   box.append(chip);
  }else{
   box.append(node('span',masked||'—','qc-cust-id is-masked'),node('span','未还原（重新导入时选上会话记录列表即可补全）','qc-cust-hint'));
  }
 }
 if(!list)return;
 const parts=[];
 if(list.confidence==='weak')parts.push('匹配把握低，建议人工核对');
 else if(list.confidence==='agent-mismatch')parts.push('客服名不一致');
 if(list.firstResponseAt)parts.push('首次响应 '+String(list.firstResponseAt).slice(11,19));
 if(list.durationMin)parts.push('会话 '+list.durationMin+' 分钟');
 if(list.resolved&&list.resolved!=='-')parts.push('是否解决 '+list.resolved);
 if(list.satisfaction&&list.satisfaction!=='-')parts.push('满意度 '+list.satisfaction);
 if(parts.length)box.append(node('span',parts.join(' · '),'qc-cust-meta'));
 const pair=(label,parsed,backend)=>{
  const gap=parsed-backend;
  const el=node('em',`${label} ${parsed}/${backend}`,gap<0?'qc-gap bad':gap>0?'qc-gap more':'qc-gap ok');
  el.title=`log 里 ${parsed} 条，后台统计 ${backend} 条`+(gap<0?`：少了 ${-gap} 条，可能没导出全`:gap>0?`：多 ${gap} 条，后台口径通常不计欢迎语/系统提示`:'：完全一致');
  return el;
 };
 if(list.customerMessages!=null&&list.agentMessages!=null){
  box.append(pair('顾客',list.parsedCustomerMessages,list.customerMessages),pair('客服',list.parsedAgentMessages,list.agentMessages));
  const short=(list.customerGap<0?-list.customerGap:0)+(list.agentGap<0?-list.agentGap:0);
  if(short>0)box.append(node('span',`后台比 log 多 ${short} 条，这通可能没导全`,'qc-cust-warn'));
 }
}

function renderChat(messages,flags){
 const box=get('messages');
 box.replaceChildren();
 if(!messages.length){box.append(node('p','这条会话没有可显示的文本消息。','qc-note'));return;}
 for(const message of messages){
  const row=node('div',null,'qc-msg'+(message.role==='agent'?' agent':'')+(flags.has(Number(message.id))?' flag':''));
  row.id='qc-msg-'+message.id;
  /* 时间必须显示：判断「多久没回」「隔天跟进」全靠它，原来只存不显示等于白导 */
  const at=node('time',String(message.at||'').slice(11,19)||'—','qc-at');
  at.title=String(message.at||'');
  row.append(node('span',message.role==='agent'?'客服':'顾客','qc-who'),at,node('div',message.text||'[无文字内容]','qc-bubble'));
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
 /* 拿不准这项该不该扣：点问号直接翻出这条规则（含本条会话的 AI 判定） */
 const help=node('button','?','qc-crit-help');
 help.type='button';
 help.title=`查「${item.label}」的判定标准`;
 help.setAttribute('aria-label',`查看「${item.label}」规则`);
 help.onclick=event=>{event.preventDefault();event.stopPropagation();openRules(item.id);};
 right.append(help);
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
 /* 盲评闸门：先不看 AI 判定，人自己判完再展开对照 */
 if(current&&current.blind&&!current.revealed){
  const wrap=node('div',null,'qc-blind');
  wrap.append(node('p','这条是盲评样本：AI 的分数和逐项判定先不给你看。请先看左边的原文，自己判断客服哪里做得不对，再点下面展开对照——这样我们才知道 AI 有没有漏判。','qc-note'));
  wrap.append(node('p','展开前看不到 AI 的任何结论，所以你现在看到的就是「纯人工判断」。','qc-note qc-blind-hint'));
  const button=node('button','展开 AI 判定并对照','workbench-primary');
  button.type='button';
  button.onclick=()=>{
   current.revealed=true;
   get('reviewAiTag').textContent=`AI ${current.aiScore==null?'—':Number(current.aiScore).toFixed(1)} 分 · ${current.aiGrade||'—'}`;
   get('reviewAiTag').className='qc-pill '+gradeClass(current.aiScore);
   renderChat(current.messages||[],flagsFrom(current.criteria));
   const hint=get('chatHint');if(hint)hint.textContent='AI 引用的句子已标黄';
   renderCriteria();
   renderScore();
  };
  wrap.append(button);
  box.append(wrap);
  return;
 }
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
 if(current.blind&&!current.revealed){
  box.append(node('span','盲评中 · 展开 AI 判定后才显示分数','qc-score-label'));
  return;
 }
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
  const reviewed=detail.status==='reviewed';
  /* 盲评：待复核里约 12% 的会话先不给分数、不给逐项判定、不标黄引用，
     逼着人先看原文自己判，避免「看到 90 分就不细看」。已复核的会话不再隐藏。 */
  const blind=!reviewed&&isBlindSample(sessionId);
  current={sessionId,detail,result:null,criteria:[],aiScore:null,aiGrade:null,original:{},note:'',messages,blind,revealed:!blind};
  openDrawer(get('reviewCard'));
  get('reviewMeta').textContent=`#${detail.ordinal} · ${detail.agent} · ${detail.started_at} · ${messages.length} 条消息`;
  renderCustomer(detail.data||{});
  get('reviewStatus').textContent=reviewed?'已复核':(blind?'待复核 · 盲评样本':'待复核');
  const index=rows.findIndex(row=>row.session_id===sessionId);
  get('reviewProgress').textContent=rows.length?`第 ${index+1} / ${rows.length} 条`:'';
  updateStepButtons();
  if(result){
   const analysis=result.data||{};
   current.result=result;
   current.criteria=JSON.parse(JSON.stringify(analysis.criteria||[]));
   current.aiScore=result.score==null?null:Number(result.score);
   current.aiGrade=result.grade||'';
   for(const item of current.criteria)current.original[item.id]=item.status;
   current.note=reviewed&&detail.review?String(detail.review.note||''):'';
   if(blind){
    get('reviewAiTag').textContent='盲评 · AI 结论已隐藏';
    get('reviewAiTag').className='qc-pill qc-blind-tag';
   }else{
    get('reviewAiTag').textContent=`AI ${current.aiScore==null?'—':current.aiScore.toFixed(1)} 分 · ${current.aiGrade||'—'}`;
    get('reviewAiTag').className='qc-pill '+gradeClass(current.aiScore);
   }
   get('reviewNote').value=current.note;
   get('reviewNote').disabled=false;
   get('confirmReview').disabled=false;
   renderChat(messages,blind?new Set():flagsFrom(current.criteria));
   const chatHint=get('chatHint');
   if(chatHint)chatHint.textContent=blind?'盲评：先自己看原文，展开后才标出 AI 引用的句子':'AI 引用的句子已标黄';
   renderCriteria();
   renderScore();
  }else{
   get('reviewAiTag').textContent='还没有 AI 结果';
   get('reviewAiTag').className='qc-pill';
   get('reviewNote').value='';
   get('reviewNote').disabled=true;
   get('confirmReview').disabled=true;
   renderChat(messages,new Set());
   get('aiCriteria').replaceChildren(node('p',detail.data&&detail.data.judgeable===false
    ?'这条是京东 AI 机器人「京小智」的会话：它的答复在导出文件里被写成「此消息为欢迎卡片或富文本模板答案，聊天记录中暂不支持展示」，正文没导出来。看不到答复就无法判分，所以不做自动评分——请直接看原文人工判断。'
    :'这条会话还没有 AI 质检结果，这里只能看原文；要复核请先在上面点「分析全部未分析」。','qc-note'));
   get('reviewScore').replaceChildren();
  }
  const pane=get('reviewCard').querySelector('.qc-drawer-body');
  if(pane)pane.scrollTop=0;
 }catch(error){
  setAiStatus(error.message);
 }finally{
  busy=false;
 }
}

/* 供「消费者洞察」板块复用：点一条问题直接打开会话原文 */
window.QualityReview={open:sessionId=>openReview(sessionId)};

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
  aiMeta={criteria:data.criteria||[],categories:data.categories||[],configured:!!data.configured,model:data.model||'',rubricVersion:data.rubricVersion||''};
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
  const importEntry=get('importOpen');if(importEntry)importEntry.hidden=true;
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

/* 顶部四个 KPI 是快捷入口：先切到会话视图，再落到对应队列 */
get('kpiReview').addEventListener('click',()=>{switchView('sessions');switchTab('pending');});
get('kpiDone').addEventListener('click',()=>{switchView('sessions');switchTab('reviewed');});
get('kpiRisk').addEventListener('click',()=>{
 level='d';
 switchView('sessions');
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
if(get('needsOnly'))get('needsOnly').onchange=()=>{needsOnly=get('needsOnly').checked;page=1;run(null,loadSessions);};
get('filterAgent').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();page=1;run(get('search'),loadSessions);}});

/* 视图切换 / 高风险入口 / 抽屉开合 / 上一条下一条 */
for(const button of get('viewTabs').querySelectorAll('button[data-view]')){
 button.onclick=()=>switchView(button.dataset.view);
}
get('ovGoSessions').onclick=()=>switchView('sessions');
get('riskOpen').onclick=()=>{level='d';switchView('sessions');switchTab('all');};
get('importOpen').onclick=()=>openDrawer(get('importCard'));
get('importClose').onclick=()=>closeDrawer(get('importCard'));
get('scrim').onclick=()=>{
 if(!get('reviewCard').hidden)closeDrawer(get('reviewCard'));
 if(!get('importCard').hidden)closeDrawer(get('importCard'));
};
get('prevBtn').onclick=()=>stepReview(-1);
get('nextBtn').onclick=()=>stepReview(1);

/* 规则速查：顶部按钮打开；搜索框边打边筛；类别切换；全部展开/收起 */
get('rulesOpen').onclick=()=>openRules('');
get('rulesClose').onclick=()=>closeRules();
get('rulesBackdrop').onclick=()=>closeRules();
get('rulesSearch').addEventListener('input',event=>{
 /* 中文输入法拼音阶段不筛，否则打字过程中列表会一直跳 */
 if(event.isComposing)return;
 ruleQuery=event.target.value;
 renderRules();
});
get('rulesSearch').addEventListener('compositionend',event=>{
 ruleQuery=event.target.value;
 renderRules();
});
for(const button of get('rulesTabs').querySelectorAll('button[data-kind]')){
 button.onclick=()=>{ruleKind=button.dataset.kind;renderRules();};
}
get('rulesExpand').onclick=()=>{
 ruleOpenAll=!ruleOpenAll;
 get('rulesExpand').textContent=ruleOpenAll?'全部收起':'全部展开';
 renderRules(true);   /* 展开/收起保持当前位置，别把人弹回顶部 */
};

/* Esc 关最上层的浮层；→ / ← 翻下一条上一条；? 打开规则速查（在输入框里打字时不拦截） */
document.addEventListener('keydown',event=>{
 const rulesOpenFlag=!!get('rulesCard')&&!get('rulesCard').hidden;
 if(event.key==='Escape'){
  if(rulesOpenFlag){closeRules();event.preventDefault();return;}
  if(!get('reviewCard').hidden){closeDrawer(get('reviewCard'));event.preventDefault();return;}
  if(!get('importCard').hidden){closeDrawer(get('importCard'));event.preventDefault();return;}
  return;
 }
 const tag=((event.target&&event.target.tagName)||'').toLowerCase();
 const typing=['input','textarea','select'].includes(tag)||!!(event.target&&event.target.isContentEditable);
 /* 问号是「帮我查规则」，复核到一半最常用的一个键 */
 if(!typing&&!rulesOpenFlag&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&event.key==='?'){
  event.preventDefault();
  openRules('');
  return;
 }
 if(rulesOpenFlag||get('reviewCard').hidden)return;
 if(typing)return;
 if(event.key==='ArrowRight'||event.key==='k'){event.preventDefault();stepReview(1);}
 else if(event.key==='ArrowLeft'||event.key==='j'){event.preventDefault();stepReview(-1);}
});
/* 日期一处切换，总览 / 会话 / 消费者洞察三个视图一起换 */
get('aiDate').onchange=()=>{
 page=1;
 refreshAll();
 if(window.QualityInsight)window.QualityInsight.reload();
};
get('closeDetail').onclick=()=>closeDrawer(get('reviewCard'));

/* 批量分析 —— 点一次跑完所有未分析的抽检会话，不用再点十几次；跑的过程中按钮变成「停止」 */
get('aiBatch').onclick=async()=>{
 const button=get('aiBatch');
 if(button.dataset.running){
  stopAnalyze=true;
  button.disabled=true;
  setAiStatus('正在停止，等当前这一批跑完…');
  return;
 }
 button.dataset.running='1';
 button.textContent='停止分析';
 const date=get('aiDate').value;
 setAiStatus('正在逐批分析抽检会话，可随时点「停止分析」；已分析过的不会重复跑。');
 try{
  const result=await analyzeAllUnanalyzed({date,concurrency:3,
   onProgress:({ok,failed,remaining})=>setAiStatus(`已分析 ${ok} 条${failed?`，失败 ${failed} 条`:''}${remaining?`，还剩 ${remaining} 条`:''}…`)});
  setAiStatus(result.stopped
   ?`已停止：本次完成 ${result.ok} 条${result.failed?`，失败 ${result.failed} 条`:''}${result.remaining?`，还剩 ${result.remaining} 条没分析`:''}。`
   :(result.ok||result.failed)
    ?`全部分析完成：本次 ${result.ok} 条${result.failed?`，失败 ${result.failed} 条`:''}。`
    :'没有需要分析的会话（抽检池里都已出过结论）。');
 }catch(error){setAiStatus(`分析中断：${error.message}`);}
 finally{
  delete button.dataset.running;
  button.textContent='分析全部未分析';
  button.disabled=false;
  await refreshAll().catch(()=>{});
 }
};

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
  /* 记录这条是不是盲评：blind=没看到 AI 结论就提交，blindRevealed=展开对照过 */
  const wasBlind=current.blind===true,wasRevealed=current.revealed===true;
  const data=await aiApi('review',{method:'POST',body:{sessionId:doneId,overrides,note:get('reviewNote').value,blind:wasBlind,blindRevealed:wasRevealed}});
  get('reviewStatus').textContent=`已复核 · 主管分 ${data.review.score}（AI ${data.review.aiScore}）`;
  await refreshAll();
  const nextInQueue=rows.find(row=>row.session_id!==doneId&&row.review_status!=='reviewed');
  const index=rows.findIndex(row=>row.session_id===doneId);
  const fallback=rows[index+1]||rows[index-1];
  const next=tab==='pending'?nextInQueue||fallback:fallback||nextInQueue;
  if(next)await openReview(next.session_id);
  else{current=null;closeDrawer(get('reviewCard'));}
 }catch(error){
  get('reviewStatus').textContent=error.message;
 }finally{
  button.disabled=!current||!current.result;
 }
};

/* ---------------- 导入聊天记录 ---------------- */
/* 会话记录列表（xlsx）→ 还原完整顾客ID。
   判定口径交给后端（掩码ID + 咨询时间 + 接待客服 三交叉），前端只负责把结论摆清楚：
   还原了多少、多少是本就得人工确认的、多少没对上。 */
function renderListReport(report,filename){
 const box=get('listReport');
 if(!box)return;
 box.hidden=false;
 box.replaceChildren();
 const ok=report.exact+(report.weak||0)+(report.agentMismatch||0);
 box.append(node('strong',`已还原 ${ok} / ${report.sessions} 位顾客ID`,'qc-list-title'));
 const stats=node('div',null,'qc-list-stats');
 const item=(label,value,tone)=>node('span',`${label} ${value}`,'qc-list-stat'+(tone?' is-'+tone:''));
 stats.append(item('会话',report.sessions));
 stats.append(item('列表行',report.rows));
 stats.append(item('完全吻合',report.exact,'ok'));
 if(report.weak)stats.append(item('时间差较大',report.weak,'warn'));
 if(report.agentMismatch)stats.append(item('客服名不一致',report.agentMismatch,'warn'));
 stats.append(item('未匹配',report.unmatched,report.unmatched?'warn':'ok'));
 box.append(stats);
 if(report.gapWarnings)box.append(node('p',`有 ${report.gapWarnings} 通会话的消息条数少于后台统计，可能没导全，复核时会在顾客ID 下面标出来。`,'qc-list-note is-warn'));
 if(report.unmatched)box.append(node('p',`${report.unmatched} 通没对上（多为顾客全程没发言，或当天导出不完整），这些会话没有顾客ID，复核不受影响。`,'qc-list-note'));
 box.append(node('p',`来源：${filename}`,'qc-list-src'));
}
async function attachList(file){
 if(!/\.xlsx$/i.test(file.name))throw Error('会话记录只支持 .xlsx');
 if(!file.size)throw Error('会话记录文件是空的');
 if(file.size>16*1024*1024)throw Error('会话记录文件不能超过 16 MB');
 setStatus('正在核对会话记录、还原顾客ID…');
 const report=await api('attach-list',{method:'POST',body:await file.arrayBuffer(),params:{previewId},filename:file.name});
 renderListReport(report,file.name);
 setStatus(`会话记录已核对：还原 ${report.exact+(report.weak||0)+(report.agentMismatch||0)} 位顾客ID，未匹配 ${report.unmatched} 通。`);
 return report;
}
get('listFile').onchange=()=>get('listReport').hidden=true;
get('file').onchange=()=>{
 previewId=null;
 get('previewBox').hidden=true;
 const file=get('file').files[0];
 setStatus(file?`已选择 ${file.name}，点击「校验与预览」。`:'请选择聊天记录文件。');
};
/* 抽检结果一句话说清：抽多少、为什么是这个数。上限被压到 100 时必须讲明白，
   否则主管会以为系统算错了（700 通 × 15% 本该 105）。 */
function sampleText(sampling,{preview=false}={}){
 const head=`${preview?'默认抽检':'抽检'} ${sampling.requestedRate}%：共 ${sampling.total} 通会话，实际抽检 ${sampling.selected} 通（${sampling.actualRate}%）`;
 let tail=`，覆盖 ${sampling.agentCount} 位客服。`;
 if(sampling.capApplied)tail+=` 已按单批上限 ${sampling.cap} 条封顶（${sampling.requestedRate}% 本应抽 ${sampling.quota} 条）。`;
 else if(sampling.cap&&sampling.selected>sampling.cap)tail+=` 为覆盖全部客服需要 ${sampling.selected} 条，已超过单批上限 ${sampling.cap} 条。`;
 else if(sampling.coverageRaisedSample)tail+=' 为确保每位客服均被抽检，实际数量高于比例名额。';
 return head+tail;
}
function renderPreview(data,sampling){
 previewId=data.id;
 get('previewBox').hidden=false;
 const summary=data.summary;
 get('sampleStats').textContent=sampleText(sampling,{preview:true});
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
 /* 选了多少就顺手核对多少：不给顾客ID，质检结论回到后台找不到这通对话 */
 const listFile=get('listFile').files[0];
 if(listFile)await attachList(listFile);
},setStatus);
get('rate').onchange=()=>{
 if(!previewId)return;
 run(get('rate'),async()=>{
  const sampling=await api('preview',{sampling:true,params:{id:previewId,rate:get('rate').value}});
  get('sampleStats').textContent=sampleText(sampling);
 },setStatus);
};
get('confirm').onclick=()=>run(get('confirm'),async()=>{
 if(!previewId)throw Error('请先预览文件');
 const result=await api('confirm',{sampling:true,method:'POST',body:{id:previewId,rate:Number(get('rate').value),shopId:get('importShop').value||null}});
 get('previewBox').hidden=true;
 setStatus(result.duplicate
  ?'此文件已导入过，已显示已有抽检会话。'
  :`成功导入 ${result.sampling.total} 通会话，抽检 ${result.sampling.selected} 通（${result.sampling.actualRate}%），覆盖 ${result.sampling.agentCount} 位客服。`+(result.sampling.capApplied?` 已按单批上限 ${result.sampling.cap} 条封顶（${result.sampling.requestedRate}% 本应抽 ${result.sampling.quota} 条）。`:''));
 /* 刚导进来的这批是哪一天，日期就切到哪一天——不然还在看上一批，会以为导入没成功 */
 if(result.latestDate&&result.latestDate!==get('aiDate').value){
  get('aiDate').value=result.latestDate;
  get('aiDate').title=`最近一次导入：${result.latestDate}`;
 }
 page=1;
 await refreshAll();
 if(window.QualityInsight)window.QualityInsight.reload();   /* 新批次进来，洞察的口径也要跟着换 */
 /* 导入完成后自动把本次抽中的样本全部跑一遍：抽检数量 = AI 分析数量，主管不用再点十几次 */
 if(result.duplicate||!result.importId||!result.sampling||!result.sampling.selected)return;
 const button=get('aiBatch');
 button.dataset.running='1';
 button.textContent='停止分析';
 setAiStatus(`本次抽检 ${result.sampling.selected} 通，正在自动分析…（可点「停止分析」）`);
 try{
  const outcome=await analyzeAllUnanalyzed({importId:result.importId,concurrency:3,
   onProgress:({ok,failed,remaining})=>setAiStatus(`自动分析中：已完成 ${ok} 条${failed?`，失败 ${failed} 条`:''}${remaining?`，还剩 ${remaining} 条`:''}…`)});
  setAiStatus(outcome.stopped
   ?`自动分析已停止：完成 ${outcome.ok} 条，还剩 ${outcome.remaining||0} 条。点「分析全部未分析」可以接着跑。`
   :`本次抽检 ${result.sampling.selected} 通已全部出结论：成功 ${outcome.ok} 条${outcome.failed?`，失败 ${outcome.failed} 条`:''}。可以开始复核了。`);
 }catch(error){
  setAiStatus(`自动分析中断：${error.message}。点「分析全部未分析」可以接着跑，已分析的不会重复。`);
 }finally{
  delete button.dataset.running;
  button.textContent='分析全部未分析';
  await refreshAll().catch(()=>{});
 }
},setStatus);

await loadAiMeta();
await refreshAll();

/* 支持 #sessions / #insight 直接落到对应视图，便于从别处链接过来 */
const initialView=(location.hash||'').replace('#','');
if(VIEWS.includes(initialView))switchView(initialView);
})();
