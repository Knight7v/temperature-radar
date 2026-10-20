(async()=>{const q=id=>document.getElementById(id),s=WorkbenchSession.createSessionClient();let identity;try{identity=await s.getIdentity();}catch{location.replace('/login.html?returnTo=%2Fsales.html');return;}WorkbenchShell.mountShell({container:q('shell'),activeModule:'sales',identity,onLogout:async()=>{await s.logout();location.replace('/login.html');}});const writable=['admin','operator'].includes(identity.user.role);let shops=[],previews=[],yearlyDisplay='annual',lastOverview=null;const fields={name:'店铺名称',shopId:'店铺ID',brand:'品牌',platform:'平台',type:'店铺类型',status:'店铺状态',openDate:'开店日期',closeDate:'闭店日期',entity:'主体',owner:'负责人',executor:'执行人'},msg=v=>q('salesMessage').textContent=v,money=v=>(Number(v)/1e6).toFixed(2);async function api(action,body,query=''){const r=await s.authorizedFetch('/api/sales?action='+action+query,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(typeof d.error==='string'?d.error:'请求失败');return d.data;}const safe=fn=>async(...args)=>{try{await fn(...args);}catch(e){msg(e.message);}};
function table(id,headers,rows){const t=document.createElement('table'),tr=document.createElement('tr');headers.forEach(h=>{const th=document.createElement('th');th.textContent=h;tr.append(th);});t.append(tr);rows.forEach(row=>{const r=document.createElement('tr');row.forEach(v=>{const td=document.createElement('td');if(v instanceof Node)td.append(v);else td.textContent=v;r.append(td);});t.append(r);});q(id).replaceChildren(t);}
const shopOptions={brand:['格力','海尔'],platform:['京东','天猫','拼多多'],type:['POP','自营'],status:['运营中','闭店中','已闭店'],entity:['万有引力','长缨星河','京品优选']},dateFields=new Set(['openDate','closeDate']),Life=globalThis.SalesLifecycle;
const statusText=v=>{const st=Life.effectiveStatus(v),raw=String(v.data.status||'');return st?(raw&&raw!==st?st+'（按日期）':st):'未填写';};
for(const [key,label] of Object.entries(fields)){const l=document.createElement('label');l.textContent=label;const input=document.createElement(shopOptions[key]?'select':'input');input.name=key;if(shopOptions[key]){input.append(new Option('请选择'+label,''));shopOptions[key].forEach(v=>input.append(new Option(v,v)));}else if(dateFields.has(key))input.type='date';else input.maxLength=100;input.required=key==='name';l.append(input);q('shopForm').append(l);}const save=document.createElement('button');save.textContent='保存店铺';q('shopForm').append(save);let editId=null;
async function loadShops(){shops=await api('shops');for(const [id,label] of Object.entries({brand:'品牌',platform:'平台',owner:'负责人',executor:'执行人'})){const old=q(id).value;const values=[...new Set(shops.map(v=>v.data[id]).filter(Boolean))].sort();q(id).replaceChildren(new Option('全部'+label,''));values.forEach(v=>q(id).append(new Option(v,v)));if(values.includes(old))q(id).value=old;}for(const id of ['shopFilter','importShop','targetShop']){const old=q(id).value;q(id).replaceChildren();if(id==='shopFilter')q(id).append(new Option('全部店铺',''));if(id==='importShop')q(id).append(new Option('请选择店铺或上传文件自动识别',''));shops.forEach(v=>q(id).append(new Option(v.data.name,v.id)));if(shops.some(v=>v.id===old))q(id).value=old;}table('shopList',[...Object.values(fields),'操作'],shops.map(v=>{const b=document.createElement('button');b.textContent='编辑';b.disabled=!writable;b.onclick=()=>{editId=v.id;Object.keys(fields).forEach(k=>{const input=q('shopForm').elements[k],value=v.data[k]||'';if(shopOptions[k]){Array.from(input.options).filter(o=>o.dataset.legacy).forEach(o=>o.remove());if(value&&!shopOptions[k].includes(value)){const option=new Option(value+'（原有值）',value);option.dataset.legacy='true';input.append(option);}}input.value=value;});};return [...Object.keys(fields).map(k=>k==='status'?statusText(v):(v.data[k]||'未填写')),b];}));}
const loadShopRows=loadShops;
function shopInput(key,value=''){
 const input=document.createElement(shopOptions[key]?'select':'input');
 input.name=key;input.placeholder=fields[key];
 if(shopOptions[key]){
  input.append(new Option('请选择'+fields[key],''));
  shopOptions[key].forEach(option=>input.append(new Option(option,option)));
  if(value&&!shopOptions[key].includes(value))input.append(new Option(value+'（原有值）',value));
 }else if(dateFields.has(key))input.type='date';
 input.value=value||'';return input;
}
function renderShopEditRow(row,shop=null){
 row.replaceChildren();row.className=shop?'shop-edit-row':'shop-new-row';
 Object.keys(fields).forEach(key=>{const cell=document.createElement('td');cell.append(shopInput(key,shop?.data[key]||''));row.append(cell);});
 const actions=document.createElement('td');
 const save=document.createElement('button');save.type='button';save.className='shop-action';save.textContent='保存';
 save.onclick=safe(async()=>{const data=Object.fromEntries(Array.from(row.querySelectorAll('input,select')).map(input=>[input.name,input.value]));await api('shop',{...data,...(shop?{id:shop.id}:{})});await loadShops();msg(shop?'店铺已更新':'店铺已新增');});
 const cancel=document.createElement('button');cancel.type='button';cancel.className='shop-action';cancel.textContent='取消';
 cancel.onclick=()=>shop?loadShops():row.remove();actions.append(save,cancel);row.append(actions);
}
function addShopRow(){const table=q('shopList').querySelector('table');if(!table)return;const existing=table.querySelector('.shop-new-row');if(existing){existing.querySelector('input,select')?.focus();return;}const row=document.createElement('tr');renderShopEditRow(row);table.rows[0]?.after(row);row.querySelector('input,select')?.focus();}
async function loadShopsWithActions(){await loadShopRows();const table=q('shopList').querySelector('table');if(!table)return;Array.from(table.rows).slice(1).forEach((row,index)=>{if(row.classList.contains('shop-new-row'))return;const shop=shops[index],actions=row.lastElementChild;if(!shop||!actions)return;actions.replaceChildren();const edit=document.createElement('button');edit.type='button';edit.textContent='编辑';edit.className='shop-action';edit.disabled=!writable;edit.onclick=()=>renderShopEditRow(row,shop);const del=document.createElement('button');del.type='button';del.textContent='删除';del.className='shop-action';del.disabled=!writable;del.onclick=safe(async()=>{if(!confirm('确定删除该店铺吗？'))return;await api('shop-delete',{id:shop.id});await loadShops();msg('店铺已删除');});actions.append(edit,del);});}
loadShops=loadShopsWithActions;
const newShopButton=document.createElement('button');newShopButton.type='button';newShopButton.textContent='新增店铺';newShopButton.onclick=addShopRow;newShopButton.disabled=!writable;
q('shopForm').hidden=true;q('shopForm').before(newShopButton);
const autoDatesButton=document.createElement('button');autoDatesButton.type='button';autoDatesButton.textContent='按首个有数据日期填开店日期';autoDatesButton.className='shop-auto-dates';autoDatesButton.disabled=!writable;
autoDatesButton.onclick=safe(async()=>{if(!confirm('将为「开店日期」为空的店铺，按各自首个有销售数据的日期自动填写；已有开店日期的店铺不会被改动。继续吗？'))return;const d=await api('shop-auto-dates',{});await loadShops();const filled=d.filled||[],skipped=d.skipped||[];const reasons=[...new Set(skipped.map(x=>x.reason))];msg(filled.length?`已自动填写 ${filled.length} 家开店日期：`+filled.map(x=>x.name+' '+x.openDate).join('；')+(skipped.length?`；跳过 ${skipped.length} 家（${reasons.join('、')}）`:''):`没有可自动填写的店铺${reasons.length?'（'+reasons.join('、')+'）':''}`);});
q('shopForm').before(autoDatesButton);
q('shopForm').onsubmit=e=>e.preventDefault();
const dates=SalesDates.mount({onChange:safe(load)});
function params(){const p=new URLSearchParams();for(const k of ['start','end','grain','brand','platform','owner','executor'])if(q(k).value)p.set(k,q(k).value);if(q('shopFilter').value)p.set('shop',q('shopFilter').value);p.set('status',q('shopStatus').value);p.set('includeEmpty','1');return '&'+p;}
const countFmt=v=>v==null?'未导入':Number(v).toLocaleString('zh-CN'),percentFmt=v=>v==null?'未导入':(Number(v)*100).toFixed(2)+'%',yuanFmt=v=>v==null?'未导入':(Number(v)/100).toFixed(2);
function trendChart(points){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('sales-trend');svg.setAttribute('viewBox','0 0 128 32');svg.setAttribute('role','img');
 const observed=points.filter(point=>point.cents!=null),start=points[0]?.date,end=points.at(-1)?.date;
 svg.setAttribute('aria-label',`销售趋势 ${start} 至 ${end}，${observed.length} 天有数据`);
 const max=Math.max(1,...observed.map(point=>point.cents)),segments=[];let segment=[];
 for(let i=0;i<points.length;i++){
  const point=points[i];if(point.cents==null){if(segment.length)segments.push(segment);segment=[];continue;}
  segment.push([4+(points.length<2?0:i*120/(points.length-1)),26-point.cents/max*20]);
 }
 if(segment.length)segments.push(segment);
 for(const line of segments){
  if(line.length===1){const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',line[0][0]);dot.setAttribute('cy',line[0][1]);dot.setAttribute('r','2.2');svg.append(dot);continue;}
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',line.map((point,index)=>(index?'L':'M')+point[0].toFixed(2)+' '+point[1].toFixed(2)).join(' '));svg.append(path);
 }
 return svg;
}
function renderReport(d){
 const isYear=q('grain').value==='year';q('yearViewToggle').hidden=!isYear;
 q('yearViewToggle').querySelectorAll('[data-year-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.yearView===yearlyDisplay)));
 if(isYear&&yearlyDisplay==='monthly'){
  const rows=(d.yearlyBreakdown||[]).map(shop=>[shop.shop,shop.yearCents==null?(shop.state||'未导入'):money(shop.yearCents),...shop.months.map(month=>month.cents==null?(month.state||'未导入'):money(month.cents))]);
  const monthlyTable=document.createElement('table'),thead=document.createElement('thead'),tbody=document.createElement('tbody'),headRow=document.createElement('tr');
  const corner=document.createElement('th');corner.textContent='店铺';corner.rowSpan=2;corner.scope='col';headRow.append(corner);
  const groupHead=document.createElement('th');groupHead.textContent='销售额（万元）';groupHead.colSpan=13;groupHead.scope='colgroup';groupHead.className='yearly-group';headRow.append(groupHead);
  thead.append(headRow);
  const subRow=document.createElement('tr');
  ;['年累计',...Array.from({length:12},(_,i)=>(i+1)+'月')].forEach(label=>{const th=document.createElement('th');th.scope='col';th.textContent=label;subRow.append(th);});
  thead.append(subRow);monthlyTable.append(thead);
  rows.forEach(row=>{const tr=document.createElement('tr');row.forEach((value,index)=>{const td=document.createElement('td');if(index===1)td.className='yearly-total';td.textContent=value;tr.append(td);});tbody.append(tr);});
  monthlyTable.append(tbody);
  monthlyTable.classList.add('yearly-month-table');
  q('report').replaceChildren(monthlyTable);
 }else{
  const singleDay=q('start').value===q('end').value,shownTrends=new Set();
  table('report',['店铺','周期','销售额（万元）','目标（万元）','达成率','销售趋势','店铺访客数','店铺浏览量','店铺成交转化率','客单价（元）','已导入天数'],d.rows.map(r=>{let trend='—';if(!singleDay){trend='';if(r.trend&&!shownTrends.has(r.shopId)){trend=trendChart(r.trend);shownTrends.add(r.shopId);}}return [r.shop,r.period+(r.partial?'（'+(q('grain').value==='week'?'周累计':q('grain').value==='month'?'月累计':'累计')+'，截至 '+r.lastDate+'）':''),r.cents==null?(r.state||'未导入'):money(r.cents),r.state?'—':r.target==null?'待设置':money(r.target),r.incremental?'增量业务（不考核）':r.cents==null?'—':r.rate==null?'待设置':(r.rate*100).toFixed(2)+'%',trend,r.state?'—':countFmt(r.visitors),r.state?'—':countFmt(r.views),r.state?'—':percentFmt(r.conversionRate),r.state?'—':yuanFmt(r.avgOrderCents),r.state?'—':r.days];}));
 }
 const shownRows=isYear&&yearlyDisplay==='monthly'?d.yearlyBreakdown:d.rows;if(!shownRows?.length)q('report').innerHTML='<p class="empty-state">当前筛选条件下没有店铺，请调整筛选条件。</p>';
}
async function ensureYearlyBreakdown(data){
 if(q('grain').value!=='year'||yearlyDisplay!=='monthly'||!data||Array.isArray(data.yearlyBreakdown)&&(data.yearlyBreakdown.length||!data.rows.length))return;
 const query=new URLSearchParams(params().slice(1));query.set('grain','month');
 const monthlyData=await api('overview',undefined,'&'+query.toString()),byShop=new Map();
 for(const row of monthlyData.rows||[]){const month=Number(row.period.slice(5,7));if(month<1||month>12)continue;if(!byShop.has(row.shopId))byShop.set(row.shopId,new Map());byShop.get(row.shopId).set(month,{cents:row.cents,days:row.days||0});}
 // 兜底路径专用：后端正常返回 yearlyBreakdown 时不会走到这里，零填充按「该店最早~最晚有数据月份」粗略判断。
 const spans=new Map();
 for(const row of monthlyData.rows||[]){if(row.cents==null)continue;const ym=String(row.period).slice(0,7),cur=spans.get(row.shopId)||{from:ym,to:ym};if(ym<cur.from)cur.from=ym;if(ym>cur.to)cur.to=ym;spans.set(row.shopId,cur);}
 const year=String(q('start').value).slice(0,4);
 data.yearlyBreakdown=data.rows.map(shop=>{const profile=shops.find(s=>s.id===shop.shopId);const months=Array.from({length:12},(_,index)=>{const month=index+1,value=byShop.get(shop.shopId)?.get(month),mm=String(month).padStart(2,'0'),start=year+'-'+mm+'-01',end=new Date(Date.UTC(Number(year),month,0)).toISOString().slice(0,10),state=profile?Life.rangeState(profile,start,end):'',span=spans.get(shop.shopId),zero=!value&&!state&&span&&year+'-'+mm>=span.from&&year+'-'+mm<=span.to;return {month,cents:value?value.cents:zero?0:null,days:value?.days||0,state,zero:Boolean(zero)};});return {shopId:shop.shopId,shop:shop.shop,year,state:profile?Life.rangeState(profile,year+'-01-01',year+'-12-31'):'',yearCents:shop.cents,yearDays:shop.days,months};});
}
async function load(){q('summary').textContent='正在查询销售数据…';q('report').replaceChildren();const d=await api('overview',undefined,params());lastOverview=d;await ensureYearlyBreakdown(d);q('summary').textContent=`已导入销售额 ${money(d.total)} 万元｜${d.shopCount} 家店｜已覆盖 ${d.covered} 个店铺日${d.zeroDays?`｜零销售 ${d.zeroDays} 个店铺日`:''}｜缺失 ${d.missing} 个店铺日${d.outside?`｜经营期外数据 ${d.outside} 个店铺日（不计入覆盖）`:''}｜最近导入 ${d.lastImport?new Date(d.lastImport).toLocaleString('zh-CN'):'暂无导入记录'}`;renderReport(d);}
q('yearViewToggle').addEventListener('click',safe(async event=>{
 const button=event.target.closest('[data-year-view]');if(!button)return;
 yearlyDisplay=button.dataset.yearView;
 if(lastOverview){try{await ensureYearlyBreakdown(lastOverview);}catch(error){yearlyDisplay='annual';renderReport(lastOverview);throw error;}renderReport(lastOverview);}
}));
q('query').onclick=safe(load);q('resetFilters').onclick=()=>{for(const id of ['shopFilter','brand','platform','owner','executor'])q(id).value='';q('shopStatus').value='current';dates.reset();};q('export').onclick=safe(async()=>{const r=await s.authorizedFetch('/api/sales?action=export'+params());if(!r.ok)throw Error('导出失败');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='销售统计.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function clear(){previews=[];q('confirm').hidden=true;q('diff').replaceChildren();}q('file').onchange=()=>{clear();q('importShop').value='';const files=[...q('file').files];if(files.length>10){q('file').value='';return msg('一次最多选择10个文件');}if(!files.length)return;const matches=[];for(const file of files){try{const shop=SalesPolicy.resolveShop(shops,file.name,'');matches.push(shop.data.name);}catch(e){matches.push('按文件内店铺名称自动识别');}}q('importMatch').textContent=files.length===1?'已识别店铺：'+matches[0]:`已选择 ${files.length} 个文件：`+matches.join('、');};q('importShop').onchange=()=>{clear();q('importMatch').textContent='已变更选择，预览时将重新核对文件店铺ID';};q('preview').onclick=safe(async()=>{clear();const files=[...q('file').files];if(!files.length)throw Error('请先选择文件');if(files.length>10)throw Error('一次最多选择10个文件');q('preview').disabled=true;try{const all=[];const notes=[];for(const file of files){let matched=null;try{matched=SalesPolicy.resolveShop(shops,file.name,q('importShop').value);}catch(e){matched=null;}const r=await s.authorizedFetch('/api/sales?action=preview'+(matched?'&shop='+matched.id:''),{method:'POST',headers:{'Content-Type':'application/octet-stream','x-sales-filename':encodeURIComponent(file.name)},body:await file.arrayBuffer()});const d=await r.json();if(!r.ok)throw Error(`${file.name}：${d.error||'校验失败'}`);previews.push(d.data.id);all.push(...d.data.diff.map(v=>[d.data.shopName,v.date,v.old==null?'无数据':money(v.old.cents),money(v.cents),v.status]));if(d.data.template==='order-detail'&&d.data.stats){const st=d.data.stats;const drop=Object.entries(st.byStatus||{}).filter(([k])=>k!=='已签收').map(([k,v])=>k+' '+v+' 行').join('、');notes.push(`${d.data.shopName}：保留已签收 ${st.orders} 单，剔除未签收 ${st.rowsSkipped||0} 行${drop?'（'+drop+'）':''}、外机 ${st.rowsOuter} 行`);}const ow=d.data.stats&&d.data.stats.outsideWindow;if(ow&&(ow.before||ow.after)){const parts=[];if(ow.before)parts.push(ow.before+' 天早于开店日期');if(ow.after)parts.push(ow.after+' 天晚于闭店日期');notes.push(`${d.data.shopName}：`+parts.join('、')+'（按原样导入）');}}table('diff',['店铺','日期','原金额（万元）','新金额（万元）','操作'],all);q('confirm').hidden=false;msg(`已校验 ${files.length} 个文件，共 ${all.length} 天${notes.length?'（'+notes.join('；')+'）':''}，请核对差异后确认。`);}finally{q('preview').disabled=false;}});
q('confirm').onclick=safe(async()=>{q('confirm').disabled=true;try{const d=await api('confirm-batch',{ids:previews});clear();if(d){q('start').value=d.start;q('end').value=d.end;q('shopFilter').value=d.shop;const importedShop=shops.find(v=>v.id===d.shop);if(importedShop&&Life.effectiveStatus(importedShop)==='已闭店')q('shopStatus').value='all';dates.sync();await load();}msg(`导入完成：新增 ${d.added} 天，覆盖 ${d.changed} 天，其余跳过。`);}finally{q('confirm').disabled=false;}});
async function targets(){const d=await api('targets');table('targetList',['店铺','周期','目标（万元）'],d.map(r=>[shops.find(s=>s.id===r.shop_id)?.data.name||r.shop_id,r.period,Number(r.cents)===0?'0.00（增量业务，不考核）':money(r.cents)]));}q('targetForm').onsubmit=safe(async e=>{e.preventDefault();const f=new FormData(e.target),amount=Number(f.get('amount'));await api('target',{shop:q('targetShop').value,period:f.get('period'),yuan:(amount*10000).toFixed(2)});await targets();msg(amount===0?'目标已保存：该店铺按增量业务处理，不纳入销售考核':'目标已保存');});
q('file').multiple=true;q('file').setAttribute('aria-label','选择最多10个XLSX文件');const importActions=document.createElement('div');importActions.className='import-actions';q('file').before(importActions);importActions.append(q('file'),q('preview'),q('confirm'));
const salesSections=['overview','shops','import','targets','logs'];
async function showSalesSection(){
 const requested=location.hash.slice(1),active=salesSections.includes(requested)?requested:'overview';
 salesSections.forEach(id=>q(id).hidden=id!==active);
 document.querySelectorAll('[data-module^="sales-"]').forEach(link=>{if(link.dataset.module==='sales-'+active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
 msg('');
 if(active==='targets')await targets();
 if(active==='logs'){const rows=await api('logs');table('logList',['导入时间','店铺','日期范围','新增','覆盖'],rows.map(r=>[new Date(r.created_at).toLocaleString(),shops.find(s=>s.id===r.data.shop)?.data.name||'',r.data.start+' 至 '+r.data.end,r.data.added,r.data.changed]));}
}
window.addEventListener('hashchange',safe(showSalesSection));
if(!writable){[q('shopForm'),q('targetForm')].forEach(f=>Array.from(f.elements).forEach(e=>e.disabled=true));q('preview').disabled=true;}await safe(async()=>{await loadShops();await showSalesSection();await load();})();})();
