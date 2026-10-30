(async()=>{
'use strict';
/* 机型性能PK —— 产品知识库的第二个出口。
   流程：选 2~4 台 → 后端按 id 抽参数（pk-fields）→ canvas 往底图空位回填 → 下载 PNG。
   铁律沿用视觉设计：AI 不参与出图，本地 canvas 合成；知识库没有的参数显示「—」，不编造。 */

const session=WorkbenchSession.createSessionClient();
const get=id=>document.getElementById(id);

const state={
 groups:[],group:'gree-ac',q:'',
 products:[],           /* 当前分组的可选机型（搜索时会整个换掉）*/
 picked:[],             /* 已选 product id，按点选顺序 */
 pickedMap:{},          /* id → {id,data} 点选时的快照。已选信息只认这里，搜索换列表不影响已选 */
 heroId:null,           /* 推荐位（最后一列橙色列）*/
 models:[],             /* pk-fields 返回的对比数据 */
 reasons:{},            /* 员工改过的推荐理由 */
 drawn:false,
 template:'pk'          /* pk=空调性能PK（2~4台） guide=选购指南（固定4台） */
};

/* ---------- 基础 ---------- */
function setStatus(message,tone){
 const el=get('status');
 el.textContent=message||'';
 el.className='pk-note'+(tone?' is-'+tone:'');
}
function explain(error){
 const text=String((error&&error.message)||error||'').trim()||'未知错误';
 if(/接口不存在|旧代码/.test(text))return '后台服务还在跑旧代码。双击「启动工作台.command」，显示「启动成功」后刷新本页。';
 if(/401|未登录|过期/.test(text))return '登录状态已过期，请重新登录。';
 return text;
}
async function api(action,params={}){
 const query=new URLSearchParams({action,...params});
 const response=await session.authorizedFetch('/api/product-knowledge?'+query);
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'请求失败');
 return result.data;
}

/* ---------- 画布几何（取自规范 SVG 源码，1122×1402） ---------- */
const W=1122,H=1402,END=1102,LABEL_END=170;
const COLS={2:[170,636],3:[170,481,791],4:[170,403,636,869]};
const Y_PILL=257,Y_CODE=312,AC_Y=348,AC_H=138,Y_REASON=521,Y_APF=638,Y_AIR=757;
const T2_Y=[875,959,1043,1127,1211,1295];
const T2_KEYS=['copper','eco','temp','clean','ctrl','kwh'];
const BG_URL={2:'/assets/pk/pk-bg-2col.png?v=20261028-pk1',3:'/assets/pk/pk-bg-3col.png?v=20261028-pk1',4:'/assets/pk/pk-bg-4col.png?v=20261028-pk1',
 guide:'/assets/pk/guide-bg-clean.png?v=20261028-pk6'};

/* ---------- 模板二「选购指南」几何（抹字自 750×1041 原图） ---------- */
const G_W=750,G_H=1041;
const G_CENTERS=[210,369,517,660];
const G_COLX=[[126,286],[293,446],[455,577],[581,740]];
const G_PILLW=[110,144,114,144];   /* 机名胶囊内部宽度 */
const G_PILL_Y=148;
const G_AC={y:175,w:130,h:112};    /* 产品图槽位 */
/* 11 行参数：key 与 pk-fields 的字段对应；y=行文字中心 */
const G_ROWS=[
 {key:'reason',  y:344,size:20,weight:800,maxLines:2},
 {key:'apf',     y:444,size:27,weight:800,special:'apf'},
 {key:'temp',    y:495,size:19,weight:600,maxLines:2},
 {key:'vane',    y:541,size:19,weight:600,maxLines:2},
 {key:'clean',   y:588,size:17,weight:600,maxLines:2},
 {key:'air',     y:628,size:24,weight:800,special:'air'},
 {key:'swing',   y:690,size:18,weight:600,maxLines:3},
 {key:'ctrlText',y:750,size:16,weight:500,maxLines:2},
 {key:'tempctl', y:797,size:19,weight:600,maxLines:1},
 {key:'sleep',   y:845,size:17,weight:500,maxLines:2},
 {key:'light',   y:897,size:19,weight:600,maxLines:1}
];
const bgCache={};

function loadBg(n){
 if(bgCache[n])return bgCache[n];
 bgCache[n]=new Promise(resolve=>{
  const img=new Image();
  img.onload=()=>resolve(img);
  img.onerror=()=>resolve(null);
  img.src=BG_URL[n];
 });
 return bgCache[n];
}
function loadImage(src){
 return new Promise(resolve=>{
  if(!src)return resolve(null);
  const img=new Image();
  img.onload=()=>resolve(img);
  img.onerror=()=>resolve(null);
  img.src=src;
 });
}
function columnCenters(n){
 const starts=COLS[n];
 return starts.map((x,i)=>{
  const end=i===n-1?END:starts[i+1];
  return x+(end-x)/2;
 });
}
function columnWidth(n,i){
 const starts=COLS[n];
 const end=i===n-1?END:starts[i+1];
 return end-starts[i];
}

/* ---------- 绘制 ---------- */
function fontPx(ctx,px,weight){ctx.font=(weight||700)+' '+px+'px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';}
function fitFont(ctx,text,maxW,px,weight){
 let p=px;fontPx(ctx,p,weight);
 while(ctx.measureText(text).width>maxW&&p>12){p-=1;fontPx(ctx,p,weight);}
 return p;
}
function center(ctx,text,cx,cy,color,shadow){
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;
 if(shadow){ctx.shadowColor=shadow[0];ctx.shadowBlur=shadow[1];}
 ctx.fillText(text,cx,cy);ctx.shadowBlur=0;
}
function bigNumber(ctx,text,cx,cy,px,hero){
 fontPx(ctx,px,800);ctx.textAlign='center';ctx.textBaseline='middle';
 const g=ctx.createLinearGradient(0,cy-px*0.55,0,cy+px*0.55);
 if(hero){g.addColorStop(0,'#fff6cf');g.addColorStop(1,'#ffab24');ctx.shadowColor='rgba(255,150,40,.9)';}
 else{g.addColorStop(0,'#ffffff');g.addColorStop(1,'#a8d4ff');ctx.shadowColor='rgba(90,170,255,.95)';}
 ctx.shadowBlur=26;ctx.fillStyle=g;ctx.fillText(text,cx,cy);
 ctx.shadowBlur=12;ctx.fillText(text,cx,cy);ctx.shadowBlur=0;
}
function drawContain(ctx,img,cx,top,maxW,maxH){
 const scale=Math.min(maxW/img.naturalWidth,maxH/img.naturalHeight);
 const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
 ctx.drawImage(img,cx-w/2,top+(maxH-h)/2,w,h);
}
function drawPlaceholder(ctx,cx){
 ctx.fillStyle='rgba(9,42,96,.55)';
 const w=150,h=96,x=cx-w/2,y=AC_Y+(AC_H-h)/2;
 ctx.beginPath();
 if(ctx.roundRect)ctx.roundRect(x,y,w,h,10);else ctx.rect(x,y,w,h);
 ctx.fill();
 center(ctx,'暂无主图',cx,AC_Y+AC_H/2,'#7fa8dd',null);
}
function num(v){const m=String(v==null?'':v).match(/-?\d+(\.\d+)?/);return m?m[0]:null;}
/* -7~43 → -7~43℃；本来就带单位的不动 */
function fmtTemp(v){
 const s=String(v==null?'':v).trim();
 if(!s||s==='—')return '—';
 return /℃/.test(s)||!/-?\d+\s*~\s*-?\d+$/.test(s)?s:s+'℃';
}
/* 按宽度折行（中文逐字），超出 maxLines 截断加… */
function wrapLines(ctx,text,maxW,px,weight,maxLines){
 fontPx(ctx,px,weight);
 if(ctx.measureText(text).width<=maxW)return [text];
 const lines=[];let cur='';
 for(const ch of String(text)){
  if(cur&&ctx.measureText(cur+ch).width>maxW){
   lines.push(cur);cur=ch;
   if(lines.length===maxLines){cur='x';break;}
  }else cur+=ch;
 }
 if(cur&&cur!=='x'&&lines.length<maxLines)lines.push(cur);
 if(lines.length===maxLines&&cur==='x'){
  let last=lines[maxLines-1];
  while(ctx.measureText(last+'…').width>maxW&&last.length>1)last=last.slice(0,-1);
  lines[maxLines-1]=last+'…';
 }
 return lines;
}

async function draw(){
 const n=state.models.length;
 if(n<2)return;
 const cv=get('pk'),ctx=cv.getContext('2d');
 if(state.template==='guide'){
  await drawGuide(ctx);
  return;
 }
 if(cv.width!==W){cv.width=W;cv.height=H;}
 ctx.clearRect(0,0,W,H);
 const bg=await loadBg(n);
 if(!bg){setStatus('底图加载失败，刷新页面试试','bad');return;}
 ctx.drawImage(bg,0,0,W,H);
 const centers=columnCenters(n);
 for(let i=0;i<n;i++){
  const m=state.models[i],cx=centers[i],hero=i===n-1;
  const colW=columnWidth(n,i);
  /* 产品图：有商品主图用原图（等比缩进槽位），没有画占位 */
  const img=await loadImage(m.mainImage);
  if(img)drawContain(ctx,img,cx,AC_Y,colW-40,AC_H);else drawPlaceholder(ctx,cx);
  /* 机型名（胶囊） */
  fitFont(ctx,m.series,colW-46,34,800);
  center(ctx,m.series,cx,Y_PILL,'#ffffff',['rgba(0,40,120,.55)',6]);
  /* 型号编码 */
  const code=m.model||'—';
  const p=fitFont(ctx,code,colW-28,23,500);fontPx(ctx,p,500);
  let shown=code;
  while(ctx.measureText(shown+'…').width>colW-28&&shown.length>6)shown=shown.slice(0,-1);
  if(shown!==code)shown+='…';
  center(ctx,shown,cx,Y_CODE,'#d6e6ff');
  /* 推荐理由（5~15 字，可两行） */
  const reason=String(state.reasons[m.id]!=null?state.reasons[m.id]:(m.fields.reason||'—'));
  const lines=reason.split(/\s+/).filter(Boolean).slice(0,2);
  if(lines.length){
   const lh=30*1.34,y0=Y_REASON-(lines.length-1)*lh/2;
   lines.forEach((line,li)=>center(ctx,line,cx,y0+li*lh,hero?'#ffe9b8':'#ffffff'));
  }
  /* APF 大数字 */
  const apf=num(m.fields.apf);
  if(apf)bigNumber(ctx,apf,cx,Y_APF,90,hero);
  else center(ctx,'—',cx,Y_APF,'#9cc3f0');
  /* 循环风量：数字 + m³/h 单位 */
  const air=num(m.fields.air);
  if(air){
   fontPx(ctx,66,800);const nw=ctx.measureText(air).width;
   fontPx(ctx,26,500);const uw=ctx.measureText('m³/h').width;
   const x0=cx-(nw+8+uw)/2;
   ctx.textAlign='left';ctx.textBaseline='middle';
   const g=ctx.createLinearGradient(0,Y_AIR-36,0,Y_AIR+36);
   if(hero){g.addColorStop(0,'#fff6cf');g.addColorStop(1,'#ffab24');ctx.shadowColor='rgba(255,150,40,.85)';}
   else{g.addColorStop(0,'#f7fbff');g.addColorStop(1,'#a8d4ff');ctx.shadowColor='rgba(90,170,255,.5)';}
   ctx.shadowBlur=18;ctx.fillStyle=g;fontPx(ctx,66,800);ctx.fillText(air,x0,Y_AIR);
   ctx.shadowBlur=0;fontPx(ctx,26,500);ctx.fillStyle='#f2f7ff';
   ctx.fillText('m³/h',x0+nw+8,Y_AIR+4);ctx.textAlign='center';
  }else center(ctx,'—',cx,Y_AIR,'#9cc3f0');
  /* 下区六行参数 */
  for(let r=0;r<T2_KEYS.length;r++){
   const v=String(m.fields[T2_KEYS[r]]||'—');
   fitFont(ctx,v,colW-30,29,600);
   center(ctx,v,cx,T2_Y[r],'#f6f9ff');
  }
 }
 state.drawn=true;
 get('download').disabled=false;
}

/* ---------- 模板二「选购指南」绘制 ---------- */
async function drawGuide(ctx){
 const cv=get('pk');
 if(cv.width!==G_W){cv.width=G_W;cv.height=G_H;}
 ctx.clearRect(0,0,G_W,G_H);
 const bg=await loadBg('guide');
 if(!bg){setStatus('底图加载失败，刷新页面试试','bad');return;}
 ctx.drawImage(bg,0,0,G_W,G_H);
 for(let i=0;i<4;i++){
  const m=state.models[i],cx=G_CENTERS[i],hero=i===3;
  const colW=G_COLX[i][1]-G_COLX[i][0];
  /* 产品图 */
  const img=await loadImage(m.mainImage);
  if(img)drawContain(ctx,img,cx,G_AC.y,G_AC.w,G_AC.h);
  else{
   ctx.fillStyle='rgba(6,26,64,.55)';
   const w=110,h=78,x=cx-w/2,y=G_AC.y+(G_AC.h-h)/2;
   ctx.beginPath();
   if(ctx.roundRect)ctx.roundRect(x,y,w,h,8);else ctx.rect(x,y,w,h);
   ctx.fill();
   center(ctx,'暂无主图',cx,G_AC.y+G_AC.h/2,'#6f95c9',null);
  }
  /* 机名（胶囊内） */
  fitFont(ctx,m.series,G_PILLW[i]-16,21,700);
  center(ctx,m.series,cx,G_PILL_Y,'#ffffff',['rgba(0,20,60,.5)',4]);
  const reason=String(state.reasons[m.id]!=null?state.reasons[m.id]:(m.fields.reason||'—'));
  for(const row of G_ROWS){
   const color=hero?'#ffd583':'#eef4ff';
   if(row.special==='model'){
    const p=fitFont(ctx,m.model||'—',colW-18,row.size,500);
    fontPx(ctx,p,500);
    center(ctx,m.model||'—',cx,row.y,'#c9d8ef',null);
    continue;
   }
   if(row.special==='apf'){
    const apf=num(m.fields.apf);
    if(apf)bigNumber(ctx,apf,cx,row.y,row.size,hero);
    else center(ctx,'—',cx,row.y,'#9db4d8',null);
    continue;
   }
   if(row.special==='air'){
    const airv=num(m.fields.air);
    if(airv){
     fontPx(ctx,row.size,row.weight);
     const nw=ctx.measureText(airv).width;
     fontPx(ctx,12,500);
     const uw=ctx.measureText('m³/h').width;
     const x0=cx-(nw+4+uw)/2;
     ctx.textAlign='left';ctx.textBaseline='middle';
     fontPx(ctx,row.size,row.weight);ctx.fillStyle=color;
     ctx.fillText(airv,x0,row.y);
     fontPx(ctx,12,500);ctx.fillStyle=color;
     ctx.fillText('m³/h',x0+nw+4,row.y+2);
     ctx.textAlign='center';
    }else center(ctx,'—',cx,row.y,'#9db4d8',null);
    continue;
   }
   let value;
   let lines;
   if(row.key==='reason'){
    /* 推荐理由按空格分行（最多两行），不做逐字折行，避免「省电之/选」这种断法 */
    lines=reason.split(/\s+/).filter(Boolean).slice(0,2);
    if(!lines.length)lines=['—'];
   }else{
    if(row.key==='temp')value=fmtTemp(m.fields.temp);
    else value=String(m.fields[row.key]||'—');
    lines=wrapLines(ctx,value,colW-22,row.size,row.weight,row.maxLines||1);
   }
   const lh=row.size*1.3;
   const y0=row.y-(lines.length-1)*lh/2;
   lines.forEach((line,li)=>center(ctx,line,cx,y0+li*lh,color));
  }
 }
 state.drawn=true;
 get('download').disabled=false;
}

/* ---------- 推荐理由编辑区 ---------- */
function renderReasonEdit(){
 const box=get('reasonEdit');
 if(!state.models.length){box.hidden=true;box.innerHTML='';return;}
 box.hidden=false;
 box.innerHTML='';
 for(const m of state.models){
  const row=document.createElement('div');row.className='pk-reason-row';
  const label=document.createElement('label');label.textContent=m.series;label.title=m.series;
  const input=document.createElement('input');input.type='text';input.maxLength=20;
  input.value=state.reasons[m.id]!=null?state.reasons[m.id]:(m.fields.reason||'');
  input.placeholder='推荐理由 5~15 字';
  const count=document.createElement('span');count.className='pk-count';
  const sync=()=>{
   const text=input.value.trim();
   state.reasons[m.id]=text;
   const n=text.replace(/\s/g,'').length;
   count.textContent=n+'字';
   count.className='pk-count'+(n>15?' is-bad':'');
   if(state.drawn)draw();
  };
  input.addEventListener('input',sync);
  sync();
  row.append(label,input,count);
  box.append(row);
 }
}

/* ---------- 已选列表 ---------- */
function orderedPicked(){
 const rest=state.picked.filter(id=>id!==state.heroId);
 const hero=state.picked.includes(state.heroId)?[state.heroId]:[];
 return rest.concat(hero);
}
function renderSelected(){
 const box=get('selectedList');box.innerHTML='';
 if(!state.picked.length){box.innerHTML='<p class="pk-note">还没选机型，从上面点选。</p>';}
 /* 显示顺序与海报列序一致：推荐位（橙色列）永远排最后 */
 for(const id of orderedPicked()){
  const p=state.pickedMap[id];
  if(!p)continue;
  const d=p.data||{};
  const chip=document.createElement('div');
  chip.className='pk-chip'+(id===state.heroId?' is-hero':'');
  const name=document.createElement('span');name.className='pk-chip-name';
  name.textContent=(d.series||d.name||'')+(id===state.heroId?'':'');
  name.title=d.model||'';
  const model=document.createElement('span');model.className='pk-chip-model';model.textContent=d.model||'';
  const heroBtn=document.createElement('button');heroBtn.type='button';heroBtn.className='pk-set-hero'+(id===state.heroId?' is-on':'');
  heroBtn.textContent=id===state.heroId?'推荐位':'设为推荐';
  heroBtn.onclick=()=>{state.heroId=id;if(state.models.length)draw();renderSelected();};
  const rm=document.createElement('button');rm.type='button';rm.className='pk-remove';rm.textContent='移除';
  rm.onclick=()=>{
   state.picked=state.picked.filter(x=>x!==id);
   delete state.pickedMap[id];
   if(state.heroId===id)state.heroId=state.picked[0]||null;
   state.models=[];state.drawn=false;get('download').disabled=true;
   get('reasonEdit').hidden=true;get('canvasHint').hidden=false;
   renderSelected();refreshPick();
   const t=pickedType();
   setStatus(t?('已移除。当前锁定'+t+'对比，可继续选或点「清空重选」。'):'');
  };
  if(id===state.heroId){const tag=document.createElement('span');tag.className='pk-hero-tag';tag.textContent='推荐';chip.append(tag);}
  /* 系列名一行为主、型号一行收尾，员工一眼确认选了哪台 */
  const info=document.createElement('div');info.className='pk-chip-info';
  info.append(name,model);
  chip.append(info,heroBtn,rm);
  box.append(chip);
 }
 get('generate').disabled=state.picked.length<(state.template==='guide'?4:2);
 get('reset').hidden=!state.picked.length;
 const n=state.picked.length;
 get('pickNote').textContent=n?('已选 '+n+' 台'+(n<2?'（至少 2 台）':'')+(n>=2?' · 生成 '+n+' 列对比图':'')):'';
}
function refreshPick(){
 for(const el of document.querySelectorAll('.pk-item'))el.classList.toggle('is-picked',state.picked.includes(el.dataset.id));
}

/* 机型结构判定（与后端 lib/product/pk-fields.js 同一套规则，勿单独改一边） */
function machineTypeOf(d){
 d=d||{};
 const text=String(d.name||'')+String(d.series||'');
 if(/挂机|壁挂/.test(text))return '挂机';
 if(/柜机|立柜/.test(text))return '柜机';
 const model=String(d.model||'').toUpperCase();
 if(/GW/.test(model)||/\dG/.test(model))return '挂机';
 if(/LW/.test(model)||/\dL/.test(model))return '柜机';
 return '';
}
const pickedType=()=>{const p=state.pickedMap[state.picked[0]];return p?machineTypeOf(p.data):'';};

/* ---------- 可选机型列表 ---------- */
function renderResults(){
 const box=get('resultList');box.innerHTML='';
 if(!state.products.length){box.innerHTML='<p class="pk-note">这个分组还没有机型，先去「产品知识库」导入。</p>';return;}
 for(const p of state.products){
  const d=p.data||{};
  const item=document.createElement('div');
  item.className='pk-item';item.dataset.id=p.id;
  const name=document.createElement('span');name.className='pk-item-name';
  name.textContent=d.series||d.name||'（未命名）';name.title=(d.series||'')+' '+(d.model||'');
  const model=document.createElement('span');model.className='pk-item-model';model.textContent=d.model||'';
  const badge=document.createElement('span');
  badge.className='pk-badge '+(d.distribution==='分销机型'?'dist':'norm');
  badge.textContent=d.distribution==='分销机型'?'分销':'非分销';
  /* 结构类型徽标：挂机/柜机一眼分清，混比在点选时就会被拦 */
  const type=machineTypeOf(d);
  const typeBadge=document.createElement('span');
  typeBadge.className='pk-badge type-'+(type==='挂机'?'ac':type==='柜机'?'cab':'unk');
  typeBadge.textContent=type||'未知';
  const info=document.createElement('div');info.className='pk-item-info';
  info.append(name,model);
  item.append(info,typeBadge,badge);
  item.onclick=()=>{
   if(state.picked.includes(p.id))return;
   if(state.picked.length>=4){setStatus('最多选 4 台，先移除一台再选。','bad');return;}
   if(!type){setStatus('「'+(d.series||d.model||'该机型')+'」识别不出挂机/柜机类型，暂不支持对比。','bad');return;}
   const locked=pickedType();
   if(locked&&locked!==type){setStatus('挂机和柜机不能混着对比：已选的是「'+locked+'」，请先清空重选或只选'+locked+'。','bad');return;}
   state.picked.push(p.id);
   state.pickedMap[p.id]={id:p.id,data:d};
   if(!state.heroId)state.heroId=p.id;
   renderSelected();refreshPick();
   setStatus('已锁定「'+type+'」对比，还可再选 '+(4-state.picked.length)+' 台（'+type+'）');
  };
  box.append(item);
 }
 refreshPick();
}

async function loadList(){
 const data=await api('list',{group:state.group,q:state.q});
 state.products=(data.products||[]).filter(p=>(p.data||{}).model);
 renderResults();
}

/* ---------- 生成 ---------- */
async function generate(){
 const ids=orderedPicked();
 const need=state.template==='guide'?4:2;
 if(ids.length<need){setStatus(state.template==='guide'?'「选购指南」模板固定 4 台对比，请选满 4 台。':'至少选 2 台才能生成。','bad');return;}
 /* 类型只认点选时的快照：搜索换列表后依然算得准，不会再误报「混比」 */
 const types=[...new Set(ids.map(id=>{const p=state.pickedMap[id];return p?machineTypeOf(p.data):'';}))].filter(t=>t!=='');
 if(types.length>1){setStatus('挂机与柜机不能混着对比，请只选同一类机型。','bad');return;}
 if(!types.length){setStatus('选中的机型识别不出挂机/柜机类型，暂不支持对比。','bad');return;}
 get('generate').disabled=true;
 setStatus('正在生成…');
 try{
  const data=await api('pk-fields',{ids:ids.join(',')});
  state.models=data.models||[];
  if(state.models.length<2)throw Error('可用机型不足 2 台（可能有型号刚被删除），刷新后重选。');
  get('canvasHint').hidden=true;
  renderReasonEdit();
  await draw();
  setStatus('已生成 '+state.models.length+' 台对比图，推荐理由可直接改。','ok');
 }catch(error){
  setStatus(explain(error),'bad');
 }finally{
  get('generate').disabled=state.picked.length<(state.template==='guide'?4:2);
 }
}

/* ---------- 启动 ---------- */
try{
 const identity=await session.getIdentity();
 WorkbenchShell.mountShell({
  container:get('shell'),
  activeModule:'pk',
  identity,
  onLogout:async()=>{await session.logout();location.replace('/login.html');}
 });
 const meta=await api('meta');
 /* 模板切换：模板一 2~4 台；模板二（选购指南）底图固定 4 列，必须选满 4 台 */
 for(const b of get('templates').querySelectorAll('button')){
  b.onclick=()=>{
   state.template=b.dataset.t;
   for(const t of get('templates').querySelectorAll('button'))t.classList.toggle('is-on',t===b);
   renderSelected();
   if(state.template==='guide'&&state.picked.length!==4)setStatus('「选购指南」模板固定 4 台对比，请选满 4 台再生成。');
   else if(state.models.length&&state.picked.length>=4)draw().catch(e=>setStatus(explain(e),'bad'));
  };
 }
 /* 一期只做空调：格力空调 + 海尔空调；冰箱（haier-fridge）二期再放 */
 state.groups=(meta.groups||[]).filter(g=>g.id==='gree-ac'||g.id==='haier-ac');
 const tabs=get('tabs');
 for(const g of state.groups){
  const b=document.createElement('button');b.type='button';b.textContent=g.label;
  b.className=g.id===state.group?'is-on':'';
  b.onclick=()=>{
   state.group=g.id;
   for(const t of tabs.querySelectorAll('button'))t.className=t.textContent===g.label?'is-on':'';
   loadList().catch(e=>setStatus(explain(e),'bad'));
  };
  tabs.append(b);
 }
 let searchTimer=null;
 get('search').addEventListener('input',event=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{
   state.q=event.target.value.trim();
   loadList().catch(e=>setStatus(explain(e),'bad'));
  },300);
 });
 get('generate').addEventListener('click',generate);
 get('download').addEventListener('click',()=>{
  if(!state.drawn)return;
  const a=document.createElement('a');
  a.download=state.template==='guide'
    ?'格力空调选购指南-4台.png'
    :'空调性能PK对比图-'+state.models.length+'台.png';
  a.href=get('pk').toDataURL('image/png');
  a.click();
 });
 get('reset').addEventListener('click',()=>{
  state.picked=[];state.pickedMap={};state.heroId=null;state.models=[];state.reasons={};state.drawn=false;
  get('download').disabled=true;get('reasonEdit').hidden=true;get('canvasHint').hidden=false;
  renderSelected();refreshPick();
 });
 renderSelected();
 await loadList();
}catch(error){
 setStatus(explain(error),'bad');
}
})();
