(async()=>{
'use strict';
/* 产品知识库 —— 详情页 → 结构化事实 → 拿去纠正客服答复
   页面只有两块工作：把机器录进来（导入抽屉），把机器和对话对上（详情抽屉里的相关会话）。
   改动数据的动作只有四个：导入预览、保存入库、改知识、删型号。 */

const session=WorkbenchSession.createSessionClient();
const get=id=>document.getElementById(id);
function node(tag,text,klass){const el=document.createElement(tag);if(text!=null)el.textContent=String(text);if(klass)el.className=klass;return el;}

let role='viewer';
const canWrite=()=>['admin','operator'].includes(role);

const state={
 groups:[],ai:{configured:false},group:'gree-ac',q:'',
 /* sort：列表排序口径。默认按销量（主销型号靠前才是日常使用最省事的），
    另外两个是「按系列」和「按最近更新」，切了会重拉列表。 */
 sort:'sales',sales:null,
 products:[],summary:{},links:null,advice:{},
 detail:null,preview:null,match:null,busy:false,
 featureDraft:[],paramDraft:[],
 /* 参数标准字段表：由 meta 接口下发，源头是 lib/product/fields.js。
    拿到它才能把任意型号铺成同一套格子，缺的落「待补充」。 */
 paramFields:{sections:[],fields:[]}
};

function setStatus(message,tone){
 const el=get('status');
 if(!el)return;
 el.textContent=message||'';
 el.className='pkb-note'+(tone?' is-'+tone:'');
}
function setMsg(id,message,tone){
 const el=get(id);
 if(!el)return;
 el.textContent=message||'';
 el.className='pkb-note'+(tone?' is-'+tone:'');
}

/* 旧进程里没有新接口时回「接口不存在」，翻译成一句能动手的话 */
function explain(error){
 const text=String((error&&error.message)||error||'').trim()||'未知错误';
 if(/接口不存在|旧代码/.test(text))
  return '后台服务还在跑旧代码（页面能打开，但新接口没注册）。双击「启动工作台.command」，显示「启动成功」后刷新本页。';
 if(/401|未登录|过期/.test(text))return '登录状态已过期，请重新登录后再试。';
 if(/未配置 DeepSeek/.test(text))return '未配置 DeepSeek API Key，可以用规则解析导入，但卖点识别会弱一些。';
 return text;
}

async function api(action,{method='GET',params={},body}={}){
 const query=new URLSearchParams({action,...params});
 const response=await session.authorizedFetch('/api/product-knowledge?'+query,{
  method,
  headers:body?{'Content-Type':'application/json'}:undefined,
  body:body?JSON.stringify(body):undefined
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'请求失败');
 return result.data;
}

const groupLabel=id=>{const hit=state.groups.find(item=>item.id===id);return hit?hit.label:id||'—';};
const fmtTime=value=>String(value||'').slice(5,16).replace('T',' ');

/* 卖点分类：与 lib/product/gree-table.js 的七类保持一致（手工补录的条目没有 cat，用这套词兜底） */
const CAT_NAMES={energy:'节能能效',climate:'冷暖风感',health:'清洁健康',smart:'智能操控',comfort:'舒适静音',look:'外观工艺',other:'其他'};
const CAT_ORDER=['energy','climate','health','smart','comfort','look','other'];
const CAT_RULES=[
 ['energy',/能效|省电|节能|变频|APF|耗电|电费|低碳/],
 ['climate',/制冷|制热|冷暖|风量|风速|送风|导风|防直吹|出风|进风|风口|除湿|换气|气流|暖屏|冷风|冷酷/],
 ['health',/自洁|自清洁|净菌|杀菌|除菌|抗菌|过滤|新风|健康|除尘|蒸发器|UVC|紫外|净荷|烘干/],
 ['smart',/wifi|WiFi|WIFI|app|APP|智能|蓝牙|语音|遥控|远程|操控|智控|天猫精灵|小度|屏显/],
 ['comfort',/噪音|静音|睡眠|光敏|舒适|温控|精准|恒温|分贝|防冷风|童锁/],
 ['look',/配色|外观|面板|圆柱|工艺|颜值|曲线|机身|材质|设计|金秋|时尚/]
];
const guessCat=title=>{
 const text=String(title||'');
 for(const [id,re] of CAT_RULES){if(re.test(text))return id;}
 return 'other';
};

/* ---------------- 分组 TAB 与概览 ---------------- */
function renderTabs(){
 const box=get('tabs');
 const byGroup=state.summary.byGroup||{};
 box.replaceChildren();
 for(const group of state.groups){
  const button=node('button',group.label);
  button.type='button';
  button.setAttribute('role','tab');
  const on=group.id===state.group;
  button.classList.toggle('on',on);
  button.setAttribute('aria-selected',on?'true':'false');
  const count=node('em',(byGroup[group.id]||{}).products||0);
  button.append(count);
  button.onclick=()=>{
   if(state.group===group.id)return;
   state.group=group.id;
   state.q='';
   get('search').value='';
   loadList().catch(error=>setStatus(explain(error),'bad'));
  };
  box.append(button);
 }
}

function renderKpis(){
 const s=state.summary||{};
 get('kpiModels').textContent=s.products==null?'—':s.products;
 get('kpiFeatures').textContent=s.features==null?'—':s.features;
 get('kpiParams').textContent=s.params==null&&s.service==null?'—':Number(s.params||0)+Number(s.service||0);
 get('kpiReview').textContent=s.needsReview==null?'—':s.needsReview;
 get('kpiReviewCard').classList.toggle('is-warn',Number(s.needsReview||0)>0);
 const byGroup=s.byGroup||{};
 get('kpiModelsNote').textContent=state.groups.map(g=>`${g.label} ${(byGroup[g.id]||{}).products||0}`).join(' · ')||'格力空调 / 海尔空调 / 海尔冰箱';
}

/* ---------------- 型号列表 ---------------- */
/* 销量数字放在表格里，不另开一页：主管扫一眼就知道凭什么排这个顺序 */
function formatUnits(value){
 const number=Number(value||0);
 if(!number)return '—';
 return String(number).replace(/\B(?=(\d{3})+(?!\d))/g,',');
}

function sortNote(){
 const sales=state.sales;
 const base=state.products.length?`共 ${state.products.length} 个型号`:'';
 if(state.sort==='sales'&&sales){
  return `${base}，按累计销量从多到少${sales.from?`（${sales.shops} 家店的免扣款结算，${sales.from.slice(0,7)} ~ ${sales.to.slice(0,7)} 共 ${formatUnits(sales.units)} 台）`:''}。没有结算记录的型号排在最后。`;
 }
 if(state.sort==='series')return `${base}，按系列名称排（同系列挨在一起）。`;
 if(state.sort==='updated')return `${base}，按最近更新排（刚导入/刚改过的在前）。`;
 return base;
}

function renderTable(){
 const wrap=get('tableWrap');
 const rows=state.products||[];
 const links=state.links;
 const sortSel=get('sortSelect');
 if(sortSel&&sortSel.value!==state.sort)sortSel.value=state.sort;
 get('boardTitle').textContent=groupLabel(state.group)+' · 型号';
 get('boardNote').textContent=rows.length
  ? `${sortNote()} 点一行看卖点、参数和客服答复建议。`
  : '还没有录入型号。点右上角「导入参数表」整批进，或「手动新建」单个录。';
 get('linkNote').textContent='型号是唯一标识；同一型号再导入会自动合并，人工改过的条目不会被覆盖。';

 if(!rows.length){
  const empty=node('div',null,'pkb-empty');
  empty.append(node('b','这个分组还没有型号'),node('br'),node('span','用「导入参数表」把整张产品参数表导进来（一次几十个型号），或「手动新建」逐个录。图片用「导入图片」按物料编码挂上去。'));
  wrap.replaceChildren(empty);
  return;
 }

 const table=node('table',null,'pkb-table');
 const thead=node('thead');
 const headRow=node('tr');
 for(const [label,tip] of [
  ['系列名称',''],
  ['型号',''],
  ['机型档位',''],
  ['物料编码',''],
  ['累计销量','京东 3 家店结算台数合计；没有记录显示「—」'],
  ['分销',''],
  ['最近更新','']
 ]){
  const th=node('th',label);
  if(tip)th.title=tip;
  if(label==='累计销量')th.className='pkb-num pkb-col-units';
  headRow.append(th);
 }
 thead.append(headRow);
 const tbody=node('tbody');
 for(const item of rows){
  const data=item.data||{};
  const tr=node('tr');
  tr.tabIndex=0;
  tr.onclick=()=>openDetail(item.id);
  tr.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openDetail(item.id);}};
  /* 系列名称：优先分销清单 G 列核定写法，没有再看在售系列、商品标题 */
  const series=node('td');
  series.append(node('span',data.series||data.shopSeries||data.name||'—','pkb-name'));
  const model=node('td');
  model.append(node('span',data.model||'未填型号','pkb-model'));
  const tierCell=node('td');
  if(data.tier)tierCell.append(node('span',data.tier,'pkb-badge pkb-tier'));
  else tierCell.textContent='—';
  const distCell=node('td');
  if(data.distribution)distCell.append(node('span',data.distribution,'pkb-badge'+(data.distribution==='分销机型'?' is-good':'')));
  else distCell.textContent='—';
  /* 销量：有记录才显示台数；0 台/无记录一律「—」，避免把「没数据」看成「卖不动」 */
  const units=node('td',formatUnits(item.units),'pkb-num pkb-col-units'+(Number(item.units||0)?'':' is-muted'));
  units.title=Number(item.units||0)
   ? `累计 ${formatUnits(item.units)} 台${item.lastSaleDate?`，最近一次 ${item.lastSaleDate}`:''}`
   : '没有结算销量记录';
  tr.append(series,model,tierCell,node('td',data.materialCode||'—','pkb-code'),units,distCell);
  tr.append(node('td',fmtTime(item.updatedAt)||'—'));
  tbody.append(tr);
 }
 table.append(thead,tbody);
 wrap.replaceChildren(table);
}

async function loadList(){
 setStatus('正在加载…');
 const data=await api('list',{params:{group:state.group,q:state.q,sort:state.sort,scan:'1'}});
 state.products=data.products||[];
 state.summary=data.summary||{};
 state.links=data.links||null;
 state.advice=data.advice||{};
 state.sales=data.sales||null;
 renderKpis();
 renderTabs();
 renderTable();
 const s=state.summary;
 setStatus(s.needsReview?`有 ${s.needsReview} 条信息在原文里没找到对应文字，已标「待核实」，建议点开确认。`:'数据已就绪。',s.needsReview?'':'ok');
}

/* ---------------- 抽屉通用 ---------------- */
function openDrawer(el){
 el.hidden=false;
 get('scrim').hidden=false;
 document.body.classList.add('pkb-locked');
 requestAnimationFrame(()=>el.classList.add('is-open'));
}
function closeDrawer(el){
 el.classList.remove('is-open');
 el.hidden=true;
 if(get('importDrawer').hidden&&get('detailDrawer').hidden&&get('tableDrawer').hidden){
  get('scrim').hidden=true;
  document.body.classList.remove('pkb-locked');
 }
}

/* ---------------- 导入 ---------------- */
function fillGroupSelect(select,value){
 select.replaceChildren();
 for(const group of state.groups){
  const option=node('option',group.label);
  option.value=group.id;
  select.append(option);
 }
 select.value=value||state.group;
}

/* 导入抽屉现在只做一件事：把详情图压缩包挂到已有型号上。
   参数和卖点走「导入参数表」，新型号走「手动新建」。 */
function openImport(){
 state.preview=null;
 get('zipFile').value='';
 get('zipFileName').textContent='未选择文件';
 setMsg('zipMsg','');
 setMsg('zipHint','');
 openDrawer(get('importDrawer'));
}

/* ---------------- 参数表：整批导入 ---------------- */
/* 格力《产品参数一览表》一列一个系列、一行一个参数，一张表能进几十个型号。
   转置逻辑全在服务端 lib/product/gree-table.js，这里只管「挑文件 → 看预览 → 勾选 → 入库」。 */

const tableState={file:null,data:null,picked:new Set()};
const TABLE_LIMIT=30*1024*1024;

function openTableImport(){
 fillGroupSelect(get('tableGroup'),state.group);
 get('tablePreviewBox').hidden=true;
 get('tableFileName').textContent='未选择文件';
 get('tableFile').value='';
 get('tableStats').replaceChildren();
 get('tableWarnings').replaceChildren();
 get('tableSkipped').replaceChildren();
 get('tablePickWrap').replaceChildren();
 setMsg('tableMsg','');
 setMsg('tableHint','');
 get('tableSaveNote').textContent='';
 tableState.file=null;
 tableState.data=null;
 tableState.picked=new Set();
 openDrawer(get('tableDrawer'));
}

function statBadge(label,value,tone){
 return node('span',`${label} ${value}`,'pkb-badge'+(tone?' is-'+tone:''));
}

function renderPickTable(data){
 const wrap=get('tablePickWrap');
 const table=node('table');
 const head=node('thead');
 const headRow=node('tr');
 for(const [index,label] of ['','型号','名称','参数','卖点','状态',''].entries()){
  const th=node('th',label);
  if(index===0)th.className='pkb-pick-check';
  headRow.append(th);
 }
 head.append(headRow);

 const tbody=node('tbody');
 for(const [index,item] of (data.products||[]).entries()){
  const tr=node('tr',null,'pkb-pick-row');
  tr.dataset.index=String(index);

  const pick=node('td',null,'pkb-pick-check');
  const box=document.createElement('input');
  box.type='checkbox';
  box.checked=true;
  box.setAttribute('aria-label','选择 '+item.model);
  box.onclick=event=>{event.stopPropagation();togglePick(item,tr);};
  pick.append(box);

  const model=node('td');
  model.append(node('span',item.model,'pkb-model'));
  const name=node('td',item.name||'—','pkb-name');
  const params=node('td',(item.params||[]).length,'pkb-num');
  const features=node('td',(item.features||[]).length,'pkb-num');
  const status=node('td');
  status.append(node('span',item.existing?'合并':'新增','pkb-badge'+(item.existing?' is-warn':' is-good')));
  const action=node('td');
  const toggle=node('button','看明细','pkb-pick-toggle');
  toggle.type='button';
  toggle.onclick=event=>{event.stopPropagation();toggleDetail(tr,item);};
  action.append(toggle);

  tr.append(pick,model,name,params,features,status,action);
  tr.onclick=()=>togglePick(item,tr);
  tbody.append(tr);
 }
 table.append(head,tbody);
 wrap.replaceChildren(table);
}

function togglePick(item,row){
 if(tableState.picked.has(item.model))tableState.picked.delete(item.model);
 else tableState.picked.add(item.model);
 row.classList.toggle('is-on',tableState.picked.has(item.model));
 const box=row.querySelector('input[type=checkbox]');
 if(box)box.checked=tableState.picked.has(item.model);
 syncPickNote();
}

function toggleDetail(row,item){
 const next=row.nextElementSibling;
 if(next&&next.classList.contains('pkb-pick-detail')){
  next.remove();
  return;
 }
 const detail=node('tr',null,'pkb-pick-detail');
 const cell=node('td');
 cell.colSpan=7;
 const inner=node('div',null,'pkb-detail-inner');

 /* 参数：铺满标准字段表（45 项 / 7 段），缺的落「待补充」。
    这里跟详情抽屉走同一个渲染入口，保证两处看到的位置完全一样。 */
 const paramsBox=node('div',null,'pkb-detail-sheet');
 renderParamSheet(paramsBox,item.params||[]);
 inner.append(paramsBox);

 if((item.features||[]).length){
  const list=node('ol',null,'pkb-detail-feats');
  for(const feature of item.features)list.append(node('li',feature.title+(feature.detail?'：'+feature.detail:'')));
  inner.append(list);
 }
 cell.append(inner);
 detail.append(cell);
 row.after(detail);
}

function syncPickNote(){
 const all=(tableState.data&&tableState.data.products)||[];
 const picked=tableState.picked.size;
 const merging=all.filter(item=>tableState.picked.has(item.model)&&item.existing).length;
 get('tableAll').checked=picked>0&&picked===all.length;
 get('tablePickNote').textContent=`已选 ${picked} / ${all.length} 个型号`;
 get('saveTable').disabled=!picked;
 get('tableSaveNote').textContent=picked
  ?(merging?`其中 ${merging} 个已在库里，会合并到已有型号（参数以这次为准，卖点只增不删）`:'全部是新型号')
  :'';
}

function renderTablePreview(data){
 const stats=data.stats||{};
 get('tableStats').replaceChildren(
  statBadge('型号',stats.models??'—'),
  statBadge('参数',stats.params??'—'),
  statBadge('卖点',stats.features??'—'),
  statBadge('已在库',stats.existing??0,stats.existing?'warn':''),
  statBadge('文件',((stats.bytes||0)/1024/1024).toFixed(1)+'MB')
 );

 const warnings=get('tableWarnings');
 warnings.replaceChildren(...(data.warnings||[]).map(item=>node('li',item)));

 const skips=get('tableSkipped');
 skips.replaceChildren();
 for(const item of data.skipped||[]){
  const box=node('div',null,'pkb-skip');
  box.append(node('b',`${item.sheet} · ${item.series}`),node('br'),node('span',item.reason));
  skips.append(box);
 }
 if((data.stats&&data.stats.imageFields||[]).length){
  const box=node('div',null,'pkb-skip');
  box.append(node('b','这些项在表里是图片，读不到：'),node('br'),node('span',data.stats.imageFields.join('、')));
  skips.append(box);
 }

 renderPickTable(data);
 syncPickNote();
 setMsg('tableHint',`${stats.filename||''}　转出 ${stats.models} 个型号`);
}

async function doTablePreview(){
 const button=get('doTablePreview');
 const file=tableState.file;
 if(!file){setMsg('tableMsg','先选一个 .xlsx 文件。','bad');return;}
 if(file.size>TABLE_LIMIT){
  setMsg('tableMsg',`文件 ${(file.size/1024/1024).toFixed(1)}MB，超过 30MB。表格里大部分体积是嵌入图片：在 Excel 里把「机器图片」「内外机尺寸」几行删掉再另存，参数文字只有几百 KB。`,'bad');
  return;
 }
 button.disabled=true;
 setMsg('tableMsg','正在解析，几十 MB 的表大约 3-10 秒…');
 setMsg('tableHint','');
 try{
  const buffer=await file.arrayBuffer();
  const group=get('tableGroup').value;
  const response=await session.authorizedFetch(`/api/product-knowledge?action=table-preview&group=${encodeURIComponent(group)}`,{
   method:'POST',
   headers:{'Content-Type':'application/octet-stream','x-filename':encodeURIComponent(file.name)},
   body:buffer
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'解析失败');
  tableState.data=result.data;
  tableState.picked=new Set((result.data.products||[]).map(item=>item.model));
  get('tablePreviewBox').hidden=false;
  renderTablePreview(result.data);
  setMsg('tableMsg','解析完成。核对型号和数字，取消勾选不要的，再点保存入库。','ok');
 }catch(error){
  setMsg('tableMsg',explain(error),'bad');
 }finally{
  button.disabled=false;
 }
}

async function saveTable(){
 const button=get('saveTable');
 const all=(tableState.data&&tableState.data.products)||[];
 const list=all.filter(item=>tableState.picked.has(item.model));
 if(!list.length){setMsg('tableMsg','一个都没勾选。','bad');return;}
 button.disabled=true;
 setMsg('tableMsg',`正在写入 ${list.length} 个型号…`);
 try{
  const data=await api('table-save',{method:'POST',body:{products:list}});
  const parts=[];
  if(data.created)parts.push(`新增 ${data.created} 个`);
  if(data.merged)parts.push(`合并 ${data.merged} 个`);
  if((data.failed||[]).length)parts.push(`失败 ${data.failed.length} 个`);
  setMsg('tableMsg',`已入库：${parts.join('，')||'没有变化'}。`,'ok');
  closeDrawer(get('tableDrawer'));
  await loadList();
  setStatus(`参数表导入完成：${parts.join('，')||'没有变化'}。共 ${all.length} 个型号里选了 ${list.length} 个。`,'ok');
 }catch(error){
  setMsg('tableMsg',explain(error),'bad');
 }finally{
  button.disabled=false;
 }
}

/* ---------------- 详情 ---------------- */

/* 卖点阅读视图：连续序号 + 分类分组，每行 3 个均匀铺开。只读，不做行内编辑。 */
function renderFeatureRead(){
 const box=get('featureRead');
 const items=state.featureDraft||[];
 box.replaceChildren();
 if(!items.length){
  box.append(node('p','还没有卖点。用「导入参数表」整批进——参数表里的「卖点」列会一起转进来。','pkb-note'));
  return;
 }
 const groups=new Map();
 items.forEach((item,index)=>{
  const cat=item.cat||guessCat(item.title);
  if(!groups.has(cat))groups.set(cat,[]);
  groups.get(cat).push({item,index});
 });
 let no=0;
 for(const cat of CAT_ORDER){
  const group=groups.get(cat);
  if(!group)continue;
  box.append(node('div',`${CAT_NAMES[cat]} · ${group.length} 条`,'pkb-feat-cat'));
  const grid=node('div',null,'pkb-feat-grid');
  for(const {item} of group){
   no+=1;
   const row=node('div',null,'pkb-feat-item'+(item.needsReview?' is-review':''));
   const num=node('span',no,'pkb-feat-no');
   const body=node('div',null,'pkb-feat-body');
   const titleLine=node('div',null,'pkb-feat-title');
   titleLine.append(node('b',item.title||'（无标题）'));
   if(item.needsReview)titleLine.append(node('span','待核实','pkb-badge is-warn'));
   if(item.manual)titleLine.append(node('span','人工','pkb-badge'));
   body.append(titleLine);
   if(item.detail)body.append(node('p',item.detail,'pkb-feat-detail'));
   row.append(num,body);
   grid.append(row);
  }
  box.append(grid);
 }
}

function openFeatureRead(draft){
 if(draft)state.featureDraft=draft;
 renderFeatureRead();
}

/* ---------------- 参数标准表：任何型号都铺成同一套格子 ----------------
   问题：参数是「详情页抓到几条就存几条」，有的机器 17 条、有的 40 条。
   直接遍历渲染，字段数一变位置就全乱，主管上下对比两台机器时眼睛得重新找「制冷量在哪」。
   做法：每台机器都按标准字段表铺满（当前 45 个字段 / 7 段），没值的落灰色「待补充」，
        同一个字段在任何型号里永远在同一格。
   ⚠️ 下面 formatParamValue / TAIL_UNIT 与 lib/product/fields.js 的 formatValue 是同一条规则，
      单位口径要改必须两边一起改，否则同一台机器两处显示不一样。 */

const TAIL_UNIT=/\s*(?:kg|KW|KW\/h|W\/h|W|mm|cm|m³\/h|m3\/h|dB\(A\)|dB|℃|°C|匹|㎡|m2)\s*$/i;
const PLACEHOLDER_TEXT='待补充';
/* 影响「机型性能PK」出图的格子，缺了就标这句催填（与后端 PK_MISSING_TEXT 同一句话） */
const PK_MISSING_TEXT='请尽快填写';

/* 名字 → 字段定义（标准写法 + 别名都进索引，库里历史写法也能落到正确的格子） */
function paramFieldIndex(fields){
 const map=new Map();
 for(const field of fields||[]){
  map.set(field.key,field);
  for(const alias of field.aliases||[])map.set(alias,field);
 }
 return map;
}

/* 单位统一：库里有的写进 unit、有的塞在值尾部（"35/42kg"），先剥再拼，避免「35/42kg kg」 */
function formatParamValue(field,raw){
 const text=String(raw==null?'':raw).trim();
 if(!text)return '';
 const unit=field.unit||'';
 if(!unit)return text;
 const body=text.replace(TAIL_UNIT,'').trim()||text;
 if(/^(支持|不支持|有|无|是|否|待核实|不详)$/.test(body))return body;
 if(/dB/i.test(unit)&&/d\s*b/i.test(body))return body;
 return body+' '+unit;
}

/* 参数数组 → 分段铺满的结构。字段表里没登记的名字单独成段，绝不静默丢掉。
   trackPk：要不要为「机型性能PK」催补字段。只有确实有销量的型号才催——
   零销量的型号（760 台，多为非在售/老机型）不拿这个提醒去烦人，格子照样显示待补充。 */
function buildParamSheets(params,trackPk=true){
 const fields=state.paramFields.fields||[];
 const sections=state.paramFields.sections||[];
 if(!fields.length)return null;
 const index=paramFieldIndex(fields);
 const byKey=new Map();
 const unknown=[];
 for(const item of params||[]){
  if(!item)continue;
  const name=String(item.name==null?'':item.name).trim();
  const field=name?index.get(name):null;
  if(!field){if(name)unknown.push(item);continue;}
  if(!byKey.has(field.key))byKey.set(field.key,item);
 }
 const out=sections.map(section=>{
  const items=fields.filter(field=>field.section===section.id).map(field=>{
   const hit=byKey.get(field.key);
   const has=Boolean(hit&&String(hit.value==null?'':hit.value).trim());
   /* pkMissingRaw：这台机器到底缺几项 PK 字段（事实，与催不催无关）；
      pkMissing：要不要标红催填（零销量型号为 false）。两者分开才不会把「字段齐全」也说成缺。 */
   const pkMissingRaw=Boolean(field.pk)&&!has;
   const pkMissing=trackPk&&pkMissingRaw;
   return {
    key:field.key,
    label:field.label||field.key,
    unit:field.unit||'',
    extra:Boolean(field.extra),
    pk:Boolean(field.pk),
    pkMissing,
    pkMissingRaw,
    missing:!has,
    display:has?formatParamValue(field,hit.value):PLACEHOLDER_TEXT,
    needsReview:Boolean(hit&&hit.needsReview),
    manual:Boolean(hit&&hit.manual)
   };
  });
  return {
   id:section.id,label:section.label,hint:section.hint||'',
   total:items.length,
   filled:items.filter(item=>!item.missing).length,
   pkMissing:items.filter(item=>item.pkMissing).length,
   pkMissingRaw:items.filter(item=>item.pkMissingRaw).length,
   items
  };
 });
 if(unknown.length){
  out.push({
   id:'unregistered',
   label:'未归类参数',
   hint:'库里存在，但标准字段表还没登记；先原样显示，确认后补进字段表',
   total:unknown.length,
   filled:unknown.length,
   items:unknown.map(item=>({
    key:String(item.name||''),
    label:String(item.name||'（未命名）'),
    unit:String(item.unit||''),
    extra:false,pk:false,pkMissing:false,missing:false,
    display:[item.value,item.unit].filter(Boolean).join(' ')||'—',
    needsReview:Boolean(item.needsReview),
    manual:Boolean(item.manual)
   }))
  });
 }
 const filled=out.filter(section=>section.id!=='unregistered').reduce((sum,section)=>sum+section.filled,0);
 const pkItems=out.filter(section=>section.id!=='unregistered').flatMap(section=>section.items).filter(item=>item.pk);
 const pkMissingItems=pkItems.filter(item=>item.pkMissing);
 const pkMissingRawItems=pkItems.filter(item=>item.pkMissingRaw);
 return {
  total:fields.length,filled,pending:fields.length-filled,
  pkTotal:pkItems.length,
  pkMissing:pkMissingItems.length,
  pkMissingLabels:pkMissingItems.map(item=>item.label),
  /* 事实层面的缺口（不管催不催），零销量型号的说明文案要用它 */
  pkMissingRaw:pkMissingRawItems.length,
  pkMissingRawLabels:pkMissingRawItems.map(item=>item.label),
  sections:out
 };
}

/* 老进程 / meta 没拿到字段表时的兜底：按原样列出，至少不白屏 */
function renderParamRaw(container,params){
 const list=params||[];
 if(!list.length){
  container.append(node('p','这台机器还没有参数。用「导入参数表」整批进；空调类参数导入后锁定，手填不进来。','pkb-note'));
  return;
 }
 container.append(node('p','参数标准表没加载到，先按原样显示（刷新页面可恢复统一排版）。','pkb-note'));
 const grid=node('div',null,'pkb-param-grid');
 for(const item of list){
  const cell=node('div',null,'pkb-param-item'+(item.needsReview?' is-review':''));
  cell.append(node('span',item.name||'（未命名）','pkb-param-name'));
  cell.append(node('span',[item.value,item.unit].filter(Boolean).join(' ')||'—','pkb-param-value'));
  grid.append(cell);
 }
 container.append(grid);
}

/* 统一渲染入口：列表行展开、详情抽屉都走这里，两处永远一致。
   options.units：这台机器的累计销量。传 0 = 确实没销量 → 不催补 PK 字段；
   不传（比如导入预览里还没入库的型号）= 情况不明 → 照旧提示。 */
function renderParamSheet(container,params,options){
 container.replaceChildren();
 const trackPk=!options||options.units==null?true:Number(options.units)>0;
 const sheet=buildParamSheets(params,trackPk);
 if(!sheet){
  renderParamRaw(container,params);
  return;
 }
 const head=node('div',null,'pkb-psheet-summary');
 head.append(node('b',`${sheet.total} 项标准参数`));
 head.append(node('span',`本机有 ${sheet.filled} 项`));
 head.append(node('span',`${sheet.pending} 项待补充`,'is-muted'));
 if(!sheet.filled)head.append(node('span','这台机器还没有任何参数，全部显示为待补充','is-muted'));
 container.append(head);

 /* PK 缺口单独拉一条：主管不用在 45 个格子里找哪几项出图会空着。
    没有缺口时也给一句确认，免得「没提示」被误读成「没检查」。
    零销量的型号只给一句灰字说明为什么不催，不标红、不写「请尽快填写」。 */
 if(sheet.pkTotal&&!trackPk){
  if(!sheet.pkMissingRaw){
   /* 零销量但字段本来就齐：别摆一条「暂不催补」让人以为缺东西 */
   const bar=node('div',null,'pkb-psheet-pk is-clear');
   bar.append(node('b','机型性能PK 需要的字段都齐了'));
   bar.append(node('small','这台暂时没有结算销量，参数已经够出图'));
   container.append(bar);
  }else{
   const bar=node('div',null,'pkb-psheet-pk is-idle');
   bar.append(node('b','这台没有结算销量，暂不催补 PK 参数'));
   bar.append(node('small',`机型性能PK 要用的 ${sheet.pkTotal} 项里还空着 ${sheet.pkMissingRaw} 项：`));
   bar.append(node('span',sheet.pkMissingRawLabels.join('、'),'pkb-psheet-pk-list'));
   bar.append(node('small','等它开始出货再补，补齐后重新导入参数表即可。'));
   container.append(bar);
  }
 }else if(sheet.pkTotal){
  const bar=node('div',null,'pkb-psheet-pk'+(sheet.pkMissing?'':' is-clear'));
  if(sheet.pkMissing){
   bar.append(node('b',`机型性能PK 缺 ${sheet.pkMissing} 项`));
   bar.append(node('small','这几项空着，PK 图和选购指南对应那一行就是「—」。补齐后重新导入参数表即可。'));
   /* 缺哪几项单独一行：字段名长短不一，挤在同一行会把后面的说明文字顶出框外 */
   bar.append(node('span',sheet.pkMissingLabels.join('、'),'pkb-psheet-pk-list'));
  }else{
   bar.append(node('b','机型性能PK 需要的字段都齐了'));
   bar.append(node('small',`${sheet.pkTotal} 项全部有值，可以直接出图`));
  }
  container.append(bar);
 }

 for(const section of sheet.sections){
  const wrap=node('section',null,'pkb-psheet-sec');
  const sectionHead=node('header',null,'pkb-psheet-head');
  sectionHead.append(node('b',section.label));
  sectionHead.append(node('em',`${section.filled} / ${section.total} 项`));
  if(section.pkMissing)sectionHead.append(node('small',`PK 作图缺 ${section.pkMissing} 项`,'is-pk'));
  if(section.hint)sectionHead.append(node('small',section.hint));
  wrap.append(sectionHead);

  const grid=node('div',null,'pkb-psheet-grid');
  for(const item of section.items){
   const cell=node('div',null,'pkb-pfield'+(item.missing?' is-missing':'')+(item.pkMissing?' is-pk':'')+(item.needsReview?' is-review':''));
   cell.title=item.label+'：'+item.display+(item.pkMissing?'（机型性能PK 需要这一项，请尽快填写）':'');
   cell.append(node('span',item.label,'pkb-pfield-name'));
   const value=node('span',null,'pkb-pfield-value');
   /* 值单独包一层做「最多两行」截断：格子高度因此恒定，
      长值换行只会让自己这一格少显示几个字，不会把后面的字段推下去（一推就全乱）。 */
   value.append(node('span',item.display,'pkb-pfield-text'));
   if(item.pkMissing)value.append(node('span',PK_MISSING_TEXT,'pkb-badge is-pk'));
   if(item.needsReview)value.append(node('span','待核实','pkb-badge is-warn'));
   if(item.manual)value.append(node('span','人工','pkb-badge'));
   cell.append(value);
   grid.append(cell);
  }
  wrap.append(grid);
  container.append(wrap);
 }
}

/* 参数只读视图（详情抽屉）：45 个标准字段全铺开，缺的落「待补充」，不做折叠。
   units 决定要不要催补 PK 字段（零销量不催）。 */
function openParamRead(draft,units){
 state.paramDraft=draft||[];
 renderParamSheet(get('paramRead'),state.paramDraft,{units});
}

function rowShell(kind,item){
 const row=node('div',null,'pkb-row'+(item&&item.needsReview?' is-review':''));
 row.dataset.kind=kind;
 row.__item=item||{};
 return row;
}
function input(placeholder,value,max){
 const el=document.createElement('input');
 el.placeholder=placeholder||'';
 el.value=value==null?'':String(value);
 if(max)el.maxLength=max;
 return el;
}
function delButton(row){
 const button=node('button','删除','pkb-row-del');
 button.type='button';
 button.onclick=()=>row.remove();
 return button;
}

function renderRows(kind,container,items){
 container.replaceChildren();
 for(const item of items||[]){
  const row=rowShell(kind,item);
  if(kind==='feature'){
   const main=node('div',null,'pkb-row-main');
   const title=input('卖点名，如：自清洁',item.title,40);
   title.dataset.f='title';
   const detail=document.createElement('textarea');
   detail.rows=2;detail.value=item.detail||'';detail.dataset.f='detail';
   const keywords=input('顾客可能说法，逗号分隔，如：费电,电费',(item.keywords||[]).join(','));
   keywords.dataset.f='keywords';
   const meta=node('div',null,'pkb-row-meta');
   const stage=document.createElement('select');
   stage.dataset.f='stage';
   for(const [value,label] of [['pre_sale','售前'],['after_sale','售后'],['both','两者都算']]){
    const option=node('option',label);option.value=value;stage.append(option);
   }
   stage.value=item.stage||'pre_sale';
   if(item.needsReview)meta.append(node('span','待核实：原文没找到对应文字','pkb-badge is-warn'));
   if(item.manual)meta.append(node('span','人工维护','pkb-badge'));
   /* 关键词与售前/售后同一行：卖点一条一行太高，翻起来累 */
   const line=node('div');
   line.style.display='grid';
   line.style.gridTemplateColumns='minmax(0,1fr) 120px';
   line.style.gap='6px';
   line.style.marginTop='6px';
   line.append(keywords,stage);
   main.append(title,detail,line);
   if(meta.children.length)main.append(meta);
   row.append(main,delButton(row));
  }else if(kind==='param'){
   const name=input('参数名，如：噪音',item.name,16);
   name.dataset.f='name';
   const value=input('值，如：21',item.value,40);
   value.dataset.f='value';
   const unit=input('单位，如：dB(A)',item.unit,10);
   unit.dataset.f='unit';
   const cell=node('div',null,'pkb-row-main');
   const line=node('div');line.style.display='grid';line.style.gridTemplateColumns='1fr 1fr 90px';line.style.gap='6px';
   line.append(name,value,unit);
   const meta=node('div',null,'pkb-row-meta');
   if(item.needsReview)meta.append(node('span','待核实','pkb-badge is-warn'));
   if(item.manual)meta.append(node('span','人工维护','pkb-badge'));
   cell.append(line,meta);
   row.append(cell,delButton(row));
  }else{
   const label=input(kind==='appearance'?'外观项，如：颜色':'口径名，如：整机保修',item.label||item.name,16);
   label.dataset.f=kind==='appearance'?'label':'name';
   const value=input('值',item.value,80);
   value.dataset.f='value';
   const cell=node('div',null,'pkb-row-main');
   const line=node('div');line.style.display='grid';line.style.gridTemplateColumns='1fr 1.4fr';line.style.gap='6px';
   line.append(label,value);
   cell.append(line);
   row.append(cell,delButton(row));
  }
  container.append(row);
 }
}

const SECTION_MAP={appearance:'appearanceRows',service:'serviceRows'};

/* 手动新建：纯图片详情页、或运营手上只有一张参数表时走这条路。
   state.detail=null 表示「这次是在新建」，保存时走新增分支。 */
function openBlank(){
 state.detail=null;
 state.match=null;
 state.featureDraft=[];
 get('detailTitle').textContent='新建型号';
 get('detailSub').textContent='先填型号和商品标题，再按需加卖点、参数。保存后才出现在台账里。';
 get('detailModel').value='';
 get('detailName').value='';
 get('detailMeta').textContent=`${groupLabel(state.group)} · 还没入库`;
 openParamRead([],0);
 renderRows('appearance',get('appearanceRows'),[]);
 openFeatureRead([]);
 get('matchList').replaceChildren();
 /* 新建时这台机器还没入库，不能沿用上一次打开的型号的图（否则会串图，2026-10-28 修复） */
 renderImages(get('mainImages'),null,'保存入库后，可在「导入图片」里上传详情头图压缩包。');
 renderImages(get('detailImages'),null,'保存入库后，可在「导入图片」里上传详情图压缩包。');
 get('stage2').open=false;
 setMsg('detailMsg','');
 get('deleteProduct').hidden=true;
 get('saveDetail').hidden=false;
 get('saveDetail').textContent='保存入库';
 get('findSessions').disabled=true;
 openDrawer(get('detailDrawer'));
 get('detailModel').focus();
}

function openDetail(id,retried){
 const item=state.products.find(product=>product.id===id);
 if(!item){
  if(retried){setStatus('列表里找不到这个型号，刷新一下再试。','bad');return;}
  /* 可能是刚保存、或当前搜索把它过滤掉了：清掉搜索重拉一次再定位 */
  state.q='';
  get('search').value='';
  loadList().then(()=>openDetail(id,true)).catch(error=>setStatus(explain(error),'bad'));
  return;
 }
 state.detail=item;
 state.match=null;
 const data=item.data||{};
 get('detailTitle').textContent=data.model||'未填型号';
 get('detailSub').textContent=data.name||'—';
 get('detailModel').value=data.model||'';
 get('detailName').value=data.name||'';
 get('detailMeta').textContent=[
  groupLabel(data.group),
  data.series?`系列 ${data.series}`:(data.shopSeries?`在售系列 ${data.shopSeries}`:''),
  data.tier?`档位 ${data.tier}`:'',
  data.distribution?`分销 ${data.distribution}`:'',
  data.materialCode?`物料编码 ${data.materialCode}`:'',
  Number(item.units||0)?`累计销量 ${formatUnits(item.units)} 台`:'无结算销量',
  `卖点 ${(data.features||[]).length}`,
  `参数 ${(data.params||[]).length}`,
  `外观 ${(data.appearance||[]).length}`,
  item.updatedAt?`更新于 ${fmtTime(item.updatedAt)}`:''
 ].filter(Boolean).join(' · ')+((data.source&&data.source.name)?` · 来源：${data.source.name}`:'');
 openParamRead(data.params||[],item.units);
 renderRows('appearance',get('appearanceRows'),data.appearance);
 openFeatureRead(data.features||[]);
 get('matchList').replaceChildren();
 get('matchNote').textContent='点「查相关会话」，拿这台机器的型号和卖点去最近导入的对话里找。';
 get('stage2').open=false;
 setMsg('detailMsg','');
 get('findSessions').disabled=!canWrite();
 get('deleteProduct').hidden=!canWrite();
 get('saveDetail').hidden=!canWrite();
 get('saveDetail').textContent='保存修改';
 openDrawer(get('detailDrawer'));
 loadProductImages(item.id);
}

/* ---------------- 详情图片（商品主图 / 商品详情） ---------------- */
async function loadProductImages(id){
 const mainBox=get('mainImages');
 const detailBox=get('detailImages');
 mainBox.replaceChildren(node('p','正在加载图片…','pkb-note'));
 detailBox.replaceChildren();
 try{
  const data=await api('images',{params:{id}});
  renderImages(mainBox,data.main,'还没有商品主图。在「导入图片」里上传详情头图压缩包。');
  renderImages(detailBox,data.detail,'还没有商品详情。在「导入图片」里上传详情图压缩包。');
 }catch(error){
  mainBox.replaceChildren(node('p','图片加载失败：'+explain(error),'pkb-note is-bad'));
 }
}
function renderImages(box,group,fallback){
 box.replaceChildren();
 const items=(group&&group.items)||[];
 if(!items.length){
  box.append(node('p',fallback,'pkb-note'));
  return;
 }
 for(const [index,item] of items.entries()){
  const wrap=node('figure',null,'pkb-img-item');
  const img=node('img');
  img.src=item.dataUrl;
  img.alt=item.name;
  img.loading='lazy';
  img.onclick=()=>window.open(img.src,'_blank');
  wrap.append(img,node('figcaption',`${index+1} · ${(item.bytes/1024).toFixed(0)}KB`));
  box.append(wrap);
 }
}

function collectRows(container,kind){
 const out=[];
 const same=(a,b)=>String(a==null?'':a).trim()===String(b==null?'':b).trim();
 for(const row of container.querySelectorAll('.pkb-row')){
  const original=row.__item||{};
  const isNew=!row.__item;
  const field=f=>{const el=row.querySelector(`[data-f="${f}"]`);return el?el.value.trim():'';};
  let next=null;
  if(kind==='feature'){
   const title=field('title');
   if(!title)continue;
   const keywords=field('keywords').split(/[,，;；\s]+/).filter(Boolean).slice(0,4);
   const detail=field('detail');
   const stage=field('stage')||'pre_sale';
   const changed=!same(title,original.title)||!same(detail,original.detail)||!same(stage,original.stage)||
    keywords.join(',')!==(original.keywords||[]).join(',');
   next={...original,title,detail,keywords,stage,manual:Boolean(original.manual)||isNew||changed};
  }else if(kind==='param'){
   const name=field('name');
   const value=field('value');
   if(!name||!value)continue;
   const unit=field('unit');
   const changed=!same(name,original.name)||!same(value,original.value)||!same(unit,original.unit);
   next={...original,name,value,unit,manual:Boolean(original.manual)||isNew||changed};
  }else{
   const keyField=kind==='appearance'?'label':'name';
   const label=field(keyField);
   const value=field('value');
   if(!label||!value)continue;
   const changed=!same(label,original[keyField])||!same(value,original.value);
   next={...original,[keyField]:label,value,manual:Boolean(original.manual)||isNew||changed};
  }
  out.push(next);
 }
 return out;
}

async function saveDetail(){
 const editing=Boolean(state.detail);
 const button=get('saveDetail');
 button.disabled=true;
 setMsg('detailMsg','正在保存…');
 try{
  const base=editing?(state.detail.data||{}):{group:state.group};
  const product={
   ...base,
   group:base.group||state.group,
   model:get('detailModel').value.trim(),
   name:get('detailName').value.trim(),
   features:state.featureDraft,
   params:state.paramDraft,
   appearance:collectRows(get('appearanceRows'),'appearance'),
   /* 售后口径这一期没有编辑入口（后续单独规划），保存时原样保留库里已有内容 */
   service:base.service||[]
  };
  if(!product.model){setMsg('detailMsg','型号不能为空。','bad');return;}
  const saved=await api('save',{method:'POST',body:{id:editing?state.detail.id:null,merge:false,product}});
  setMsg('detailMsg',editing?'已保存。':'已入库。','ok');
  await loadList();
  if(saved&&saved.id)openDetail(saved.id);
 }catch(error){
  setMsg('detailMsg',explain(error),'bad');
 }finally{
  button.disabled=false;
 }
}

async function deleteProduct(){
 if(!state.detail)return;
 const data=state.detail.data||{};
 if(!confirm(`确定删除型号「${data.model||'未填型号'}」？\n它的卖点、参数和已生成的修正建议都会一起删掉，且无法恢复。`))return;
 try{
  await api('delete',{method:'POST',body:{id:state.detail.id}});
  closeDrawer(get('detailDrawer'));
  await loadList();
  setStatus(`已删除 ${data.model||'该型号'}。`,'ok');
 }catch(error){
  setMsg('detailMsg',explain(error),'bad');
 }
}

/* ---------------- 相关会话与建议 ---------------- */
function hitChips(hits){
 const box=node('div',null,'pkb-session-hits');
 for(const hit of hits||[]){
  const badge=node('span',(hit.kind==='model'?'型号 ':'')+hit.word,'pkb-badge'+(hit.kind==='model'?' is-good':''));
  box.append(badge);
 }
 return box;
}

async function findSessions(){
 if(!state.detail)return;
 const button=get('findSessions');
 button.disabled=true;
 get('matchNote').textContent='正在扫描最近导入的会话…';
 get('matchList').replaceChildren();
 try{
  const data=await api('match',{method:'POST',body:{productId:state.detail.id}});
  state.match=data;
  renderMatch(data);
 }catch(error){
  get('matchNote').textContent=explain(error);
 }finally{
  button.disabled=false;
 }
}

function renderMatch(data){
 const list=get('matchList');
 list.replaceChildren();
 get('matchNote').textContent=data.sessions.length
  ? `扫描 ${data.stats.scanned} 通会话，命中 ${data.stats.matched} 通（其中 ${data.stats.modelHits} 通直接提到型号）。点「看修正建议」让 AI 对照知识库挑出答得不到位的地方。`
  : `扫描 ${data.stats.scanned} 通会话，没有命中。可能是这段时间没人问这台机器，或型号/卖点关键词太窄（可在上面补关键词）。`;
 if(!data.sessions.length)return;
 for(const item of data.sessions){
  const card=node('div',null,'pkb-session');
  const head=node('div',null,'pkb-session-head');
  head.append(node('b',item.ordinal?'#'+item.ordinal:'会话'),node('span',fmtTime(item.startedAt)),node('span',item.agent||'未记录客服'));
  if(item.modelHit)head.append(node('span','含型号','pkb-badge is-good'));
  const ask=node('p','「'+(item.excerpt||'（顾客没留文字）')+'」','pkb-session-ask');
  const acts=node('div',null,'pkb-session-acts');
  const adviceBtn=node('button','看修正建议');
  adviceBtn.type='button';
  const msgsBtn=node('button','看原文');
  msgsBtn.type='button';
  acts.append(adviceBtn,msgsBtn);
  const slot=node('div');
  adviceBtn.onclick=()=>loadAdvice(item.sessionId,slot,adviceBtn);
  msgsBtn.onclick=()=>loadMessages(item.sessionId,slot,msgsBtn);
  card.append(head,ask,hitChips(item.hits),acts,slot);
  list.append(card);
 }
}

const VERDICT_LABEL={missing:['没答到','is-bad'],wrong:['答错了','is-bad'],vague:['太含糊','is-warn'],covered:['答到了','is-good']};
const KIND_LABEL={param:'参数',feature:'卖点',service:'售后',appearance:'外观'};

function renderAdvice(target,advice){
 target.replaceChildren();
 const box=node('div',null,'pkb-advice');
 if(advice.summary)box.append(node('p',advice.summary,'pkb-advice-sum'));
 for(const item of advice.items||[]){
  const card=node('div',null,'pkb-advice-item');
  const top=node('div',null,'pkb-advice-top');
  const [label,cls]=VERDICT_LABEL[item.verdict]||['建议',''];
  top.append(node('span',label,'pkb-badge '+cls));
  top.append(node('span',`${KIND_LABEL[item.factKind]||'资料'}：${item.factRef}=${item.factValue}`));
  if(item.needsReview)top.append(node('span','待核实','pkb-badge is-warn'));
  card.append(top);
  if(item.askText)card.append(node('p','顾客：'+item.askText,'pkb-advice-ask'));
  if(item.why)card.append(node('p','缺在哪：'+item.why,'pkb-advice-why'));
  if(item.suggestedReply)card.append(node('p','建议这么答：'+item.suggestedReply,'pkb-advice-reply'));
  box.append(card);
 }
 if(!(advice.items||[]).length)box.append(node('p','这段对话在产品信息上没有需要改的地方。','pkb-note'));
 if((advice.warnings||[]).length){
  const ul=node('ul',null,'pkb-warnings');
  for(const warning of advice.warnings)ul.append(node('li',warning));
  box.append(ul);
 }
 const foot=node('div',null,'pkb-session-acts');
 const again=node('button','重新生成');
 again.type='button';
 again.onclick=()=>loadAdvice(advice.sessionId,target,again,true);
 foot.append(again,node('span',advice.cached?'已缓存':'本次生成','pkb-note'));
 box.append(foot);
 target.append(box);
}

async function loadAdvice(sessionId,target,button,force){
 button.disabled=true;
 target.replaceChildren(node('p','正在生成建议…（AI 大约 5-15 秒，同一段对话只算一次）','pkb-note'));
 try{
  const data=await api('advise',{method:'POST',body:{sessionId,productId:state.detail.id,force:Boolean(force)}});
  renderAdvice(target,{...data.advice,sessionId,cached:data.cached});
 }catch(error){
  target.replaceChildren(node('p',explain(error),'pkb-note is-bad'));
 }finally{
  button.disabled=false;
 }
}

async function loadMessages(sessionId,target,button){
 if(target.querySelector('.pkb-msgs')){
  target.replaceChildren();
  return;
 }
 button.disabled=true;
 try{
  const data=await api('session',{params:{id:sessionId}});
  const box=node('div',null,'pkb-msgs');
  for(const message of data.messages||[]){
   const line=node('div',null,'pkb-msg'+(message.role==='agent'?' is-agent':''));
   line.append(node('b',message.role==='agent'?'客服':'顾客'));
   line.append(node('time',String(message.at||'').slice(11,19)));
   line.append(document.createTextNode(String(message.text||'')));
   box.append(line);
  }
  if(!box.children.length)box.append(node('p','这段会话没有可显示的消息。','pkb-note'));
  target.replaceChildren(box);
 }catch(error){
  target.replaceChildren(node('p',explain(error),'pkb-note is-bad'));
 }finally{
  button.disabled=false;
 }
}

/* ---------------- 详情图片压缩包导入 ---------------- */
const ZIP_LIMIT=30*1024*1024;
let zipState={file:null};

async function doZipImport(){
 const button=get('doZipImport');
 const file=zipState.file;
 const kind=document.querySelector('input[name="zipKind"]:checked');
 if(!file){setMsg('zipMsg','先选一个 .zip 压缩包。','bad');return;}
 if(!kind){setMsg('zipMsg','先选这包图片是「详情头图」还是「详情图」。','bad');return;}
 if(file.size>ZIP_LIMIT){setMsg('zipMsg',`压缩包 ${(file.size/1024/1024).toFixed(1)}MB，超过 30MB。回格力系统按型号分批导出。`,'bad');return;}
 button.disabled=true;
 setMsg('zipMsg','正在上传解压…（压缩包越大越慢，几 MB 大约 2-5 秒）');
 setMsg('zipHint','');
 try{
  const buffer=await file.arrayBuffer();
  const response=await session.authorizedFetch(`/api/product-knowledge?action=images-import&kind=${kind.value}`,{
   method:'POST',
   headers:{'Content-Type':'application/octet-stream','x-filename':encodeURIComponent(file.name)},
   body:buffer
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'导入失败');
  const data=result.data||{};
  const modelCount=(data.models||[]).length;
  const parts=[`导入图片 ${data.images||0} 张，挂上 ${modelCount} 个型号`];
  if((data.unmatchedCodes||[]).length)parts.push(`${data.unmatchedCodes.length} 个主数据编码在库里没有对应型号（跳过）`);
  if((data.skipped||[]).length)parts.push(`跳过 ${data.skipped.length} 个不符合命名的文件`);
  setMsg('zipMsg',parts.join('；')+'。','ok');
  if(modelCount)setMsg('zipHint','挂上的型号：'+(data.models||[]).slice(0,6).map(m=>m.model).join('、')+((data.models||[]).length>6?' …':''));
  if(state.detail&&canWrite())loadProductImages(state.detail.id);
  await loadList().catch(()=>{});
 }catch(error){
  setMsg('zipMsg',explain(error),'bad');
 }finally{
  button.disabled=false;
 }
}

/* ---------------- 事件 ---------------- */
get('importOpen').onclick=openImport;
get('tableImport').onclick=openTableImport;
get('tableClose').onclick=()=>closeDrawer(get('tableDrawer'));
get('newProduct').onclick=openBlank;
get('importClose').onclick=()=>closeDrawer(get('importDrawer'));
get('detailClose').onclick=()=>closeDrawer(get('detailDrawer'));
get('scrim').onclick=()=>{closeDrawer(get('importDrawer'));closeDrawer(get('detailDrawer'));closeDrawer(get('tableDrawer'));};
get('doTablePreview').onclick=doTablePreview;
get('saveTable').onclick=saveTable;
get('saveDetail').onclick=saveDetail;
get('deleteProduct').onclick=deleteProduct;
get('findSessions').onclick=findSessions;
get('rescan').onclick=()=>loadList().catch(error=>setStatus(explain(error),'bad'));

get('pickZip').onclick=()=>get('zipFile').click();
get('zipFile').onchange=event=>{
 const file=event.target.files&&event.target.files[0];
 if(!file)return;
 zipState.file=file;
 get('zipFileName').textContent=`${file.name}（${(file.size/1024/1024).toFixed(1)}MB）`;
 setMsg('zipMsg','');
 setMsg('zipHint','');
 /* 文件名带「头图」就自动选商品主图 */
 if(/头图|白底|主图/.test(file.name))get('zipKindMain').checked=true;
 else if(/详情图|detail/.test(file.name))get('zipKindDetail').checked=true;
};
get('doZipImport').onclick=doZipImport;

get('pickTable').onclick=()=>get('tableFile').click();
get('tableFile').onchange=event=>{
 const file=event.target.files&&event.target.files[0];
 if(!file)return;
 tableState.file=file;
 const mb=(file.size/1024/1024).toFixed(1);
 get('tableFileName').textContent=`${file.name}（${mb}MB）`;
 get('tablePreviewBox').hidden=true;
 tableState.data=null;
 tableState.picked=new Set();
 setMsg('tableMsg',file.size>TABLE_LIMIT?`文件 ${mb}MB 超过 30MB 上限，先删掉图片列再另存。`:'已选择文件，点「解析预览」开始转置。',file.size>TABLE_LIMIT?'bad':'');
};
get('tableAll').onchange=()=>{
 const all=(tableState.data&&tableState.data.products)||[];
 const on=get('tableAll').checked;
 tableState.picked=new Set(on?all.map(item=>item.model):[]);
 for(const row of get('tablePickWrap').querySelectorAll('tr.pkb-pick-row')){
  const item=all[Number(row.dataset.index)];
  if(!item)continue;
  row.classList.toggle('is-on',on);
  const box=row.querySelector('input[type=checkbox]');
  if(box)box.checked=on;
 }
 syncPickNote();
};

let searchTimer=null;
get('search').oninput=()=>{
 state.q=get('search').value.trim();
 clearTimeout(searchTimer);
 searchTimer=setTimeout(()=>{loadList().catch(error=>setStatus(explain(error),'bad'));},260);
};

/* 排序切换：只改排序口径，不重新算任何数据（销量是服务端聚合好的） */
get('sortSelect').onchange=()=>{
 state.sort=get('sortSelect').value;
 loadList().catch(error=>setStatus(explain(error),'bad'));
};

get('exportBtn').onclick=async()=>{
 try{
  const response=await session.authorizedFetch('/api/product-knowledge?action=export&group='+encodeURIComponent(state.group));
  if(!response.ok)throw Error('导出失败');
  const url=URL.createObjectURL(await response.blob());
  const link=document.createElement('a');
  link.href=url;
  link.download=`产品知识库-${groupLabel(state.group)}.csv`;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  setStatus('已导出 CSV，可用 Excel 打开。','ok');
 }catch(error){
  setStatus(explain(error),'bad');
 }
};

for(const button of document.querySelectorAll('[data-add]')){
 button.onclick=()=>{
  const kind=button.dataset.add;
  const container=get(SECTION_MAP[kind]);
  renderRows(kind,container,[...collectRows(container,kind),{}]);
  const rows=container.querySelectorAll('.pkb-row');
  const last=rows[rows.length-1];
  const first=last&&last.querySelector('input');
  if(first)first.focus();
 };
}

document.addEventListener('keydown',event=>{
 if(event.key!=='Escape')return;
 if(!get('tableDrawer').hidden)closeDrawer(get('tableDrawer'));
 else if(!get('importDrawer').hidden)closeDrawer(get('importDrawer'));
 else if(!get('detailDrawer').hidden)closeDrawer(get('detailDrawer'));
});

/* ---------------- 启动 ---------------- */
try{
 const identity=await session.getIdentity();
 WorkbenchShell.mountShell({
  container:get('shell'),
  activeModule:'product-kb',
  identity,
  onLogout:async()=>{await session.logout();location.replace('/login.html');}
 });
 role=(identity.user&&identity.user.role)||'viewer';
 const meta=await api('meta');
 state.groups=meta.groups||[];
 state.ai=meta.ai||{};
 state.paramFields=meta.paramFields||{sections:[],fields:[]};
 role=meta.role||role;
 get('importOpen').hidden=!canWrite();
 get('tableImport').hidden=!canWrite();
 get('newProduct').hidden=!canWrite();
 get('exportBtn').hidden=false;
 await loadList();
}catch(error){
 setStatus(explain(error),'bad');
 get('boardNote').textContent='加载失败：'+explain(error);
}
})();
