(async()=>{
 'use strict';
 const labels={'gree-ac':'格力空调','haier-ac':'海尔空调','haier-fridge':'海尔冰箱'},category=new URLSearchParams(location.search).get('category');
 const current=labels[category]?category:'gree-ac',get=id=>document.getElementById(id),session=WorkbenchSession.createSessionClient();
 const state={mode:'annual',index:1,report:null,previewId:null,previewKind:'manual',role:'viewer',shops:[]};
 const tiers=[['引流机','#3c6df5'],['普通机','#7795ed'],['中端机','#6bb9d1'],['高端机','#58b6a0'],['未分类','#d6deea']];
 const elem=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
 const fmt=value=>value==null?'—':Number(value).toLocaleString('zh-CN'),pct=value=>value==null?'—':(value*100).toFixed(1).replace(/\.0$/,'')+'%';
 const status=(message,type='loading')=>{get('periodStatus').textContent=message;get('periodStatus').dataset.state=type;};
 async function api(action,options={}){
  const params=new URLSearchParams({action,category:current,...options.params});
  const response=await session.authorizedFetch('/api/sales-structure?'+params,{method:options.method||'GET',headers:options.raw?{'x-sales-structure-filename':encodeURIComponent(options.filename)}:options.body?{'Content-Type':'application/json'}:undefined,body:options.raw||options.body&&JSON.stringify(options.body)});
  if(options.download){if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||'下载失败');}return response.blob();}
  const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'请求失败');return result.data;
 }
 function active(){const report=state.report;if(!report)return null;return state.mode==='annual'?report.annual:state.mode==='quarter'?report.quarters[state.index-1]:report.months[state.index-1];}
 function renderChoices(){const box=get('periodChoices');box.replaceChildren();box.hidden=state.mode==='annual'||!state.report;if(box.hidden)return;
  const list=state.mode==='quarter'?state.report.quarters:state.report.months;
  for(const [i,period] of list.entries()){const button=elem('button',period.label);button.type='button';button.disabled=period.state==='future';button.setAttribute('aria-pressed',String(state.index===i+1));button.onclick=()=>{state.index=i+1;render();};box.append(button);}
 }
 function renderMetrics(item){const ready=item?.state==='ready',units=ready?item.units:null,gree=current==='gree-ac';
  get('metricUnits').textContent=units==null?'—':fmt(units)+' 台';
  get('metricCoverage').textContent=gree&&ready?pct(item.classificationShare):gree?'—':'待定义';
  get('metricCabinetUnits').textContent=gree&&ready?fmt(item.cabinetUnits)+' 台':'—';
  get('metricCabinetShare').textContent=gree&&ready?pct(item.cabinetShare):'—';
  get('metricCabinetUnits').closest('article').hidden=!gree;get('metricCabinetShare').closest('article').hidden=!gree;
  document.querySelector('.ss-metrics').classList.toggle('is-limited',!gree);
  if(!gree){get('coverageLabel').textContent='分类规则';get('coverageHint').textContent='待明确该品类的业务分类';}
 }
 function renderMix(item){const bar=get('mixBar'),legend=get('mixLegend');bar.replaceChildren();legend.replaceChildren();const total=item?.state==='ready'?item.units:0;
  for(const [tier,color] of tiers){const count=tier==='未分类'?item?.unknownUnits:item?.tiers?.[tier];const share=total>0?count/total:0;
   if(share>0){const segment=elem('span');segment.style.width=share*100+'%';segment.style.background=color;bar.append(segment);}
   const article=elem('article'),dot=elem('i'),name=elem('span',tier),value=elem('strong',total>0?`${pct(share)} · ${fmt(count)} 台`:'—');dot.style.background=color;article.append(dot,name,value);legend.append(article);
  }
  bar.setAttribute('aria-label',total>0?tiers.map(([tier])=>tier+' '+pct((tier==='未分类'?item.unknownUnits:item.tiers[tier])/total)).join('，'):'暂无可展示的销量占比');
  const partial=item?.expectedShopDays!=null&&item.coveredShopDays<item.expectedShopDays;
  get('mixNote').textContent=(total>0&&item.unknownUnits>0?`有 ${fmt(item.unknownUnits)} 台尚未完成机型分类，单独列示以避免占比失真。`:'未分类型号单独列示，不计入任何机型档位。')+(partial?' 当前周期尚有店铺日未导入，占比只反映已导入件数。':'');
  const share=item?.state==='ready'?item.cabinetShare:null;
  get('cabinetValue').textContent=pct(share);get('cabinetCount').textContent=item?.state==='ready'?fmt(item.cabinetUnits)+' 台':'—';get('allCount').textContent=total||item?.state==='ready'?fmt(total)+' 台':'—';
  get('cabinetRing').style.background=`conic-gradient(#3669f5 ${share==null?0:share*100}%, #e8eef7 0%)`;
  get('cabinetNote').textContent=item?.state==='ready'&&item.cabinetKnownUnits<item.units?'部分 SKU 未标注是否柜机，补齐后显示准确占比。':'柜机可同时属于任一档位，单独计算占比。';
 }
 function tableData(){if(!state.report)return[];if(state.mode==='annual')return[state.report.annual,...state.report.quarters];if(state.mode==='quarter')return state.report.months.slice((state.index-1)*3,state.index*3);return state.report.months;}
 function renderTable(){const body=get('periodRows');body.replaceChildren();const gree=current==='gree-ac';for(const period of tableData()){
  const tr=elem('tr'),name=elem('td');const button=elem('button',period.label,'ss-period-link');button.type='button';button.onclick=()=>{if(period.key.startsWith('Q')){state.mode='quarter';state.index=Number(period.key.slice(1));}else if(/^\d{2}$/.test(period.key)){state.mode='month';state.index=Number(period.key);}else{state.mode='annual';}render();};name.append(button);tr.append(name);
  const cells=[period.state==='ready'?fmt(period.units)+' 台':'—'];if(gree){for(const tier of ['引流机','普通机','中端机','高端机'])cells.push(period.state==='ready'&&period.units>0?`${pct((period.tiers?.[tier]||0)/period.units)} · ${fmt(period.tiers?.[tier]||0)}`:'—');cells.push(period.state==='ready'?pct(period.cabinetShare):'—');}
  cells.push(period.state==='future'?'未到':period.state==='missing'?'未导入':period.expectedShopDays!=null&&period.coveredShopDays<period.expectedShopDays?`部分导入 ${period.coveredShopDays}/${period.expectedShopDays}`:period.units===0?'已导入 · 0 台':'已导入');
  for(const value of cells){const td=elem('td',value);if(period.state==='missing')td.className='ss-missing';if(period.state==='future')td.className='ss-future';if(period.state==='ready'&&period.units===0)td.className='ss-zero';tr.append(td);}body.append(tr);
 }
 get('detailCaption').textContent=state.mode==='annual'?'年度与四个季度；点击季度查看各月':state.mode==='quarter'?'当前季度的各月销量':'全年各月销量';
 }
 function render(){document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===state.mode)));renderChoices();const item=active();
  get('periodCaption').textContent=item?`${item.start} 至 ${item.end}`:'';
  if(item?.state==='ready'){const partial=item.expectedShopDays!=null&&item.coveredShopDays<item.expectedShopDays;status(`${item.label} · ${partial?'部分导入':'已导入商品销量'}${item.expectedShopDays!=null?` · 已覆盖 ${item.coveredShopDays}/${item.expectedShopDays} 个店铺日`:''} · 截至 ${state.report.asOf}`,partial?'missing':'ready');}
  else if(item?.state==='missing')status(`${item.label} · 未导入商品销量数据；此处不按 0 台计算。`,'missing');
  else if(item?.state==='future')status(`${item.label} · 统计周期尚未到来。`,'future');
  renderMetrics(item);if(current==='gree-ac')renderMix(item);renderTable();
 }
 function renderShopOptions(){const select=get('shopFilter'),all=elem('option','全部相关店铺');all.value='';select.replaceChildren(all);
  const platform=current==='gree-ac'?get('platformFilter').value:null;
  for(const shop of state.shops.filter(item=>!platform||String(item.data?.platform||'').trim()===platform)){const option=elem('option',shop.data.name+(shop.data.shopId?' · '+shop.data.shopId:''));option.value=shop.id;select.append(option);}
  select.value='';
 }
 function renderSettlementMappings(sources){const section=get('settlementMapping'),box=get('shopMappings');box.replaceChildren();section.hidden=false;
  for(const source of sources){const label=elem('label'),title=elem('strong',`${source.name} · ${fmt(source.units)} 件`),select=elem('select');select.dataset.sourceKey=source.platform+'|'+source.name;
   const blank=elem('option','请选择店铺档案');blank.value='';select.append(blank);
   for(const shop of state.shops.filter(item=>item.data?.brand==='格力'&&item.data?.platform===source.platform)){const option=elem('option',shop.data.name+(shop.data.shopId?' · '+shop.data.shopId:''));option.value=shop.id;select.append(option);}
   select.value=source.shopId||'';label.append(title,select);box.append(label);
  }
 }
 async function loadReport(){status('正在加载商品销量…');try{state.report=await api('report',{params:{year:get('yearFilter').value,shop:get('shopFilter').value,...(current==='gree-ac'?{platform:get('platformFilter').value}:{})}});render();}catch(error){state.report=null;status(error.message,'error');get('periodRows').replaceChildren();renderMetrics(null);if(current==='gree-ac')renderMix(null);}}
 async function busy(button,task,target=get('importMessage')){button.disabled=true;try{await task();}catch(error){target.textContent=error.message;}finally{button.disabled=false;}}
 try{
  const identity=await session.getIdentity();state.role=identity.user.role;
  WorkbenchShell.mountShell({container:get('shell'),activeModule:'sales-structure-'+current,identity,onLogout:async()=>{await session.logout();location.replace('/login.html');}});
  get('breadcrumbCategory').textContent=labels[current];get('pageTitle').textContent=labels[current]+'销售结构';document.title=labels[current]+'销售结构 · 公司工作台';
  document.querySelectorAll('.ss-category-tabs a').forEach(link=>{if(link.dataset.category===current)link.setAttribute('aria-current','page');});
  get('greePanels').hidden=current!=='gree-ac';get('otherPanel').hidden=current==='gree-ac';
  get('platformControl').hidden=current!=='gree-ac';
  document.querySelectorAll('.ss-detail .gree-only').forEach(cell=>cell.hidden=current!=='gree-ac');
  get('importPanel').hidden=!['admin','operator'].includes(state.role);
  const thisYear=Number(new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,4));for(let y=thisYear;y>=2020;y--){const option=elem('option',y+' 年');option.value=String(y);get('yearFilter').append(option);}
  const meta=await api('meta');state.shops=meta.shops||[];renderShopOptions();
  await loadReport();
 }catch(error){if(error.code==='SESSION_EXPIRED'){location.replace('/login.html?returnTo='+encodeURIComponent(location.pathname+location.search));return;}status(error.message,'error');}
 get('yearFilter').onchange=loadReport;get('shopFilter').onchange=loadReport;
 get('platformFilter').onchange=()=>{renderShopOptions();loadReport();};
 document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{state.mode=button.dataset.mode;state.index=state.mode==='quarter'?Math.ceil(Number(state.report?.asOf.slice(5,7)||1)/3):state.mode==='month'?Number(state.report?.asOf.slice(5,7)||1):1;render();});
 get('file').onchange=()=>{state.previewId=null;state.previewKind='manual';get('previewBox').hidden=true;get('settlementMapping').hidden=true;get('importMessage').textContent=get('file').files[0]?`已选择 ${get('file').files[0].name}，请先校验预览。`:'请选择文件。';};
 get('template').onclick=()=>busy(get('template'),async()=>{const blob=await api('template',{download:true});const url=URL.createObjectURL(blob),link=elem('a');link.href=url;link.download=`${labels[current]}-商品销量模板.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);get('importMessage').textContent='模板已下载。';});
 get('preview').onclick=()=>busy(get('preview'),async()=>{const file=get('file').files[0];if(!file)throw Error('请选择 CSV 或 XLSX 文件');if(!/\.(csv|xlsx)$/i.test(file.name))throw Error('仅支持 CSV 或 XLSX 文件');if(!file.size||file.size>3*1024*1024)throw Error('文件不能为空且不能超过 3 MB');get('importMessage').textContent='正在校验文件…';const data=await api('preview',{method:'POST',raw:await file.arrayBuffer(),filename:file.name});state.previewId=data.id;state.previewKind=data.kind||'manual';get('previewBox').hidden=false;
  if(state.previewKind==='settlement'){get('previewSummary').textContent=`${data.platform||''}结算月份 ${data.batchKey} · ${data.rowCount} 行正数记录 · ${fmt(data.positiveUnits)} 件 · ${data.shopCount} 个来源店铺 · 下单日期 ${data.from} 至 ${data.to} · 排除 ${data.ignoredNegative} 行负数及 ${data.ignoredZero} 行零件数`+(data.replaceExisting?' · 确认后替换该平台、该月份的旧批次':'');renderSettlementMappings(data.sourceShops||[]);}
  else{get('settlementMapping').hidden=true;get('previewSummary').textContent=`${data.rowCount} 行 · ${data.shopCount} 家店铺 · ${data.from} 至 ${data.to}`+(current==='gree-ac'?` · ${data.unclassified} 行未填写机型档位`:'');}
  const body=get('previewRows');body.replaceChildren();for(const row of data.examples){const tr=elem('tr');for(const value of [row.date,row.shopCode,row.sku,row.units,row.tier||'未分类',row.cabinet===null?'未填写':row.cabinet?'是':'否'])tr.append(elem('td',value));body.append(tr);}get('importMessage').textContent='校验通过，请核对预览后确认导入。';});
 get('confirm').onclick=()=>busy(get('confirm'),async()=>{if(!state.previewId)throw Error('请先校验与预览文件');const shopMap={};if(state.previewKind==='settlement')for(const select of get('shopMappings').querySelectorAll('select')){if(!select.value)throw Error('请选择店铺档案后再确认导入');shopMap[select.dataset.sourceKey]=select.value;}
  const done=await api('confirm',{method:'POST',body:{id:state.previewId,shopMap}});get('previewBox').hidden=true;state.previewId=null;state.previewKind='manual';get('file').value='';get('importMessage').textContent=done.kind==='settlement'?`已导入 ${done.platform||''}结算月份 ${done.batchKey}：${fmt(done.positiveUnits)} 件，${done.shopCount} 家店铺；下单日期 ${done.from} 至 ${done.to}。`:`已导入 ${done.rowCount} 行，覆盖 ${done.shopCount} 家店铺，日期 ${done.from} 至 ${done.to}。`;await loadReport();});
})();
