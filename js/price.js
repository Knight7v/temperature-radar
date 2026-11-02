(async()=>{
'use strict';
/* 比价助手（竞品到手价监控）—— 页面层。
   口径（2026-11-02 用户拍板）：到手价 = 标价 − 可叠加券 − 国补，这是主告警口径，
   因为顾客实际掏的就是这个数。标价只在明细里展示，不单独告警——
   标价天天变，混在一起报会把「别人发了张券」误读成「降价」。
   数据接口异常时进入「演示模式」：页面结构、筛选、下钻、导出全部可用，
   但所有数字都带「演示」标识，绝不伪装成真实抓取结果。 */

const session=WorkbenchSession.createSessionClient();
const $=id=>document.getElementById(id);
const money=v=>v==null?'—':'¥'+Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const pct=v=>v==null?'':(v>0?'+':'')+v.toFixed(2)+'%';

const state={
 mode:'live',            /* live | demo */
 tab:'hits',
 ltab:'import',          /* 链接管理子页：import | list */
 filter:{brand:'',status:''},
 linkFilter:{q:'',brand:'',side:'',state:''},
 hits:[],missing:[],links:[],trend:[],
 linkView:{groups:[],summary:{}},
 linkIndex:new Map(),    /* normalizeUrl → link，导入前判断「已存在」用 */
 modelTouched:false,     /* 用户手动改过「归属商品」下拉，刷新时不再替他重置 */
 preview:null,           /* 解析结果，确认导入时用 */
 collapsed:new Set(),
 drawerModel:null
};

/* ---------------- 演示数据（接口未上线时使用） ---------------- */
function demoData(){
 const mk=(o)=>Object.assign({confidence:'high',status:'open',lowerCount:0,otherShops:[]},o);
 const hits=[
  mk({id:'m1',brand:'gree',code:'KFR-35GW/NhAa1BAj',series:'云锦Ⅲ',cap:'1.5匹',my:3299,comp:3169,shop:'国美电器旗舰店',lowerCount:3,otherShops:['苏宁易购官方旗舰店','五星电器旗舰店','京东电器超级体验店'],firstSeen:'10-30 10:12',confidence:'high'}),
  mk({id:'m2',brand:'gree',code:'KFR-72LW/NhAa3B',series:'京逸',cap:'3匹柜机',my:7999,comp:7820,shop:'恒信电器专营店',lowerCount:2,otherShops:['国美电器旗舰店','华联家电旗舰店'],firstSeen:'10-30 10:19',confidence:'medium'}),
  mk({id:'m3',brand:'haier',code:'KFR-35GW/01KBB81U1',series:'静悦',cap:'1.5匹',my:2899,comp:2799,shop:'海尔智家优选店',lowerCount:4,otherShops:['青岛海尔空调专营','海联电器旗舰店','鑫盛家电专营店','鲁南家电旗舰店'],firstSeen:'10-30 10:24',confidence:'high'}),
  mk({id:'m4',brand:'haier',code:'KFR-35GW/81@U1-Hc',series:'云曜',cap:'1.5匹',my:3099,comp:3085,shop:'浙北家电旗舰店',lowerCount:1,otherShops:['宁波华联电器'],firstSeen:'10-29 20:14',confidence:'low'}),
  mk({id:'m5',brand:'gree',code:'KFR-26GW/NhAa1Baj',series:'云佳',cap:'大1匹',my:2199,comp:2185,shop:'华南电器专营店',lowerCount:1,otherShops:[],firstSeen:'10-28 10:31',status:'ignored',confidence:'high'}),
  mk({id:'m6',brand:'haier',code:'KFR-50LW/03KCA81U1',series:'致樽',cap:'2匹柜机',my:5299,comp:5299,shop:'—',lowerCount:0,otherShops:[],firstSeen:'—',status:'recovered',confidence:'high'})
 ];
 const missing=[
  {model:'格力 云锦Ⅲ 1.5匹',shop:'国美电器旗舰店',url:'https://item.jd.com/100012043978.html',reason:'页面需验证码',last:3269,lastAt:'10-29 20:11'},
  {model:'格力 京逸 3匹柜机',shop:'华联家电旗舰店',url:'https://item.jd.com/100021234567.html',reason:'连续 3 次超时',last:7899,lastAt:'10-29 10:20'},
  {model:'海尔 静悦 1.5匹',shop:'青岛海尔空调专营',url:'https://item.jd.com/100045678901.html',reason:'价格区块未识别（疑似改版）',last:2799,lastAt:'10-30 10:22'},
  {model:'海尔 云曜 1.5匹',shop:'鑫盛家电专营店',url:'https://item.jd.com/100056789012.html',reason:'商品已下架',last:3059,lastAt:'10-28 20:08'},
  {model:'格力 云佳 大1匹',shop:'苏宁易购官方旗舰店',url:'https://item.jd.com/100067890123.html',reason:'登录态失效，仅取到基础价',last:null,lastAt:'—'},
  {model:'海尔 致樽 2匹柜机',shop:'海联电器旗舰店',url:'https://item.jd.com/100078901234.html',reason:'页面需验证码',last:5319,lastAt:'10-29 10:15'},
  {model:'格力 悦风Ⅱ 2匹柜机',shop:'五星电器旗舰店',url:'https://item.jd.com/100089012345.html',reason:'价格区块未识别（疑似改版）',last:5599,lastAt:'10-30 10:26'}
 ];
 return {mode:'demo',hits,missing,
  status:{lastRun:'10-30 20:12',lastResult:'success',nextRun:'10-31 10:00',login:'ok',loginNote:'登录有效（PLUS 价与券可读）'},
  cover:{models:46,links:287},
  config:{amount:3,rate:0.3,full:'10:00',focus:'20:00',webhook:'已配置（群机器人 …a7f3）',notify:'major',subsidyRate:15,subsidyCap:1500}
 };
}

/* ---------------- 接口 ---------------- */
/* 注意：init 必须往下传。以前这里写成 api(path) 只收一个参数，
 * 结果所有「保存设置 / 忽略告警 / 立即采集 / 导入链接」的 POST 实际都按 GET 发出去，
 * 页面还显示成功——接口返回的是列表数据，字段读不到就被当成「新增 0 条」。
 * 2026-11-02 排查导入不生效时发现。 */
async function api(path,init){
 const res=await session.authorizedFetch(path,init);
 let body={};
 try{body=await res.json();}catch{}
 if(!res.ok){
  const err=Error(typeof body.error==='string'?body.error:'请求失败');
  err.status=res.status;
  throw err;
 }
 return body.data;
}
const isMissingApi=e=>/接口不存在|404/.test(String(e&&e.message||''))||e.status===404;

/* ---------------- 渲染：状态条与 KPI ---------------- */
function renderStatus(s){
 const runTone=s.lastResult==='success'?'':(s.lastResult==='blocked'?'bad':'warn');
 $('dotRun').className='px-dot '+runTone;
 const runText=s.lastRun
  ? '最近采集 '+s.lastRun+(s.lastResult==='success'?' 完成':(s.lastResult==='blocked'?' 被风控中断':' 部分缺失'))
  : '今日尚未采集';
 $('txtRun').textContent=runText;
 $('txtNext').textContent='下次采集 '+(s.nextRun||'—');
 $('txtLogin').textContent='我方登录 '+(s.login==='ok'?'正常':(s.login==='expired'?'已失效，需扫码':'未知'))+(s.loginNote?'（'+s.loginNote+'）':'');
 $('txtLogin').style.color=s.login==='expired'?'#c4291c':'';
}

function fillConfig(cfg){
 if(!cfg)return;
 if(cfg.amount!=null)$('cfgAmount').value=cfg.amount;
 if(cfg.rate!=null)$('cfgRate').value=cfg.rate;
 if(cfg.full)$('cfgFull').value=cfg.full;
 if(cfg.focus)$('cfgFocus').value=cfg.focus;
 if(cfg.subsidyRate!=null)$('cfgSubsidyRate').value=cfg.subsidyRate;
 if(cfg.subsidyCap!=null)$('cfgSubsidyCap').value=cfg.subsidyCap;
 $('cfgWebhook').value=cfg.webhook||'未配置';
 if(cfg.notify)$('cfgNotify').value=cfg.notify;
}

function renderKpis(d){
 const open=d.hits.filter(h=>h.status==='open');
 const maxGap=open.reduce((m,h)=>Math.max(m,h.my-h.comp),0);
 $('kpiAlerts').textContent=open.length;
 $('kpiAlertsNote').textContent=open.length?'竞品比我方低，需处理':'暂无命中';
 $('kpiGap').textContent=maxGap?money(maxGap):'—';
 $('kpiGapNote').textContent=maxGap?'单机型最高差额':'今日无价差';
 const miss=d.missing.length;
 $('kpiMissing').textContent=miss;
 $('kpiMissingNote').textContent=miss?'不参与比价，需人工补或重试':'全部采集成功';
 $('kpiCover').textContent=(d.cover&&d.cover.models!=null?d.cover.models:'—')+' / '+(d.cover&&d.cover.links!=null?d.cover.links:'—');
 $('kpiCoverNote').textContent='机型 / 竞品链接';
 $('tabNumHits').textContent=open.length;
 $('tabNumMissing').textContent=miss;
}

/* ---------------- 渲染：命中表 ---------------- */
function gapCell(h){
 const gap=h.my-h.comp;
 if(gap>0)return '<span class="px-gap-pos">低 '+money(gap)+'</span><br><small class="px-hint">'+((gap/h.my)*100).toFixed(2)+'%</small>';
 if(gap<0)return '<span class="px-gap-neg">高 '+money(-gap)+'</span>';
 return '<span class="px-gap-zero">持平</span>';
}
const statusBadge=s=>({open:'<span class="px-badge is-open">待处理</span>',ignored:'<span class="px-badge is-ignored">已忽略</span>',recovered:'<span class="px-badge is-recovered">已回升</span>',normal:'<span class="px-badge">未命中</span>'}[s]||'<span class="px-badge">未知</span>');
const confBadge=c=>({high:'<span class="px-badge is-high">高</span>',medium:'<span class="px-badge is-medium">中</span>',low:'<span class="px-badge is-low">低·可能更低</span>'}[c]||'<span class="px-badge">—</span>');

function renderHits(){
 const body=$('hitsBody');
 const brand=state.filter.brand,status=state.filter.status;
 const rows=state.hits.filter(h=>(!brand||h.brand===brand)&&(!status||h.status===status));
 if(!rows.length){
  body.innerHTML='<tr><td colspan="9" class="px-empty"><strong>没有符合条件的记录</strong><p>换个筛选条件，或等下一轮采集。</p></td></tr>';
  return;
 }
 body.innerHTML=rows.map(h=>{
  const series=(h.brand==='gree'?'格力':'海尔')+' '+h.series;
  /* 标价小字只在「确实减过」时出现：标价 3098、到手 3098 的机器写两遍一样的数只会干扰阅读 */
  const listedNote=(v,landed)=>v==null||v===landed?'':'<br><small class="px-hint">标价 '+money(v)+'</small>';
  const comp=h.comp==null?'—':money(h.comp)+listedNote(h.compListed,h.comp)+(h.shop&&h.shop!=='—'?'<br><small class="px-hint">'+h.shop+'</small>':'');
  return '<tr data-model="'+h.id+'" class="'+(h.status==='open'?'is-open':'')+'">'
   +'<td><span class="px-model">'+series+'<small>'+h.code+' · '+h.cap+'</small></span></td>'
   +'<td class="px-num px-price-my">'+money(h.my)+listedNote(h.myListed,h.my)+'</td>'
   +'<td class="px-num">'+comp+'</td>'
   +'<td class="px-num">'+gapCell(h)+'</td>'
   +'<td>'+(h.lowerCount?h.lowerCount+' 家':'—')+'</td>'
   +'<td>'+confBadge(h.confidence)+'</td>'
   +'<td>'+statusBadge(h.status)+'</td>'
   +'<td class="px-num">'+h.firstSeen+'</td>'
   +'<td><button type="button" class="px-badge" data-act="ignore" data-id="'+h.id+'">'+(h.status==='ignored'?'取消忽略':'忽略')+'</button></td>'
   +'</tr>';
 }).join('');
 body.querySelectorAll('tr[data-model]').forEach(tr=>{
  tr.addEventListener('click',e=>{
   if(e.target.closest('[data-act]'))return;
   openDrawer(tr.dataset.model);
  });
 });
 body.querySelectorAll('[data-act="ignore"]').forEach(btn=>{
  btn.addEventListener('click',()=>toggleIgnore(btn.dataset.id));
 });
}

function toggleIgnore(id){
 const h=state.hits.find(x=>x.id===id);if(!h)return;
 h.status=h.status==='ignored'?'open':'ignored';
 renderHits();renderKpis(currentData());
 if(state.mode==='demo')toast('演示模式：忽略状态没有写库，接口上线后会真正保存。');
 else api('/api/price/alert-action?action='+(h.status==='ignored'?'ignore':'restore')+'&id='+encodeURIComponent(id),{method:'POST'}).catch(e=>toast(explain(e),'bad'));
}

/* ---------------- 渲染：缺失表 ---------------- */
function renderMissing(){
 const body=$('missingBody');
 if(!state.missing.length){
  body.innerHTML='<tr><td colspan="6" class="px-empty"><strong>本轮全部采集成功</strong><p>没有缺失链接。</p></td></tr>';
  return;
 }
 body.innerHTML=state.missing.map(m=>(
  '<tr>'
  +'<td><span class="px-model">'+m.model+'<small>'+m.shop+'</small></span></td>'
  +'<td class="px-hint" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+m.url+'</td>'
  +'<td><span class="px-badge is-medium">'+m.reason+'</span></td>'
  +'<td class="px-num">'+(m.last==null?'—':money(m.last))+'</td>'
  +'<td class="px-num">'+m.lastAt+'</td>'
  +'<td><button type="button" class="px-badge" data-fill="1">手动补价</button></td>'
  +'</tr>'
 )).join('');
 body.querySelectorAll('[data-fill]').forEach(b=>b.addEventListener('click',()=>toast('人工补价需要接口支持，接口上线后在这里填。','warn')));
}

/* ---------------- 抽屉 ---------------- */
function demoLinks(h){
 const own=[{shop:'格力京东自营旗舰店',side:'own',price:h.my,listed:h.my,afterPromo:h.my,subsidy:0,promoText:'',status:'ok',at:'10-30 10:08'}];
 const comps=[
  {shop:h.shop,side:'comp',price:h.comp,listed:h.comp+719.7,afterPromo:h.comp+419.7,subsidy:419.7,promoText:'满1件减300元',status:'ok',at:'10-30 10:12'},
  ...(h.otherShops||[]).map((s,i)=>({shop:s,side:'comp',price:h.comp+[60,120,180,240][i%4],listed:h.comp+[60,120,180,240][i%4],afterPromo:h.comp+[60,120,180,240][i%4],subsidy:0,promoText:'',status:'ok',at:'10-30 10:1'+(3+i)}))
 ];
 return own.concat(comps);
}
/* 到手价链条：「标价 3098 → 券后 2798 → 国补 −419.7 → 到手 2378.3」
   为什么要在明细里摊开：只给一个到手价，运营无法判断是我们算错了，还是对手真的降了。 */
function chainText(l){
 if(l.status!=='ok'||l.price==null)return '';
 const seg=[];
 if(l.listed!=null)seg.push('标价 '+money(l.listed));
 if(l.afterPromo!=null&&l.listed!=null&&l.afterPromo!==l.listed)seg.push('券后 '+money(l.afterPromo));
 if(l.subsidy)seg.push('国补 −'+money(l.subsidy));
 return seg.length>1?seg.join(' → ')+' → 到手 '+money(l.price):'';
}

function openDrawer(id){
 const h=state.hits.find(x=>x.id===id);if(!h)return;
 state.drawerModel=h;
 const brand=h.brand==='gree'?'格力':'海尔';
 $('drawerTitle').textContent=brand+' '+h.series+' '+h.cap;
 $('drawerSub').textContent=h.code+' · 首次发现 '+h.firstSeen+(h.confidence==='low'?' · 置信度低：券或国补未取全，竞品实际可能更低':'');
 const links=state.mode==='demo'?demoLinks(h):(h.links||[]);
 const rows=links.slice().sort((a,b)=>(a.price==null?1e9:a.price)-(b.price==null?1e9:b.price)).map(l=>{
  const low=l.side==='comp'&&l.price!=null&&l.price<h.my;
  const chain=chainText(l);
  const promo=l.promoText?'<small class="px-hint">优惠：'+l.promoText+'</small>':'';
  return '<div class="px-linkrow '+(low?'is-low':'')+'">'
   +'<div class="px-shop"><em class="'+(l.side==='own'?'is-own':'')+'">'+(l.side==='own'?'我方':'竞品')+'</em><span>'+l.shop+'</span></div>'
   +'<div class="px-money">'+money(l.price)+'</div>'
   +'<small'+(low?' class="is-bad"':'')+'>'+(l.status==='ok'?'采集正常 '+l.at:'采集失败：'+(l.reason||'未知'))+'</small>'
   +(chain?'<small class="px-hint">'+chain+'</small>':'')
   +promo
   +'</div>';
 }).join('');
 $('drawerBody').innerHTML=
  '<div class="px-dl">'
  +'<div><span>我方到手价</span><strong>'+money(h.my)+'</strong>'+(h.myListed!=null&&h.myListed!==h.my?'<small class="px-hint">标价 '+money(h.myListed)+'</small>':'')+'</div>'
  +'<div><span>竞品到手价</span><strong>'+money(h.comp)+'</strong>'+(h.compListed!=null&&h.compListed!==h.comp?'<small class="px-hint">标价 '+money(h.compListed)+'</small>':'')+'</div>'
  +'<div><span>价差</span><strong style="color:'+(h.my-h.comp>0?'#d92d20':'#0f7b57')+'">'+(h.my-h.comp>0?'低 '+money(h.my-h.comp):'高 '+money(h.comp-h.my))+'</strong></div>'
  +'</div>'
  +'<h3 style="font-size:13px;margin:0 0 8px;color:#5b6a7c">全部链接到手价（按价格从低到高）</h3>'
  +'<div class="px-linklist">'+rows+'</div>'
  +'<p class="px-hint" style="margin:14px 0 0">口径：<b>到手价 = 标价 − 可叠加券 − 国补</b>。国补按券后价的 15% 计算（单件上限 1500 元），只有页面标明支持国补的商品才算。竞品没有国补或券没取到时，标「置信度低」，算出来的价格偏高，只会漏报不会虚报。</p>';
 $('drawer').hidden=false;$('drawerMask').hidden=false;
 requestAnimationFrame(()=>{$('drawer').classList.add('is-open');$('drawerMask').classList.add('is-open');});
 $('drawerClose').focus();
}
function closeDrawer(){
 $('drawer').classList.remove('is-open');$('drawerMask').classList.remove('is-open');
 setTimeout(()=>{$('drawer').hidden=true;$('drawerMask').hidden=true;},220);
}

/* ---------------- 趋势图（手写 SVG，不引图表库） ---------------- */
function series(base,seed,n=14){
 const out=[];let v=base;
 for(let i=0;i<n;i++){
  const r=Math.sin((seed+i*1.7))*0.011+Math.cos((seed*2+i*0.9))*0.006;
  v=v*(1+r);
  out.push(Math.round(v/10)*10);
 }
 out[n-1]=base;
 return out;
}
function days(n=14){
 const out=[];const now=new Date('2026-10-30T00:00:00+08:00');
 for(let i=n-1;i>=0;i--){const d=new Date(now.getTime()-i*86400000);out.push((d.getMonth()+1)+'-'+String(d.getDate()).padStart(2,'0'));}
 return out;
}
function renderTrend(){
 const sel=$('trendSelect');
 const options=state.hits.map(h=>({id:h.id,label:(h.brand==='gree'?'格力':'海尔')+' '+h.series+' '+h.cap}));
 if(!options.length){$('trendChart').innerHTML='';return;}
 if(!sel.options.length||sel.options.length!==options.length){
  sel.innerHTML=options.map(o=>'<option value="'+o.id+'">'+o.label+'</option>').join('');
 }
 const h=state.hits.find(x=>x.id===sel.value)||state.hits[0];
 if(!h){$('trendChart').innerHTML='';return;}
 const mine=state.mode==='demo'?series(h.my,3):(h.trendMy||[]);
 const comp=state.mode==='demo'?series(h.comp,7):(h.trendComp||[]);
 drawChart($('trendChart'),days(mine.length||14),mine,comp);
 $('trendSub').textContent=(h.brand==='gree'?'格力':'海尔')+' '+h.series+' '+h.cap+'：我方最低到手价 vs 竞品最低到手价，近 '+(mine.length||14)+' 天。';
}
function drawChart(svg,xs,a,b){
 const W=720,H=240,P={l:56,r:14,t:14,b:30};
 const all=a.concat(b).filter(v=>Number.isFinite(v));
 if(!all.length){svg.innerHTML='';return;}
 const min=Math.min(...all),max=Math.max(...all);
 const pad=Math.max((max-min)*0.2,20);
 /* 刻度取整：先按区间挑一个好读的步长，再让上下界落在步长的整数倍上，避免出现 3,155 这种刻度 */
 const raw=((max+pad)-(min-pad))/4;
 const step=[10,20,25,50,100,200,250,500,1000].find(v=>v>=raw)||1000;
 const lo=Math.floor((min-pad)/step)*step, hi=Math.ceil((max+pad)/step)*step;
 const X=i=>P.l+(W-P.l-P.r)*(i/Math.max(xs.length-1,1));
 const Y=v=>P.t+(H-P.t-P.b)*(1-(v-lo)/Math.max(hi-lo,1));
 const line=arr=>arr.map((v,i)=>X(i).toFixed(1)+','+Y(v).toFixed(1)).join(' ');
 let out='';
 const ticks=Math.max(2,Math.round((hi-lo)/step));
 for(let g=0;g<=ticks;g++){
  const v=lo+(hi-lo)*g/ticks, y=Y(v).toFixed(1);
  out+='<line x1="'+P.l+'" y1="'+y+'" x2="'+(W-P.r)+'" y2="'+y+'" stroke="#eef2f8" stroke-width="1"/>';
  out+='<text x="'+(P.l-8)+'" y="'+(Number(y)+4)+'" text-anchor="end" font-size="11" fill="#96a2b4">'+v.toLocaleString('zh-CN')+'</text>';
 }
 xs.forEach((d,i)=>{if(i%3===0||i===xs.length-1){out+='<text x="'+X(i).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle" font-size="11" fill="#96a2b4">'+d+'</text>';}});
 out+='<polyline points="'+line(b)+'" fill="none" stroke="#d92d20" stroke-width="2" stroke-linejoin="round"/>';
 out+='<polyline points="'+line(a)+'" fill="none" stroke="#0665ff" stroke-width="2.2" stroke-linejoin="round"/>';
 a.forEach((v,i)=>{if(i===a.length-1)out+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="3.6" fill="#0665ff"/>';});
 b.forEach((v,i)=>{if(i===b.length-1)out+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="3.6" fill="#d92d20"/>';});
 svg.innerHTML=out;
}

/* ---------------- 链接管理：解析 / 导入 / 查看 ---------------- */
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* 京东链接的几种写法。和 lib/price/links.js 保持一致，服务端会再解析一遍（以前端只做预览） */
const SKU_RULES=[/item\.jd\.com\/(\d+)\.html/,/item\.m\.jd\.com\/product\/(\d+)/,/(?:sku|skuId|wareId)=(\d+)/i,/^(\d{6,20})$/];
function skuOf(raw){const s=String(raw||'').trim();for(const re of SKU_RULES){const m=s.match(re);if(m)return m[1];}return null;}
const urlOfSku=sku=>'https://item.jd.com/'+sku+'.html';

function targetLabel(){
 const sel=$('linkModel');
 if(!sel||!sel.value)return '<span class="px-hint">未选商品</span>';
 if(sel.value==='__new__'){
  const brand=$('newBrand'),series=String($('newSeries').value||'').trim(),cap=String($('newCap').value||'').trim();
  const name=(brand.options[brand.selectedIndex]||{}).text||'';
  return series?esc((name+' '+series+' '+cap).replace(/\s+/g,' ').trim()):'<span class="px-hint">新建商品（还没填系列）</span>';
 }
 const g=state.linkView.groups.find(x=>x.id===sel.value);
 return g?esc(g.label):'<span class="px-hint">未知商品</span>';
}
function targetReady(){
 const v=$('linkModel').value;
 if(v==='__new__')return !!String($('newSeries').value||'').trim();
 return !!v;
}

function buildPreview(text){
 const seen=new Set();const rows=[];let dup=0;
 String(text||'').split(/[\s,;，；、]+/).map(s=>s.trim()).filter(Boolean).forEach(raw=>{
  const sku=skuOf(raw);
  if(!sku){rows.push({sku:'—',url:'',state:'invalid',note:'不是京东商品链接，已跳过'});return;}
  const url=urlOfSku(sku);
  if(seen.has(url)){dup+=1;return;}
  seen.add(url);
  const hit=state.linkIndex.get(url);
  if(hit)rows.push({sku,url,state:'exists',note:'已在「'+hit.groupLabel+'」下（'+(hit.side==='own'?'我方':'竞品')+'）'});
  else rows.push({sku,url,state:'create',note:'新链接，确认后入库'});
 });
 return {rows,dup,create:rows.filter(r=>r.state==='create').length,exists:rows.filter(r=>r.state==='exists').length,valid:rows.filter(r=>r.state!=='invalid').length};
}

function previewBadge(s){
 return {create:'<span class="px-badge is-high">将新增</span>',exists:'<span class="px-badge">已存在</span>',invalid:'<span class="px-badge is-open">无效</span>'}[s]||'';
}

function renderPreview(p){
 state.preview=p;
 const table=$('previewTable'),body=$('previewBody');
 if(!p.rows.length){
  table.hidden=true;
  $('parseHint').textContent='没识别到链接，检查一下是不是京东商品页地址。';
  $('parseHint').className='px-hint is-bad';
  $('btnImport').disabled=true;
  return;
 }
 table.hidden=false;
 const target=targetLabel();
 body.innerHTML=p.rows.slice(0,300).map(r=>(
  '<tr>'
  +'<td class="px-num">'+esc(r.sku)+'</td>'
  +'<td>'+target+'</td>'
  +'<td>'+previewBadge(r.state)+'</td>'
  +'<td class="px-hint">'+esc(r.note)+'</td>'
  +'</tr>'
 )).join('');
 const bits=['识别 '+p.rows.length+' 条'];
 if(p.create)bits.push('将新增 '+p.create);
 if(p.exists)bits.push('已存在 '+p.exists);
 if(p.dup)bits.push('批内重复已去 '+p.dup);
 if(p.rows.length-p.valid)bits.push('无效 '+(p.rows.length-p.valid));
 if(p.rows.length>300)bits.push('预览只列前 300 条，导入仍按全部');
 $('parseHint').textContent=bits.join('，')+'。';
 $('parseHint').className='px-hint is-ok';
 const can=p.create>0&&targetReady();
 $('btnImport').disabled=!can;
 $('btnImport').textContent=p.create>0?('确认导入 '+p.create+' 条'):'确认导入';
 if(p.create>0&&!targetReady()){
  $('parseHint').textContent+=' 先在上面选好归属商品。';
  $('parseHint').className='px-hint is-bad';
 }
}

function syncModelFields(){
 const isNew=$('linkModel').value==='__new__';
 $('newModelFields').hidden=!isNew;
 if(state.preview)$('btnImport').disabled=!(state.preview.create>0&&targetReady());
}

function fillModelSelect(){
 const sel=$('linkModel');
 if(!sel)return;
 const cur=sel.value;
 const groups=state.linkView.groups||[];
 const opts=groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.label)+'（'+g.links.length+' 条）</option>');
 opts.push('<option value="__new__">＋ 新建商品…</option>');
 sel.innerHTML=opts.join('');
 // 用户没动过下拉时，默认选第一个已有商品而不是「新建」——
  // 否则每天开着「新建商品」状态粘贴，一不小心就造出一堆空机型。
 const keep=state.modelTouched&&[...sel.options].some(o=>o.value===cur);
 sel.value=keep?cur:(groups.length?groups[0].id:'__new__');
 syncModelFields();
}

function updateLinkNums(shown){
 const s=state.linkView.summary||{};
 const total=s.links||0;
 if($('linkNum'))$('linkNum').textContent=total||'0';
 if($('tabNumLinks'))$('tabNumLinks').textContent=total||'0';
 if($('linkSub')){
  $('linkSub').textContent='共 '+(s.models||0)+' 个商品 · '+total+' 条链接（我方 '+(s.own||0)+' / 竞品 '+(s.comp||0)+'）'
   +(s.paused?'，其中 '+s.paused+' 条已停用':'')
   +(shown!=null&&shown!==total?'；当前筛选显示 '+shown+' 条':'')
   +'。点商品编号直接打开京东页面核对。';
 }
}

function rebuildLinkIndex(){
 const map=new Map();
 (state.linkView.groups||[]).forEach(g=>{
  (g.links||[]).forEach(l=>map.set(l.url,{...l,groupLabel:g.label,groupId:g.id}));
 });
 state.linkIndex=map;
}

async function loadLinks(silent){
 try{
  const data=await api('/api/price/links');
  state.linkView=data||{groups:[],summary:{}};
  rebuildLinkIndex();
  fillModelSelect();
  updateLinkNums();
  if(state.tab==='links'&&state.ltab==='list')renderLinkList();
 }catch(e){
  if(!silent)toast(explain(e),'bad');
  const body=$('linkBody');
  if(body&&state.tab==='links'){
   body.innerHTML='<tr><td colspan="7" class="px-empty"><strong>链接清单读取失败</strong><p>'+esc(explain(e))+'</p></td></tr>';
  }
 }
}

function linkStateBadge(l){
 if(l.status!=='active')return '<span class="px-badge is-ignored">已停用</span>';
 if(!l.obsStatus)return '<span class="px-badge">待采集</span>';
 if(l.obsStatus==='ok')return '<span class="px-badge is-recovered">采集正常</span>';
 const short={blocked:'被风控',delisted:'已下架',failed:'采集失败'}[l.obsStatus]||'采集失败';
 return '<span class="px-badge is-open" title="'+esc(l.reason||'')+'">'+short+'</span>';
}

function renderLinkList(){
 const tb=$('linkBody');
 if(!tb)return;
 const groups=state.linkView.groups||[];
 if(!groups.length){
  tb.innerHTML='<tr><td colspan="7" class="px-empty"><strong>还没有在监控的链接</strong><p>去「导入链接」粘贴几条，入库后这里就能看到。</p></td></tr>';
  updateLinkNums(0);
  return;
 }
 const f=state.linkFilter;
 const q=String(f.q||'').trim().toLowerCase();
 let html='';let shown=0;

 groups.forEach(g=>{
  if(f.brand&&g.brand!==f.brand)return;
  const links=(g.links||[]).filter(l=>{
   if(f.side&&l.side!==f.side)return false;
   if(f.state==='active'&&l.status!=='active')return false;
   if(f.state==='paused'&&l.status==='active')return false;
   if(q){
    const hay=(g.label+' '+l.shop+' '+l.sku+' '+(l.title||'')).toLowerCase();
    if(!hay.includes(q))return false;
   }
   return true;
  });
  if(!links.length)return;
  shown+=links.length;

  const open=!state.collapsed.has(g.id);
  const meta='我方 '+g.ownCount+' · 竞品 '+g.compCount+(g.pausedCount?' · 已停用 '+g.pausedCount:'');
  html+='<tr class="px-group'+(open?'':' is-collapsed')+'" data-group="'+esc(g.id)+'">'
   +'<td colspan="7"><span class="px-caret">▾</span>'+esc(g.label)
   +(g.priority?' <span class="px-badge is-high">重点</span>':'')
   +'<small>'+meta+'</small></td></tr>';
  if(!open)return;

  // 我方排前面：判价的基准是我方价，先看到它再看竞品才有意义
  links.slice().sort((a,b)=>(a.side===b.side?0:(a.side==='own'?-1:1))||String(a.shop).localeCompare(String(b.shop))).forEach(l=>{
   // 刚导入的链接还没有标题和店铺（导入时不读京东页面，怕吃频控），这里如实说「待采集补齐」，
   // 不能显示成「—」，那样看起来像链接坏了
   const title=l.title||(l.shop&&l.shop!=='—'?l.shop:'')||'标题与店铺待第一次采集补齐';
   const listedNote=(l.listed!=null&&l.listed!==l.price)?'<br><small class="px-hint">标价 '+money(l.listed)+'</small>':'';
   html+='<tr data-link="'+esc(l.id)+'"'+(l.status!=='active'?' class="is-paused"':'')+'>'
    +'<td><span class="px-link-title" title="'+esc(title)+'">'+esc(title)+'</span>'
    +'<small class="px-hint"><em class="px-mv'+(l.side==='own'?' is-own':'')+'">'+(l.side==='own'?'我方':'竞品')+'</em>'+esc(l.reason||'')+'</small></td>'
    +'<td>'+esc(l.shop)+'</td>'
    +'<td class="px-num">'+(l.url?'<a class="px-sku" href="'+esc(l.url)+'" target="_blank" rel="noopener">'+esc(l.sku||'—')+'</a>':esc(l.sku||'—'))+'</td>'
    +'<td class="px-num">'+(l.price==null?'<span class="px-hint">—</span>':money(l.price))+listedNote+'</td>'
    +'<td class="px-num">'+esc(l.at)+'</td>'
    +'<td>'+linkStateBadge(l)+'</td>'
    +'<td><div class="px-row-actions">'
    +(l.url?'<a href="'+esc(l.url)+'" target="_blank" rel="noopener">打开</a>':'')
    +'<button type="button" data-act="status" data-id="'+esc(l.id)+'" data-status="'+(l.status==='active'?'paused':'active')+'">'+(l.status==='active'?'停用':'启用')+'</button>'
    +'<button type="button" data-act="remove" data-id="'+esc(l.id)+'" class="is-danger">删除</button>'
    +'</div></td>'
    +'</tr>';
  });
 });

 if(!shown){
  tb.innerHTML='<tr><td colspan="7" class="px-empty"><strong>没有符合条件的链接</strong><p>换个筛选条件，或清空搜索词。</p></td></tr>';
  updateLinkNums(0);
  return;
 }
 tb.innerHTML=html;
 updateLinkNums(shown);

 tb.querySelectorAll('tr[data-group]').forEach(tr=>{
  tr.addEventListener('click',()=>{
   const id=tr.dataset.group;
   if(state.collapsed.has(id))state.collapsed.delete(id);else state.collapsed.add(id);
   renderLinkList();
  });
 });
 tb.querySelectorAll('[data-act="status"]').forEach(b=>{
  b.addEventListener('click',async e=>{
   e.stopPropagation();
   b.disabled=true;
   try{
    await api('/api/price/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'status',id:b.dataset.id,status:b.dataset.status})});
    await loadLinks(true);
    toast(b.dataset.status==='paused'?'已停用，下一轮采集不再抓它。':'已启用，下一轮采集会重新抓。');
   }catch(err){toast(explain(err),'bad');b.disabled=false;}
  });
 });
 tb.querySelectorAll('[data-act="remove"]').forEach(b=>{
  b.addEventListener('click',async e=>{
   e.stopPropagation();
   const ok=window.confirm('删除这条链接？它的历史价格会一起删掉，不能恢复。\n\n如果只是暂时不采，点「停用」就够了。');
   if(!ok)return;
   b.disabled=true;
   try{
    await api('/api/price/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'remove',id:b.dataset.id})});
    await loadLinks(true);
    toast('已删除。');
   }catch(err){toast(explain(err),'bad');b.disabled=false;}
  });
 });
}

async function doImport(){
 const btn=$('btnImport'),hint=$('parseHint');
 if(state.mode==='demo'){hint.textContent='演示模式下不写库。';hint.className='px-hint is-bad';return;}
 const sel=$('linkModel').value;
 if(!targetReady()){
  hint.textContent=sel==='__new__'?'新建商品要填系列名。':'先选一个归属商品。';
  hint.className='px-hint is-bad';
  return;
 }
 const body={
  op:'import',
  urls:$('linkInput').value,
  side:$('linkSide').value,
  moveExisting:!!$('linkMove').checked
 };
 if(sel==='__new__'){
  body.brand=$('newBrand').value;
  body.series=String($('newSeries').value||'').trim();
  body.capacity=String($('newCap').value||'').trim();
 }else{
  body.modelId=sel;
 }
 btn.disabled=true;
 hint.textContent='正在写入…';
 hint.className='px-hint';
 try{
  const d=await api('/api/price/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const bits=['新增 '+(d.created||0)+' 条'];
  if(d.skipped)bits.push('已在监控 '+(d.skipped||0)+' 条');
  if(d.moved)bits.push('改挂 '+(d.moved||0)+' 条');
  if(d.invalid)bits.push('无效 '+(d.invalid||0)+' 条');
  if(d.dup)bits.push('批内重复 '+(d.dup||0)+' 条');
  let text='已入库：'+bits.join('，')+'。';
  if(d.failed&&d.failed.length){
   text+=' 未导入 '+(d.failed.length)+' 条：'+d.failed.slice(0,3).map(f=>f.sku+' '+f.reason).join('；')+(d.failed.length>3?'…':'');
  }
  hint.textContent=text;
  hint.className=(d.created||d.moved)?'px-hint is-ok':'px-hint is-bad';
  toast((d.created||d.moved)?('已导入 '+((d.created||0)+(d.moved||0))+' 条链接。'):'这批链接没有新增。',(d.created||d.moved)?'':'warn');
  // 导入成功后给一个「去查看」的出口：用户最想确认的就是「刚才那几条进去了没有」
  if((d.created||d.moved)&&$('btnGoList'))$('btnGoList').hidden=false;
  // 成功入库后清空粘贴框，免得同一批被贴第二遍
  if((d.created||d.moved)&&!(d.failed&&d.failed.length)){$('linkInput').value='';state.preview=null;$('previewTable').hidden=true;$('btnImport').textContent='确认导入';}
  await loadLinks(true);
  $('btnImport').disabled=true;
 }catch(e){
  hint.textContent=explain(e);
  hint.className='px-hint is-bad';
  btn.disabled=false;
 }
}

/* ---------------- 交互 ---------------- */
function toast(text,tone){
 let el=$('pxToast');
 if(!el){
  el=document.createElement('div');el.id='pxToast';
  el.style.cssText='position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:80;max-width:min(560px,calc(100% - 32px));padding:12px 18px;border-radius:10px;background:#172438;color:#fff;font-size:13px;line-height:1.6;box-shadow:0 14px 40px #0d1a2b33;opacity:0;transition:opacity .18s';
  document.body.append(el);
 }
 el.textContent=text;
 el.style.background=tone==='bad'?'#8f2318':(tone==='warn'?'#7a4a08':'#172438');
 el.style.opacity='1';
 clearTimeout(el._t);el._t=setTimeout(()=>{el.style.opacity='0';},4200);
}
function explain(error){
 const text=String((error&&error.message)||error||'').trim()||'未知错误';
 if(/接口不存在|旧代码/.test(text))return '比价接口还没上线，页面先按演示数据展示。';
 if(/401|未登录|过期/.test(text))return '登录状态已过期，请重新登录。';
 return text;
}
function currentData(){
 return {hits:state.hits,missing:state.missing,cover:state.cover};
}

function setTab(name){
 state.tab=name;
 document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.panel===name)));
 ['hits','missing','links','trend','config'].forEach(p=>{$('panel-'+p).hidden=p!==name;});
 if(name==='trend')renderTrend();
 if(name==='links'){
  if(state.ltab==='list')renderLinkList();
  loadLinks(true);
 }
}

/* 链接管理内的两个子页：导入 / 查看 */
function setLinkTab(name){
 state.ltab=name;
 document.querySelectorAll('#linkTabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.ltab===name)));
 $('ltab-import').hidden=name!=='import';
 $('ltab-list').hidden=name!=='list';
 if(name==='list'){
  if(state.linkView.groups&&state.linkView.groups.length)renderLinkList();
  else loadLinks(true);
 }
}

function exportCsv(){
 const rows=state.hits.filter(h=>(!state.filter.brand||h.brand===state.filter.brand)&&(!state.filter.status||h.status===state.filter.status));
 if(!rows.length){toast('当前没有可导出的记录。','warn');return;}
 const head=['品牌','系列','型号','匹数','我方到手价','我方标价','竞品到手价','竞品标价','价差','更低竞店家数','置信度','状态','首次发现'];
 const body=rows.map(h=>[
  h.brand==='gree'?'格力':'海尔',h.series,h.code,h.cap,h.my,h.myListed,h.comp,h.compListed,h.my-h.comp,h.lowerCount,
  {high:'高',medium:'中',low:'低'}[h.confidence]||'',{open:'待处理',ignored:'已忽略',recovered:'已回升'}[h.status]||'',h.firstSeen
 ]);
 const csv=[head,...body].map(r=>r.map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
 const a=document.createElement('a');
 const d=new Date();const stamp=d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
 a.href=URL.createObjectURL(blob);a.download='比价助手-'+stamp+'.csv';
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

/* ---------------- 启动 ---------------- */
try{
 const identity=await session.getIdentity();
 WorkbenchShell.mountShell({
  container:$('shell'),
  activeModule:'price',
  identity,
  onLogout:async()=>{await session.logout();location.replace('/login.html');}
 });

 /* 数据：先试接口，404 则进演示模式 */
 let data=null;
 try{
  data=await api('/api/price/overview');
 }catch(error){
  if(!isMissingApi(error))throw error;
 }
 if(!data){
  data=demoData();state.mode='demo';
  $('pxNotice').hidden=false;
  $('pxNoticeTitle').textContent='当前为演示数据';
  $('pxNoticeText').textContent='比价接口还没上线（P0 开发中）。下面的机型、价格、缺失记录都是示例，用来先确认页面结构对不对；接口接通后这里会自动换成真实抓取结果。';
 }
 state.hits=data.hits||[];
 state.missing=data.missing||[];
 state.cover=data.cover||{};
 state.links=data.links||[];
 if(data.config)fillConfig(data.config);
 renderStatus(data.status||{});
 renderKpis(data);
 renderHits();
 renderMissing();
 if(state.hits.length)renderTrend();
 // 链接清单单独拉一次：它是「我到底在监控哪些链接」的唯一来源，随时要能打开，
 // 所以不等到点开那个 tab 才请求。
 fillModelSelect();   // 先把下拉填成「新建商品…」，接口慢或不可用时也能正常解析
 loadLinks(true);

 /* tabs */
 document.querySelectorAll('#tabs button').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.panel)));

 /* 筛选 */
 $('filterBrand').onchange=e=>{state.filter.brand=e.target.value;renderHits();};
 $('filterStatus').onchange=e=>{state.filter.status=e.target.value;renderHits();};

 /* 抽屉 */
 $('drawerClose').onclick=closeDrawer;
 $('drawerMask').onclick=closeDrawer;
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('drawer').hidden)closeDrawer();});

 /* 趋势切换 */
 $('trendSelect').onchange=renderTrend;

 /* 链接解析 / 导入 */
 $('btnParse').onclick=()=>renderPreview(buildPreview($('linkInput').value));
 $('btnImport').onclick=doImport;
 $('btnClearLinks').onclick=()=>{
  $('linkInput').value='';
  $('previewTable').hidden=true;
  state.preview=null;
  $('btnImport').disabled=true;
  $('btnImport').textContent='确认导入';
  $('btnGoList').hidden=true;
  $('parseHint').textContent='';
 };
 $('btnGoList').onclick=()=>{
  $('btnGoList').hidden=true;
  setLinkTab('list');
 };
 $('linkModel').onchange=()=>{state.modelTouched=true;syncModelFields();};
 ['newSeries','newCap'].forEach(id=>{$(id).addEventListener('input',()=>{
  if(state.preview)renderPreview(state.preview);
 });});

 /* 链接管理子页 */
 document.querySelectorAll('#linkTabs button').forEach(b=>b.addEventListener('click',()=>setLinkTab(b.dataset.ltab)));

 /* 查看链接的筛选 */
 $('linkSearch').addEventListener('input',e=>{state.linkFilter.q=e.target.value;renderLinkList();});
 $('linkBrand').onchange=e=>{state.linkFilter.brand=e.target.value;renderLinkList();};
 $('linkSideFilter').onchange=e=>{state.linkFilter.side=e.target.value;renderLinkList();};
 $('linkStateFilter').onchange=e=>{state.linkFilter.state=e.target.value;renderLinkList();};

 /* 导出 */
 $('btnExport').onclick=exportCsv;

 /* 刷新 */
 $('btnRefresh').onclick=async()=>{
  if(state.mode==='demo'){toast('演示模式刷新只是重新渲染，接口上线后会重新拉取。','warn');return;}
  $('btnRefresh').disabled=true;
  try{
   const fresh=await api('/api/price/overview');
   state.hits=fresh.hits||[];state.missing=fresh.missing||[];state.cover=fresh.cover||{};
   renderStatus(fresh.status||{});renderKpis({hits:state.hits,missing:state.missing,cover:state.cover});
   renderHits();renderMissing();renderTrend();toast('已刷新。');
  }catch(e){toast(explain(e),'bad');}
  finally{$('btnRefresh').disabled=false;}
 };

 /* 设置 */
 $('btnRunNow').onclick=async()=>{
  const btn=$('btnRunNow'),hint=$('runHint');
  if(state.mode==='demo'){hint.textContent='演示模式不跑采集；接口上线后这里会真的起一轮。';hint.className='px-hint is-bad';return;}
  btn.disabled=true;hint.textContent='正在启动采集…';hint.className='px-hint';
  try{
   const r=await api('/api/price/run-now',{method:'POST'});
   const d=(r&&r.data)||r||{};
   if(d.started){
    hint.textContent='已开始采集（'+new Date().toTimeString().slice(0,5)+'）。每 12–22 秒一条，采完点右上角刷新看结果；手动这轮不发企微。';
    hint.className='px-hint is-ok';
   }else{
    hint.textContent=d.skip||'没有启动（可能刚跑过）。';
    hint.className='px-hint is-bad';
   }
  }catch(e){hint.textContent=explain(e);hint.className='px-hint is-bad';}
  finally{setTimeout(()=>{btn.disabled=false;},3000);}
 };

 $('btnSaveCfg').onclick=()=>{
  if(state.mode==='demo'){$('cfgHint').textContent='演示模式不保存；接口上线后这里会真正写入并立即影响判价。';$('cfgHint').className='px-hint is-bad';return;}
  const payload={amount:Number($('cfgAmount').value),rate:Number($('cfgRate').value)/100,full:$('cfgFull').value,focus:$('cfgFocus').value,notify:$('cfgNotify').value,subsidyRate:Number($('cfgSubsidyRate').value),subsidyCap:Number($('cfgSubsidyCap').value)};
  api('/api/price/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
   .then(()=>{$('cfgHint').textContent='已保存，下一轮采集按新阈值判价。';$('cfgHint').className='px-hint is-ok';})
   .catch(e=>{$('cfgHint').textContent=explain(e);$('cfgHint').className='px-hint is-bad';});
 };
}catch(error){
 if(error&&error.code==='SESSION_EXPIRED'){location.replace('/login.html?returnTo=%2Fprice.html');}
 else{
  const main=document.querySelector('.px-main');
  if(main)main.innerHTML='<div class="workbench-error">页面加载失败：'+String(error&&error.message||error)+'</div>';
 }
}
})();
