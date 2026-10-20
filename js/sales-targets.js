(function(){
 const session=WorkbenchSession.createSessionClient();
 const SHOP_KEY='wb_sales_target_shop';
 const dialog=document.createElement('dialog');dialog.className='target-dialog';
 dialog.innerHTML=`<form method="dialog" class="target-close"><h2>目标设置</h2><button aria-label="关闭目标设置">×</button></form><div class="target-controls"><label>选择店铺 <select id="annualShop"></select></label><label>选择年份 <select id="annualYear"></select></label><label class="target-annual">年度目标（万元）· 自动合计<input id="annualAmount" type="number" readonly title="由 12 个月度目标自动合计，不可直接填写"></label><label>目标增长率 <input id="annualGrowth" type="number" step="0.01" readonly title="按年度目标与去年已导入销售额计算"></label><span id="targetFilled" class="target-hint"></span><span id="annualActual"></span></div><p class="workbench-muted">金额单位：万元。<strong>年度目标由 12 个月度目标自动合计</strong>，填写下方月度目标即实时汇总，保存后首页驾驶舱、销售报表、店铺排行同步使用同一数值。增长率按目标与去年已导入销售额计算；缺失数据不作零销售。</p><p id="targetError" role="status"></p><div class="sales-table"><table><thead id="annualHead"></thead><tbody id="annualRows"></tbody></table></div><p id="targetTotals"></p><div class="target-footer"><button id="saveAnnualTargets" class="workbench-primary">确定</button><button id="cancelAnnualTargets">取消</button></div>`;
 document.body.append(dialog);
 const q=id=>dialog.querySelector('#'+id),number=v=>v==null?'—':(Number(v)/1e6).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}),inputAmount=c=>c==null?'':String(Number(c)/1e6);
 let saved=[],previous=[],current=[],request=0,writable=false,savedAnnual=null;
 async function api(action,body,query=''){const r=await session.authorizedFetch('/api/sales?action='+action+query,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok)throw Error(d.error||'请求失败');return d.data;}
 function sum(rows){return rows.length?rows.reduce((n,r)=>n+Number(r.cents),0):null;}
 function inputs(){return [...q('annualRows').querySelectorAll('[data-month]')];}
 function monthTotal(){const filled=inputs().filter(i=>i.value!=='');return {filled:filled.length,total:filled.reduce((n,i)=>n+Number(i.value||0),0)};}
 // 月度合计是唯一真相：任何一次月度输入都会立刻写回顶部「年度目标」，不留两个口径。
 function totals(){
  const {filled,total}=monthTotal(),base=sum(previous);
  q('annualAmount').value=filled?total.toFixed(2):'';
  q('annualGrowth').value=filled?growth(total,base):'';
  q('targetFilled').className='target-hint'+(filled&&filled<12?' warn':'');
  q('targetFilled').textContent=filled?`已填 ${filled}/12 个月${filled<12?'（年度目标只含已填月份）':''}`:'未填任何月份';
  const compare=base>0&&filled?`，较 ${Number(q('annualYear').value)-1} 年销售额 ${((total*1e6/base-1)*100).toFixed(2)}%`:'';
  q('targetTotals').textContent=filled?`月度目标合计：${total.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})} 万元，已写入年度目标${compare}${stale(total)}`:'尚未填写月度目标，年度目标为空（保存后该店铺年度目标将被清空）';
 }
 // 库里还留着旧口径录入的年度目标时，明确告知它保存后会被月度合计覆盖。
 function stale(total){if(savedAnnual==null)return '';const derived=Math.round(Number(total)*1e6);return derived===Number(savedAnnual)?'':`｜已存年度目标 ${(Number(savedAnnual)/1e6).toFixed(2)} 万元与月度合计不一致，保存后统一为月度合计`;}
 function growth(amount,base){return base>0&&amount!==''?((Number(amount)*1e6/base-1)*100).toFixed(2):'';}
 async function load(){const token=++request;const year=q('annualYear').value,shop=q('annualShop').value;q('saveAnnualTargets').disabled=true;q('targetError').textContent='正在加载…';q('annualRows').replaceChildren();try{
 const [targets,old,now]=await Promise.all([api('targets'),api('overview',null,`&shop=${shop}&status=all&grain=month&start=${Number(year)-1}-01-01&end=${Number(year)-1}-12-31`),api('overview',null,`&shop=${shop}&status=all&grain=month&start=${year}-01-01&end=${year}-12-31`)]);if(token!==request)return;
 saved=targets.filter(t=>t.shop_id===shop);previous=old.rows;current=now.rows;savedAnnual=saved.find(t=>t.period===year)?.cents??null;
 q('annualActual').textContent=`${year}年已导入销售额：${number(sum(current))} 万元`;
 q('annualHead').innerHTML=`<tr><th>月份</th><th>${Number(year)-1}年销售额</th><th>${year}年目标值</th><th>目标增长率（%）</th><th>${year}年销售额</th><th>目标完成率</th></tr>`;
 for(let m=1;m<=12;m++){const key=String(m).padStart(2,'0'),before=previous.find(r=>r.period.endsWith('-'+key))?.cents,actual=current.find(r=>r.period.endsWith('-'+key))?.cents,target=saved.find(t=>t.period===year+'-'+key)?.cents;const row=document.createElement('tr');row.innerHTML=`<td>${m}月</td><td>${number(before)}</td><td><input data-month="${m}" type="number" min="0.000001" step="0.000001" aria-label="${m}月目标（万元）"></td><td><input data-growth="${m}" type="number" step="0.01" aria-label="${m}月目标增长率"></td><td>${number(actual)}</td><td class="completion"></td>`;const amount=row.querySelector('[data-month]'),rate=row.querySelector('[data-growth]');amount.value=inputAmount(target);amount.disabled=!writable;rate.disabled=!writable||!(before>0);const refresh=()=>{rate.value=growth(amount.value,before);row.querySelector('.completion').textContent=actual!=null&&Number(amount.value)>0?(actual/(Number(amount.value)*1e6)*100).toFixed(2)+'%':'—';totals();};amount.oninput=refresh;rate.oninput=()=>{if(before>0&&rate.value!=='')amount.value=(before/1e6*(1+Number(rate.value)/100)).toFixed(6);row.querySelector('.completion').textContent=actual!=null&&Number(amount.value)>0?(actual/(Number(amount.value)*1e6)*100).toFixed(2)+'%':'—';totals();};q('annualRows').append(row);refresh();}
 q('targetError').textContent='';totals();q('saveAnnualTargets').disabled=!writable;
 }catch(e){if(token===request)q('targetError').textContent=e.message;}}
 // 年度目标与年度增长率均为派生只读值，改由月度目标驱动，因此不再绑定输入事件。
 q('annualShop').onchange=()=>{try{localStorage.setItem(SHOP_KEY,q('annualShop').value);}catch{}load();};q('annualYear').onchange=load;q('cancelAnnualTargets').onclick=()=>dialog.close();
 q('saveAnnualTargets').onclick=async()=>{const months=inputs();if(months.some(i=>!i.checkValidity())){q('targetError').textContent='目标须大于0，未设置请留空。';return;}q('saveAnnualTargets').disabled=true;try{const shopName=q('annualShop').selectedOptions[0]?.textContent||'',year=q('annualYear').value,yuan=i=>i.value===''?null:(Number(i.value)*10000).toFixed(2);const d=await api('target-year',{shop:q('annualShop').value,year,months:months.map(yuan)});dialog.close();window.dispatchEvent(new CustomEvent('sales:targets-updated',{detail:{shop:shopName,year,annual:d.annual,months:d.months}}));}catch(e){q('targetError').textContent=e.message;q('saveAnnualTargets').disabled=false;}};
 document.getElementById('openAnnualTargets').onclick=async()=>{dialog.showModal();q('saveAnnualTargets').disabled=true;q('targetError').textContent='正在加载…';try{const identity=await session.getIdentity();writable=['admin','operator'].includes(identity.user.role);q('annualAmount').disabled=!writable;const shops=await api('shops');q('annualShop').replaceChildren(...shops.map(s=>new Option(s.data.name,s.id)));let last=null;try{last=localStorage.getItem(SHOP_KEY);}catch{}if(last&&shops.some(s=>s.id===last))q('annualShop').value=last;q('annualYear').replaceChildren(...Array.from({length:new Date().getFullYear()-2018},(_,i)=>new Option(String(2020+i),String(2020+i))));q('annualYear').value=String(new Date().getFullYear());if(!shops.length){q('targetError').textContent='请先新增店铺档案';q('saveAnnualTargets').disabled=true;return;}await load();}catch(e){q('targetError').textContent=e.message;}};
})();
