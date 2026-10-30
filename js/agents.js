(async()=>{
'use strict';
/* 客服档案 —— 昵称 → 真人 → 店铺 → 品牌组
   数据量很小（几十人），所以筛选全在前端做，输入即筛，不再往回打接口。
   会改数据的动作只有三个：保存、删除、从质检记录带入。 */
const session=WorkbenchSession.createSessionClient();
const get=id=>document.getElementById(id);
function node(tag,text,klass){const el=document.createElement(tag);if(text!=null)el.textContent=String(text);if(klass)el.className=klass;return el;}

let role='viewer';
function canWrite(){return ['admin','operator'].includes(role);}

let state={agents:[],orphans:[],shops:[],summary:null,meta:{statuses:[],roles:[],brandGroups:[]}};
let editing=null;   /* 正在编辑的档案；null = 新建 */
let busy=false;
const filters={search:'',shop:'',brand:'',status:'',missing:false};

function setStatus(message,tone){
 const el=get('status');
 if(!el)return;
 el.textContent=message||'';
 el.className='agents-note'+(tone?' is-'+tone:'');
}

/* 新接口要服务重启后才注册：旧进程会回「接口不存在」。这种技术报错用户看不懂，
   直接翻译成一句能动手的话，别让人对着「加载失败：接口不存在」发呆。 */
function explain(error){
 const text=String((error&&error.message)||error||'').trim()||'未知错误';
 if(/接口不存在|本地API执行失败|旧代码/.test(text)){
  return '后台服务还在跑旧代码（本页面能打开，但新接口还没注册）。双击「启动工作台.command」，等它显示「启动成功」后刷新本页即可。';
 }
 if(/401|未登录|登录.*过期/.test(text))return '登录状态已过期，请重新登录后再试。';
 return text;
}

/* ---------------- 接口 ---------------- */
async function api(action,{method='GET',body}={}){
 const response=await session.authorizedFetch('/api/service-agents?action='+encodeURIComponent(action),{
  method,
  headers:body?{'Content-Type':'application/json'}:undefined,
  body:body?JSON.stringify(body):undefined
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'请求失败');
 return result.data;
}

/* ---------------- 小部件 ---------------- */
function statusChip(value){
 const text=value||'在职';
 return node('span',text,'agents-chip '+(text==='在职'?'is-on':'is-off'));
}
function todo(){
 return node('span','待补','agents-todo');
}
function scoreClass(score){
 if(score==null)return '';
 const n=Number(score);
 return n>=85?'is-good':n>=70?'is-ok':n>=40?'is-warn':'is-bad';
}
function isIncomplete(data){
 return !data.employeeName||!data.shop||!data.brandGroup;
}
function fillSelect(el,items,{emptyLabel=''}={}){
 const current=el.value;
 el.replaceChildren();
 const blank=node('option',emptyLabel);
 blank.value='';
 el.append(blank);
 for(const item of items){
  const o=node('option',typeof item==='string'?item:item.label);
  o.value=typeof item==='string'?item:item.value;
  el.append(o);
 }
 el.value=[...el.options].some(o=>o.value===current)?current:'';
}

/* ---------------- 渲染 ---------------- */
function renderKpis(){
 const s=state.summary||{total:0,active:0,left:0,missing:0};
 get('kpiTotal').textContent=s.active;
 get('kpiMissing').textContent=s.missing;
 get('kpiOrphan').textContent=state.orphans.length;
 get('kpiLeft').textContent=s.left;
 get('kpiOrphanCard').classList.toggle('is-warn',state.orphans.length>0);
 get('kpiMissing').parentElement.classList.toggle('is-warn',s.missing>0);
}

function renderOrphanHint(){
 const hint=get('orphanHint');
 const list=state.orphans;
 if(!list.length){hint.hidden=true;return;}
 hint.hidden=false;
 hint.replaceChildren();
 hint.append(node('b',`质检记录里有 ${list.length} 个昵称还没建档：`));
 hint.append(node('span',list.map(item=>`${item.agent}（${item.sessions} 通）`).join('、'),'agents-hint-list'));
 hint.append(node('span','这些会话目前算不到任何人头上——先点「从质检记录带入」，再补姓名。','agents-hint-tail'));
}

function visibleRows(){
 const term=filters.search.trim().toLowerCase();
 return state.agents.filter(row=>{
  const d=row.data||{};
  if(filters.shop&&(d.shop||'')!==filters.shop)return false;
  if(filters.brand&&(d.brandGroup||'')!==filters.brand)return false;
  if(filters.status&&(d.status||'在职')!==filters.status)return false;
  if(filters.missing&&!isIncomplete(d))return false;
  if(!term)return true;
  return [d.agentName,d.employeeName,d.shop,d.brandGroup,d.role,d.note]
   .some(value=>String(value||'').toLowerCase().includes(term));
 });
}

function emptyState(title,lines,{actionLabel,onAction,note}={}){
 const box=node('div',null,'agents-empty');
 box.append(node('h3',title));
 for(const line of lines)box.append(node('p',line,note));
 if(actionLabel&&canWrite()){
  const button=node('button',actionLabel,'workbench-primary');
  button.type='button';
  button.onclick=onAction;
  box.append(button);
 }
 return box;
}

function renderTable(){
 const wrap=get('tableWrap');
 wrap.replaceChildren();
 const rows=visibleRows();
 const total=state.agents.length;
 get('boardTitle').textContent=`客服名单（${rows.length}${rows.length!==total?` / 共 ${total}`:''}）`;

 if(!total){
  get('boardNote').textContent='还没有任何档案。';
  wrap.append(emptyState('先建第一批档案',[
   '最快的方式是点右上角「从质检记录带入」：系统会把聊天记录里出现过的客服昵称全部建成草稿，店铺和岗位能自动认的会填好，你只需要补员工姓名。',
   '也可以点「新建客服」一个个手填。客服名称必须和聊天记录里显示的一字不差，否则质检数据对不上。'
  ],{actionLabel:'从质检记录带入',onAction:()=>get('importFromQuality').click()}));
  return;
 }
 if(!rows.length){
  get('boardNote').textContent=`共 ${total} 条，当前筛选没有匹配。`;
  wrap.append(emptyState('没有符合条件的客服',['把搜索词或筛选条件放宽一点试试。'],
   {actionLabel:'清空筛选',onAction:()=>get('resetFilters').click()}));
  return;
 }
 get('boardNote').textContent=`共 ${total} 条，显示 ${rows.length} 条。质检会话与平均分来自 AI 质检，只作参考，不挂绩效。`;

 const table=node('table',null,'agents-table');
 const thead=node('thead');
 const hrow=node('tr');
 for(const label of ['客服名称','员工姓名','店铺','品牌组别','岗位','质检会话','平均分','状态','']){
  hrow.append(node('th',label));
 }
 thead.append(hrow);
 const tbody=node('tbody');

 for(const row of rows){
  const d=row.data||{};
  const tr=node('tr',null,isIncomplete(d)?'is-incomplete':'');
  tr.tabIndex=0;
  tr.append(node('td',d.agentName,'agents-name'));

  const employee=node('td',d.employeeName||'',d.employeeName?'':'is-empty');
  if(!d.employeeName)employee.append(todo());
  tr.append(employee);

  const shop=node('td',d.shop||'',d.shop?'':'is-empty');
  if(!d.shop)shop.append(todo());
  tr.append(shop);

  const brand=node('td',d.brandGroup||'',d.brandGroup?'':'is-empty');
  if(!d.brandGroup)brand.append(todo());
  tr.append(brand);

  tr.append(node('td',d.role||'—','agents-dim'));

  const sessions=row.stat?row.stat.sessions:0;
  tr.append(node('td',sessions?sessions+' 通':'未出现',sessions?'agents-num':'agents-dim agents-todo-cell'));

  const score=row.stat&&row.stat.avgScore!=null?row.stat.avgScore:null;
  tr.append(node('td',score==null?'—':Number(score).toFixed(1),'agents-num '+scoreClass(score)));

  const stateCell=node('td');
  stateCell.append(statusChip(d.status));
  tr.append(stateCell);

  const opCell=node('td',null,'agents-op');
  const open=node('button',canWrite()?'编辑':'查看');
  open.type='button';
  open.onclick=event=>{event.stopPropagation();openDrawer(row);};
  opCell.append(open);
  tr.append(opCell);

  tr.onclick=()=>openDrawer(row);
  tr.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();openDrawer(row);}};
  tbody.append(tr);
 }
 table.append(thead,tbody);
 wrap.append(table);
}

function renderFilterOptions(){
 const shops=[...new Set(state.agents.map(row=>row.data.shop).filter(Boolean))];
 const brands=[...new Set(state.agents.map(row=>row.data.brandGroup).filter(Boolean))];
 fillSelect(get('filterShop'),shops,{emptyLabel:'全部店铺'});
 fillSelect(get('filterBrand'),brands,{emptyLabel:'全部品牌组别'});
}

function renderAll(){
 renderKpis();
 renderOrphanHint();
 renderFilterOptions();
 renderTable();
}

/* ---------------- 抽屉 ---------------- */
function shopByName(name){
 return state.shops.find(item=>item.name===name)||null;
}
function openDrawer(row){
 editing=row||null;
 const d=row?row.data:{};
 const form=get('form');
 get('drawerTitle').textContent=row?'编辑客服档案':'新建客服';
 get('drawerSub').textContent=row
  ?'改完点保存，已导入的质检记录不受影响（它们按昵称关联，不存人名）。'
  :'客服名称就是聊天记录里显示的那个名字，必须和日志里一字不差。';
 form.reset();
 form.elements.agentName.value=d.agentName||'';
 form.elements.employeeName.value=d.employeeName||'';
 form.elements.role.value=d.role||'';
 form.elements.shop.value=d.shop||'';
 form.elements.brandGroup.value=d.brandGroup||'';
 form.elements.status.value=d.status||'在职';
 form.elements.joinDate.value=d.joinDate||'';
 form.elements.note.value=d.note||'';
 for(const el of form.querySelectorAll('input,select,textarea'))el.disabled=!canWrite();
 get('saveBtn').hidden=!canWrite();
 get('cancelBtn').textContent=canWrite()?'取消':'关闭';
 get('deleteBtn').hidden=!canWrite()||!row;
 get('formMsg').textContent='';
 get('formMsg').className='agents-note';

 const statBox=get('drawerStat');
 statBox.replaceChildren();
 if(row&&row.stat){
  statBox.hidden=false;
  statBox.append(node('b','质检记录'));
  statBox.append(node('span',`${row.stat.sessions} 通会话 · 已分析 ${row.stat.analyzed} 通`
   +(row.stat.avgScore==null?'':` · 平均 ${Number(row.stat.avgScore).toFixed(1)} 分`)
   +(row.stat.lastAt?` · 最近 ${String(row.stat.lastAt).slice(0,10)}`:''),'agents-drawer-stat-line'));
  statBox.append(node('span','平均分来自 AI 质检，只作参考，不进绩效考核。','agents-note'));
 }else if(row){
  statBox.hidden=false;
  statBox.append(node('b','质检记录'));
  statBox.append(node('span','没找到这个昵称的会话。先确认它和聊天记录里是否完全一致——空格、全角半角、后缀都会导致对不上。','agents-drawer-stat-line is-warn'));
 }else{
  statBox.hidden=true;
 }

 const card=get('drawer');
 card.hidden=false;
 get('scrim').hidden=false;
 document.body.classList.add('agents-locked');
 requestAnimationFrame(()=>card.classList.add('is-open'));
 setTimeout(()=>{if(canWrite())form.elements.agentName.focus();},60);
}
function closeDrawer(){
 const card=get('drawer');
 if(!card||card.hidden)return;
 card.classList.remove('is-open');
 card.hidden=true;
 get('scrim').hidden=true;
 document.body.classList.remove('agents-locked');
 editing=null;
}

/* ---------------- 动作 ---------------- */
async function reload(){
 try{
  state=await api('list');
  renderAll();
 }catch(error){
  setStatus('加载失败：'+explain(error),'bad');
 }
}

async function save(){
 if(busy)return;
 const form=get('form');
 const msg=get('formMsg');
 const payload={};
 for(const key of ['agentName','employeeName','shop','shopId','brandGroup','role','status','joinDate','note']){
  payload[key]=form.elements[key]?form.elements[key].value:'';
 }
 /* 店铺是下拉选的，顺手把店铺 id 也存上，将来换名字还能对上 */
 const shop=shopByName(payload.shop);
 payload.shopId=shop?shop.id:'';

 busy=true;
 get('saveBtn').disabled=true;
 msg.textContent='正在保存…';
 msg.className='agents-note';
 const isEdit=!!editing;
 try{
  await api('save',{method:'POST',body:{...payload,id:editing?editing.id:undefined}});
  closeDrawer();
  await reload();
  setStatus(isEdit?'已保存。':`已新建「${payload.agentName}」。`,'ok');
 }catch(error){
  msg.textContent=error.message;
  msg.className='agents-note is-bad';
 }finally{
  busy=false;
  get('saveBtn').disabled=false;
 }
}

async function remove(){
 if(!editing||busy)return;
 const name=editing.data.agentName;
 const msg=get('formMsg');
 if(!window.confirm(`删除「${name}」的档案？\n\n已导入的质检记录不会被删除，只是这些会话会重新变成「未建档」，在列表和统计里算不到人头上。\n\n如果人只是离职，建议改成「离职」而不是删除。`))return;
 busy=true;
 get('deleteBtn').disabled=true;
 try{
  await api('delete',{method:'POST',body:{id:editing.id}});
  closeDrawer();
  await reload();
  setStatus(`已删除「${name}」。`,'ok');
 }catch(error){
  msg.textContent=error.message;
  msg.className='agents-note is-bad';
 }finally{
  busy=false;
  get('deleteBtn').disabled=false;
 }
}

async function importFromQuality(){
 if(busy||!canWrite())return;
 const count=state.orphans.length;
 if(!count){
  setStatus('质检记录里的昵称都建档了，没有需要带入的。','ok');
  return;
 }
 if(!window.confirm(`把质检记录里还没建档的 ${count} 个昵称建成档案草稿？\n\n店铺、品牌组别、岗位能自动认的会填好，员工姓名留空等你补。`))return;
 busy=true;
 const button=get('importFromQuality');
 button.disabled=true;
 try{
  const result=await api('from-quality',{method:'POST',body:{}});
  await reload();
  const added=result.created.length;
  if(!added){
   setStatus('没有新增——质检里的昵称都已经建档了。','ok');
  }else{
   const named=result.created.filter(item=>item.shop).length;
   setStatus(`已从质检记录带入 ${added} 位，其中 ${named} 位自动关联了店铺。补员工姓名就能用了。`,'ok');
  }
 }catch(error){
  setStatus('带入失败：'+error.message,'bad');
 }finally{
  busy=false;
  button.disabled=false;
 }
}

/* ---------------- 事件 ---------------- */
get('search').addEventListener('input',event=>{
 filters.search=event.target.value;
 renderTable();
});
get('filterShop').onchange=event=>{filters.shop=event.target.value;renderTable();};
get('filterBrand').onchange=event=>{filters.brand=event.target.value;renderTable();};
get('filterStatus').onchange=event=>{filters.status=event.target.value;renderTable();};
get('onlyMissing').onchange=event=>{filters.missing=event.target.checked;renderTable();};
get('resetFilters').onclick=()=>{
 filters.search='';filters.shop='';filters.brand='';filters.status='';filters.missing=false;
 get('search').value='';
 get('filterShop').value='';
 get('filterBrand').value='';
 get('filterStatus').value='';
 get('onlyMissing').checked=false;
 renderTable();
};
get('createBtn').onclick=()=>openDrawer(null);
get('importFromQuality').onclick=importFromQuality;
get('drawerClose').onclick=closeDrawer;
get('cancelBtn').onclick=closeDrawer;
get('scrim').onclick=closeDrawer;
get('deleteBtn').onclick=remove;
get('form').addEventListener('submit',event=>{event.preventDefault();save();});

/* 选店铺后自动带出品牌组别：店铺档案里已经有品牌，不用让人再选一遍 */
get('form').elements.shop.addEventListener('change',event=>{
 const shop=shopByName(event.target.value);
 const brandField=get('form').elements.brandGroup;
 if(shop&&shop.brand&&[...brandField.options].some(o=>o.value===shop.brand)){
  brandField.value=shop.brand;
 }
});

get('exportBtn').onclick=async()=>{
 try{
  const response=await session.authorizedFetch('/api/service-agents?action=export');
  if(!response.ok)throw Error('导出失败');
  const blob=await response.blob();
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download='客服档案.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
 }catch(error){
  setStatus('导出失败：'+error.message,'bad');
 }
};

document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&!get('drawer').hidden){closeDrawer();event.preventDefault();}
});

/* ---------------- 启动 ---------------- */
try{
 const identity=await session.getIdentity();
 WorkbenchShell.mountShell({
  container:get('shell'),
  activeModule:'service-agents',
  identity,
  onLogout:async()=>{await session.logout();location.replace('/login.html');}
 });
 role=(identity.user&&identity.user.role)||'viewer';
 if(!canWrite()){
  get('createBtn').hidden=true;
  get('importFromQuality').hidden=true;
 }
}catch(error){
 location.replace('/login.html?returnTo=%2Fagents.html');
 return;
}

try{
 state=await api('list');
 /* 枚举与店铺下拉都由接口给，前端不写死，避免和字段校验两处打架 */
 fillSelect(get('form').elements.role,state.meta.roles,{emptyLabel:'未填写'});
 fillSelect(get('form').elements.brandGroup,state.meta.brandGroups,{emptyLabel:'未填写'});
 fillSelect(get('form').elements.shop,state.shops.map(item=>({value:item.name,label:item.name+(item.platform?' · '+item.platform:'')})),{emptyLabel:'未关联店铺'});
 renderAll();
}catch(error){
 setStatus('加载失败：'+explain(error),'bad');
}
})();
