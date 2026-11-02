/* Excel/WPS 风格的多选筛选面板（2026-11-02）
 * 用法：给 <select> 加 data-multi 属性，本组件自动接管：
 *  - 下拉变成「复选面板」：搜索 + 全选 / 反选 / 清空 + 复选框列表
 *  - 未勾或全勾 = 全部（select.value=''，不传筛选参数）
 *  - 勾了部分 = select.value 为逗号分隔多值（后端按逗号拆分匹配）
 *  - change 事件在面板关闭时统一触发一次，页面原有的 change 监听无需改动
 *  - 外部代码设置 select.value（深链、保存的视图）会自动同步面板显示
 */
(function(){
 'use strict';
 if(window.__fmLoaded)return;window.__fmLoaded=true;
 var CSS='#fm-pop,.fm-pop{position:absolute;z-index:9999;background:#fff;border:1px solid #cfd8e4;border-radius:12px;box-shadow:0 12px 32px rgba(23,43,77,.18);padding:9px;display:none;flex-direction:column;gap:7px;font-family:inherit;font-size:13px;line-height:1.45}'
 +'.fm-search{box-sizing:border-box;width:100%;border:1px solid #d8e1ef;border-radius:8px;padding:6px 9px;font-size:12.5px;outline:none}'
 +'.fm-search:focus{border-color:#2563eb}'
 +'.fm-ops{display:flex;gap:6px}'
 +'.fm-op{flex:1;border:1px solid #d8e1ef;background:#f6f8fc;border-radius:7px;padding:4px 0;font-size:12px;color:#33415c;cursor:pointer;font-weight:600}'
 +'.fm-op:hover{background:#eef2f9}'
 +'.fm-list{max-height:236px;overflow:auto;display:flex;flex-direction:column}'
 +'.fm-item{display:flex;align-items:center;gap:7px;padding:5px 6px;border-radius:7px;cursor:pointer;user-select:none;color:#20314b;white-space:nowrap}'
 +'.fm-item:hover{background:#f2f6fd}'
 +'.fm-item input{width:14px;height:14px;accent-color:#16a37b;cursor:pointer;flex:none}'
 +'.fm-count{color:#8494ad;font-size:11px;text-align:right;padding:0 2px}'
 +'.fm-empty{color:#8494ad;font-size:12px;padding:8px 6px;text-align:center}'
 +'.fm-btn{cursor:pointer;text-align:left;position:relative;padding-right:26px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
 +'.fm-btn:after{content:"";position:absolute;right:10px;top:50%;width:7px;height:7px;border-right:1.6px solid #8494ad;border-bottom:1.6px solid #8494ad;transform:translateY(-70%) rotate(45deg);pointer-events:none}'
 +'.fm-btn.fm-active{border-color:#16a37b!important;background:#f0faf6!important;color:#0d7d5f!important}';
 function injectCssOnce(){if(!document.getElementById('fm-style')){var s=document.createElement('style');s.id='fm-style';s.textContent=CSS;document.head.appendChild(s);}}
 function copyStyle(from,to){
  var cs=getComputedStyle(from);
  ['width','minHeight','height','fontSize','fontWeight','fontFamily','border','borderRadius','padding','color','backgroundColor','lineHeight'].forEach(function(k){
   try{to.style[k]=cs[k];}catch(e){}
  });
  to.style.boxSizing='border-box';
 }
 function attach(select){
  if(select.dataset.fmReady)return;select.dataset.fmReady='1';
  injectCssOnce();
  var registry=window.__fmRegistry||(window.__fmRegistry=[]); /* 全部实例：开新面板前先关旧面板 */
  var btn=document.createElement('button');
  btn.type='button';btn.className='fm-btn';btn.setAttribute('aria-haspopup','listbox');
  copyStyle(select,btn);
  select.parentNode.insertBefore(btn,select);
  select.style.display='none';
  /* 初始不可见（如父级 hidden）时拷到的尺寸不可信：可见后重新拷一次 */
  if(select.offsetParent===null){
   var timer=setInterval(function(){
    if(select.offsetParent!==null){copyStyle(select,btn);clearInterval(timer);}
   },300);
   setTimeout(function(){clearInterval(timer);},30000);
  }
  /* 面板 */
  var pop=document.createElement('div');pop.className='fm-pop';
  pop.innerHTML='<input class="fm-search" type="search" placeholder="搜索…">'
   +'<div class="fm-ops"><button type="button" class="fm-op" data-op="all">全选</button>'
   +'<button type="button" class="fm-op" data-op="invert">反选</button>'
   +'<button type="button" class="fm-op" data-op="clear">清空</button></div>'
   +'<div class="fm-list" role="listbox" aria-multiselectable="true"></div>'
   +'<div class="fm-count"></div>';
  document.body.appendChild(pop);
  /* 面板字号与来源下拉一致（如「店铺状态」），避免比页面正文大一号 */
  pop.style.fontSize=getComputedStyle(select).fontSize;
  var search=pop.querySelector('.fm-search'),list=pop.querySelector('.fm-list'),count=pop.querySelector('.fm-count');
  var selected={},open=false,baseline=null; /* selected: 值->true */
  function allOptionText(){
   var first=select.options[0];
   return first&&first.value===''?first.textContent:'全部';
  }
  function options(){return Array.prototype.filter.call(select.options,function(o){return o.value!=='';});}
  function parseValue(){selected={};String(select.value||'').split(',').forEach(function(v){v=v.trim();if(v)selected[v]=true;});}
  function toValue(set){
   var keys=Object.keys(set).filter(function(k){return set[k];});
   var opts=options();
   if(!keys.length||keys.length>=opts.length)return ''; /* 全勾 = 全部 */
   return keys.join(',');
  }
  function writeValue(dispatch){
   var v=toValue(selected);
   if(v!==select.value){select.value=v;if(dispatch)fireChange();}
   refreshBtn();
  }
  function fireChange(){select.dispatchEvent(new Event('change',{bubbles:true}));}
  function refreshBtn(){
   var keys=Object.keys(selected).filter(function(k){return selected[k];});
   var opts=options();
   var text,label;
   if(!keys.length||keys.length>=opts.length){text=allOptionText();btn.classList.remove('fm-active');}
   else{
    btn.classList.add('fm-active');
    if(keys.length===1){
     var o=opts.filter(function(x){return x.value===keys[0];})[0];
     text=o?o.textContent:keys[0];
    }else text='已选 '+keys.length+' 项';
   }
   btn.textContent=text;
  }
  function rebuild(){
   parseValue();
   renderList();
   refreshBtn();
  }
  function renderList(){
   var kw=(search.value||'').trim().toLowerCase();
   var opts=options();
   list.replaceChildren();
   var shown=0;
   opts.forEach(function(o){
    if(kw&&o.textContent.toLowerCase().indexOf(kw)===-1)return;
    shown++;
    var lab=document.createElement('label');lab.className='fm-item';
    var cb=document.createElement('input');cb.type='checkbox';cb.value=o.value;cb.checked=!!selected[o.value];
    cb.onchange=function(){selected[o.value]=cb.checked;writeValue(false);renderCount();};
    lab.append(cb,document.createTextNode(o.textContent));
    list.append(lab);
   });
   if(!shown){var d=document.createElement('div');d.className='fm-empty';d.textContent='没有匹配的选项';list.append(d);}
   renderCount();
  }
  function renderCount(){
   var keys=Object.keys(selected).filter(function(k){return selected[k];});
   var total=options().length;
   count.textContent=keys.length?('已勾选 '+Math.min(keys.length,total)+' / '+total+' 项 · 关闭面板后生效'):'点击空白处关闭并生效';
  }
  function positionPop(){
   if(!open)return;
   var r=btn.getBoundingClientRect();
   var top=r.bottom+6,left=r.left;
   var ph=pop.offsetHeight||300;
   if(top+ph>window.innerHeight-8)top=Math.max(8,r.top-ph-6<8?8:r.top-ph-6);
   if(left+pop.offsetWidth>window.innerWidth-8)left=Math.max(8,window.innerWidth-pop.offsetWidth-8);
   pop.style.top=top+'px';pop.style.left=left+'px';
  }
  function openPop(){
   if(open)return;
   registry.forEach(function(o){if(o!==self)o.close(false);}); /* 同页只允许开一个面板 */
   open=true;baseline=Object.assign({},selected);
   parseValue();renderList();
   pop.style.display='flex';
   pop.style.minWidth=Math.max(btn.getBoundingClientRect().width,208)+'px';
   search.value='';renderList();
   positionPop();
   setTimeout(function(){search.focus();},0);
  }
  function closePop(apply){
   if(!open)return;open=false;pop.style.display='none';
   if(apply!==false&&baseline){
    var before=toValue(baseline),after=toValue(selected);
    if(before!==after)fireChange();
   }
   baseline=null;
  }
  var self={close:closePop}; /* 供其他实例关闭本面板 */
  registry.push(self);
  btn.onclick=function(e){e.stopPropagation();open?closePop():openPop();};
  pop.addEventListener('click',function(e){e.stopPropagation();});
  document.addEventListener('click',function(){closePop();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&open){closePop(false);}});
  /* 滚动：面板内部列表滚动不关闭；页面其他地方滚动时面板跟随按钮重新定位 */
  window.addEventListener('scroll',function(e){
   if(!open)return;
   if(pop.contains(e.target)||e.target===btn)return;
   positionPop();
  },true);
  window.addEventListener('resize',positionPop);
  search.oninput=renderList;
  pop.querySelector('.fm-ops').onclick=function(e){
   var op=e.target.getAttribute('data-op');if(!op)return;
   var kw=(search.value||'').trim().toLowerCase();
   var targets=options().filter(function(o){return !kw||o.textContent.toLowerCase().indexOf(kw)!==-1;});
   if(op==='all'){targets.forEach(function(o){selected[o.value]=true;});}
   else if(op==='invert'){targets.forEach(function(o){selected[o.value]=!selected[o.value];});}
   else{selected={};}
   writeValue(false);renderList();
  };
  /* options 变化（店铺列表重填等）→ 重建面板 */
  new MutationObserver(function(){rebuild();}).observe(select,{childList:true});
  /* value 虚拟化：原生 select.value 只能等于某个选项值，写「a,b」组合会被浏览器丢弃
     （存量 bug：面板显示对、但查询参数一直是空）。改为内存值兜底，读写全走虚拟 value。 */
  var protoDesc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
  var current=protoDesc?String(protoDesc.get.call(select)||''):'';
  Object.defineProperty(select,'value',{
   get:function(){return current;},
   set:function(v){current=String(v==null?'':v);parseValue();refreshBtn();if(open)renderList();}
  });
  rebuild();
 }
 function auto(){
  document.querySelectorAll('select[data-multi]').forEach(function(s){
   if(s.dataset.fmReady)return;
   /* 等 options 至少就位（动态填充的 select 也会被 MutationObserver 兜住） */
   attach(s);
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',auto);
 else auto();
 window.FilterMulti={attach:attach,auto:auto};
})();
