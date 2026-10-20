(async function(){const session=WorkbenchSession.createSessionClient(),q=id=>document.getElementById(id),status=q('status'),cards=q('cards'),table=q('table'),body=table.querySelector('tbody');const ALERT_ZH={LOW_STOCK:'缺货风险',NO_SALES_30:'近30天无销售',OVERSTOCK:'库存积压',PAIR_MISMATCH:'内外机缺配'},ISSUE_ZH={PAIRING_PENDING:'待配对',RULES_PENDING:'规则待配置',NO_SALES_DATA:'暂无销售数据',NO_SALES_PERIOD:'无销售记录',ZERO_AVAILABLE:'可用库存为0',MISSING_COMPONENT:'缺组件',PAIR_MISMATCH:'内外机缺配',OUTFLOW_MISMATCH:'出库不一致'};let identity;try{identity=await session.getIdentity();WorkbenchShell.mountShell({container:q('inventoryShell'),activeModule:'inventory',identity,onLogout:async()=>{await session.logout();location.replace('/login.html')}});}catch(e){if(e.code==='SESSION_EXPIRED')return location.replace('/login.html?returnTo='+encodeURIComponent(location.pathname));status.textContent=e.message;return;}
 const yesterday=()=>{const d=new Date();d.setDate(d.getDate()-1);return d.toISOString().slice(0,10)};const params=()=>{const p=new URLSearchParams();for(const k of ['date','view','alert','brand','category'])if(q(k).value)p.set(k,q(k).value);return p};async function load(){q('exportFollowups').disabled=true;status.textContent='正在加载…';table.hidden=cards.hidden=true;try{const r=await session.authorizedFetch('/api/inventory/overview?'+params());const d=await r.json();if(!r.ok)throw Error(d.error?.message||'加载失败');if(d.data&&d.data.date)q('date').value=d.data.date;const facets=d.data.facets||{brands:[],categories:[]};for(const [id,list] of [['brand',facets.brands],['category',facets.categories]]){const el=q(id);if(!el)continue;const cur=el.value;el.innerHTML='<option value="">全部</option>'+(list||[]).map(v=>'<option value="'+v+'">'+v+'</option>').join('');if(cur&&(list||[]).includes(cur))el.value=cur;}const s=d.data.summary||{availableByUnit:{},alerts:{},issues:{}};cards.innerHTML='';[['商品数',d.data.rows.length],['可用库存',Object.values(s.availableByUnit).reduce((a,b)=>a+b,0)],['业务预警',Object.values(s.alerts).reduce((a,b)=>a+b,0)],['待配置／异常',Object.values(s.issues).reduce((a,b)=>a+b,0)]].forEach(([k,v])=>{const x=document.createElement('div');x.className='inventory-kpi';x.textContent=k;const n=document.createElement('strong');n.textContent=v; x.append(n);cards.append(x)});const followups=await InventoryFollowups.load(session,d.data.date||q('date').value,['admin','operator','supply_chain'].includes(identity.user.role),d.data.rows);q('exportFollowups').onclick=()=>followups.download();q('exportFollowups').disabled=false;body.innerHTML='';const num=v=>v==null?'—':v;const day=v=>v==null?'—':v.toFixed(1);for(const r of d.data.rows){const tr=document.createElement('tr');[r.warehouse,r.name||r.entityId,r.unit,r.available??'数据缺失',r.daysCover==null?'暂无销售出库':r.daysCover.toFixed(1),num(r.stock),num(r.good),num(r.bad),num(r.sales?.[1]),num(r.sales?.[7]),num(r.sales?.[15]),num(r.sales?.[30]),num(r.turnover?.mtd),num(r.turnover?.days30)].forEach((v,idx)=>{const td=document.createElement('td');td.textContent=v;if(idx===1&&r.name)td.title=r.name;tr.append(td)});const a=document.createElement('td');for(const x of r.businessAlerts||[]){const p=document.createElement('span');p.className='inventory-pill';p.textContent=ALERT_ZH[x]||x;a.append(p)}if(!(r.businessAlerts||[]).length){const p=document.createElement('span');p.className='inventory-pill inventory-ok';p.textContent='无业务预警';a.append(p)}tr.append(a);const i=document.createElement('td');i.textContent=(r.issues||[]).map(x=>ISSUE_ZH[x]||x).join('、')||'数据完整';tr.append(i,followups.cell(r));body.append(tr)}cards.hidden=table.hidden=false;status.textContent=`数据日期：${d.data.date||'暂无快照'}`;q('export').href='/api/inventory/export?'+params();}catch(e){status.textContent=e.message||'加载失败';status.className='workbench-error';}}q('refresh').onclick=load;const importButton=q('importButton'),importFile=q('importFile'),confirmImport=q('confirmImport');const templateButton=document.createElement('button');templateButton.type='button';templateButton.textContent='下载导入模板';templateButton.title='下载包含必需表头的CSV模板';importButton.after(templateButton);templateButton.onclick=()=>{const blob=new Blob(['日期,仓库名称,京东SKU,商家商品编码,商家商品标识,商品名称,省市,在库件数,在库件数-良品,在库件数-残品,可用在库件数,销售出库件数,近7天销售出库件数,近15天销售出库件数,近30天销售出库件数,商品MTD周转,30天周转\n2026-10-07,示例仓,SKU001,,,,示例商品,,100,100,0,100,5,5,10,20,,\n'],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='库存导入模板.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};let pendingPreviewId=null,pendingPreviewRevision=0;
const canImportRole=['admin','operator','supply_chain'].includes(identity.user.role);
if(!canImportRole){importButton.hidden=true;templateButton.hidden=true;}
importButton.onclick=()=>{if(canImportRole)importFile.click()};

async function previewFile(file){
const r=await session.authorizedFetch('/api/inventory/import-preview',{method:'POST',headers:{'content-type':'application/octet-stream','x-inventory-filename':encodeURIComponent(file.name)},body:await file.arrayBuffer()});
const d=await r.json();
if(!r.ok)throw Error((typeof d.error==='string'?d.error:d.error?.message)||'导入校验失败');
return d.data;
}
async function confirmPreview(p){
const r=await session.authorizedFetch('/api/inventory/import-confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({previewId:p.previewId,expectedSnapshotRevision:p.snapshotRevision||0,confirmFullCoverage:true,confirmMissing:true})});
const d=await r.json();
if(!r.ok)throw Error((typeof d.error==='string'?d.error:d.error?.message)||'入库失败');
return d.data;
}

importFile.onchange=async()=>{
const files=[...importFile.files];
importFile.value='';
if(!files.length)return;
status.className='';
if(files.length===1){
 status.textContent='正在校验库存表…';
 try{
  const p=await previewFile(files[0]);
  pendingPreviewId=p.previewId;pendingPreviewRevision=p.snapshotRevision||0;
  confirmImport.hidden=false;
  const warn=[];
  if((p.missingWarehouses||[]).length)warn.push('缺少仓库 '+p.missingWarehouses.length+' 个');
  if((p.diff&&p.diff.missing||[]).length)warn.push('比上次少 '+p.diff.missing.length+' 行');
  status.textContent=`已读取 ${p.counts?.rows||0} 行（${p.date||'日期待识别'}）${warn.length?'，注意：'+warn.join('、'):''}。请点击“确认入库”写入库存。`;
 }catch(e){status.textContent=e.message||'导入失败';status.className='workbench-error';}
 return;
}
const ok=[],same=[],manual=[],bad=[];
for(let i=0;i<files.length;i++){
 const f=files[i];
 status.textContent=`正在导入 ${i+1}/${files.length}：${f.name}`;
 try{
  const p=await previewFile(f);
  const label=p.date||f.name;
  if(p.noChange){same.push(label);continue;}
  if((p.missingWarehouses||[]).length||(p.diff&&p.diff.missing||[]).length){manual.push(label);continue;}
  await confirmPreview(p);
  ok.push(label);
 }catch(e){bad.push(`${f.name}（${e.message}）`);}
}
ok.sort();
same.sort();
const parts=[];
if(ok.length)parts.push(`成功入库 ${ok.length} 天${ok.length>1?`（${ok[0]} ~ ${ok[ok.length-1]}）`:`（${ok[0]}）`}`);
if(same.length)parts.push(`内容无变化 ${same.length} 天`);
if(manual.length)parts.push(`需人工确认 ${manual.length} 天：${manual.join('、')}`);
if(bad.length)parts.push(`失败 ${bad.length} 个：${bad.join('；')}`);
status.textContent='批量导入完成：'+parts.join('｜');
status.className=(bad.length||manual.length)?'workbench-error':'';
if(ok.length)await load();
};

confirmImport.onclick=async()=>{if(!pendingPreviewId)return;
confirmImport.disabled=true;
try{
 await confirmPreview({previewId:pendingPreviewId,snapshotRevision:pendingPreviewRevision});
 status.textContent='库存已确认入库，正在刷新数据…';
 confirmImport.hidden=true;
 pendingPreviewId=null;
 await load();
}catch(e){status.textContent=e.message||'入库失败';
status.className='workbench-error';
}finally{confirmImport.disabled=false;
}};
['date','view','alert','brand','category'].forEach(id=>q(id).onchange=load);load();})();
