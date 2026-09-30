(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkbenchShell=api;})(globalThis,function(){
 const MODULES=[{id:'weather',title:'气温监控预警',description:'关注温度变化，捕捉区域销售机会。',href:'/index-v2.html',status:'active',mark:'气'}, {id:'inventory',title:'库存监控预警',description:'汇聚分仓库存，识别缺货、缺配与积压。',href:'/inventory.html',status:'active',mark:'库'}, {id:'quality',title:'客服质检',description:'会话质检与服务改进，即将接入工作台。',href:'/workbench.html#quality',status:'planned',mark:'质'}, {id:'design',title:'视觉设计',description:'AI 生图与生视频，打造团队的创意空间。',href:'/workbench.html#design',status:'planned',mark:'创'}];
 function mountShell({container,activeModule,identity,onLogout}){
  container.classList.add('workbench-shell');
  const nav=document.createElement('aside');nav.className='workbench-nav';nav.id='workbenchNavigation';
  const logo=document.createElement('a');logo.href='/workbench.html';logo.className='workbench-brand';logo.textContent='◈  公司工作台';nav.append(logo);
  const cap=document.createElement('p');cap.className='workbench-nav-label';cap.textContent='业务空间';nav.append(cap);
  [{id:'home',title:'工作台首页',href:'/workbench.html'},...MODULES].forEach(m=>{const a=document.createElement('a');a.href=m.href;a.textContent=m.title+(m.status==='planned'?' · 规划中':'');a.dataset.module=m.id;if(m.id===activeModule)a.setAttribute('aria-current','page');nav.append(a);});
  const foot=document.createElement('div');foot.className='workbench-nav-foot';foot.textContent=identity?.tenant?.name||'统一业务工作空间';nav.append(foot);
  const top=document.createElement('header');top.className='workbench-topbar';const menu=document.createElement('button');menu.type='button';menu.className='workbench-menu';menu.textContent='☰';menu.setAttribute('aria-label','打开导航');menu.setAttribute('aria-controls',nav.id);menu.setAttribute('aria-expanded','false');
  const name=document.createElement('span');name.textContent=identity?.tenant?.name||'工作台';const account=document.createElement('span');account.className='workbench-account';account.textContent=identity?.user?identity.user.identifier+' · '+({admin:'管理员',operator:'运营／仓管',viewer:'查看用户'}[identity.user.role]||'用户'):'气温监控';
  top.append(menu,name,account);if(onLogout){const b=document.createElement('button');b.textContent='退出';b.addEventListener('click',onLogout);top.append(b);}
  const toggle=(open)=>{nav.classList.toggle('is-open',open);menu.setAttribute('aria-expanded',String(open));};const key=e=>{if(e.key==='Escape'){toggle(false);menu.focus();}};menu.addEventListener('click',()=>toggle(menu.getAttribute('aria-expanded')!=='true'));document.addEventListener('keydown',key);container.prepend(nav,top);
  return {destroy(){document.removeEventListener('keydown',key);nav.remove();top.remove();}};
 }
 return {MODULES,mountShell};
});
