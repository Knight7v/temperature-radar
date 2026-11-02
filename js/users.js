/* 用户与权限页（视觉升级 v1：头像 + 主副两行 + 徽章；行为与旧版一致） */
(async()=>{
  const s=WorkbenchSession.createSessionClient(),q=id=>document.getElementById(id),msg=q('msg');
  let me;
  try{
    me=await s.getIdentity();
    if(me.user.role!=='admin')throw Error('仅管理员可访问');
    WorkbenchShell.mountShell({container:q('shell'),activeModule:'users',identity:me,onLogout:async()=>{await s.logout();location='/login.html';}});
  }catch(e){msg.textContent=e.message;return;}

  const meId=me.user.id,byId={};
  const labels={admin:'管理员',operator:'运营',supply_chain:'供应链',viewer:'查看用户'};
  const badgeCls={admin:'u-bg-admin',operator:'u-bg-operator',supply_chain:'u-bg-supply',viewer:'u-bg-viewer'};
  const avatarBg={admin:'#7c3aed',operator:'#2563eb',supply_chain:'#0d9488',viewer:'#94a3b8'};

  function relTime(iso){
    const d=new Date(iso);
    if(isNaN(d))return '';
    const sec=(Date.now()-d.getTime())/1000;
    if(sec<60)return '刚刚';
    if(sec<3600)return Math.floor(sec/60)+' 分钟前';
    if(sec<86400)return Math.floor(sec/3600)+' 小时前';
    const days=Math.floor(sec/86400);
    if(days<30)return days+' 天前';
    const months=Math.floor(days/30);
    if(months<12)return months+' 个月前';
    return Math.floor(months/12)+' 年前';
  }
  function dateOnly(iso){
    try{return new Date(iso).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});}
    catch{return String(iso||'');}
  }

  async function load(){
    const r=await s.authorizedFetch('/api/auth/users');
    const d=await r.json();
    if(!r.ok)throw Error(d.error||'加载失败');
    q('rows').innerHTML='';
    d.data.forEach(u=>{
      byId[u.id]=u;
      const name=(u.displayName||'').trim();
      const initial=(name||u.identifier||'?').slice(0,1).toUpperCase();
      const active=u.status==='active';
      const tr=document.createElement('tr');
      tr.innerHTML=
        '<td><div class="u-who">'+
          '<span class="u-avatar" style="background:'+(avatarBg[u.role]||'#94a3b8')+'">'+initial+'</span>'+
          '<div><div class="u-name"><input data-id="'+u.id+'" class="uname" value="'+(name).replace(/"/g,'&quot;')+'" placeholder="未填写" aria-label="姓名"></div>'+
          '<div class="u-acc">'+u.identifier+'</div></div>'+
        '</div></td>'+
        '<td><select data-id="'+u.id+'" class="role"><option value="admin">管理员</option><option value="operator">运营</option><option value="supply_chain">供应链</option><option value="viewer">查看用户</option></select></td>'+
        '<td><button data-id="'+u.id+'" data-status="'+u.status+'" class="u-status" title="点击'+(active?'停用':'启用')+'">'+
          '<span class="u-badge '+(active?'u-bg-on':'u-bg-off')+'"><span class="u-dot"></span>'+(active?'启用':'停用')+'</span></button></td>'+
        '<td class="u-date"><b>'+dateOnly(u.createdAt)+'</b>'+relTime(u.createdAt)+'</td>'+
        '<td class="u-actions-cell"><button type="button" class="u-rowbtn" data-act="edit" data-id="'+u.id+'">编辑</button>'+(u.id===meId?'':'<button type="button" class="u-rowbtn danger" data-act="del" data-id="'+u.id+'">删除</button>')+'</td>';
      tr.querySelector('.role').value=u.role;
      q('rows').append(tr);
    });
    q('rows').querySelectorAll('.role').forEach(x=>x.onchange=()=>update({id:x.dataset.id,role:x.value}));
    q('rows').querySelectorAll('.uname').forEach(x=>x.onchange=()=>{x.value=x.value.trim();update({id:x.dataset.id,displayName:x.value});});
    q('rows').querySelectorAll('.u-status').forEach(x=>x.onclick=()=>update({id:x.dataset.id,status:x.dataset.status==='active'?'disabled':'active'}));
    q('rows').querySelectorAll('[data-act=edit]').forEach(x=>x.onclick=()=>openEdit(byId[x.dataset.id]));
    q('rows').querySelectorAll('[data-act=del]').forEach(x=>x.onclick=()=>delUser(byId[x.dataset.id]));
  }

  async function update(body){
    const r=await s.authorizedFetch('/api/auth/users',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok){const d=await r.json();msg.textContent=d.error||'保存失败';return;}
    load();
  }

  /* ---- 编辑 / 删除（2026-10-30：操作列） ---- */
  async function delUser(u){
    if(!u)return;
    const label=u.displayName||u.identifier;
    if(!confirm('确定删除账号「'+label+'」吗？删除后该账号将无法登录，操作会记入「操作日志」。'))return;
    const r=await s.authorizedFetch('/api/auth/users?id='+encodeURIComponent(u.id),{method:'DELETE'});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){msg.textContent=d.error||'删除失败';return;}
    msg.textContent='账号「'+label+'」已删除';
    load();
  }

  /* ---- 创建用户弹窗 ---- */
  const modal=q('createModal'),scrim=q('createScrim'),form=q('create'),errBox=q('createErr');
  function openCreate(){
    if(window.showUsersTab)window.showUsersTab('users');
    form.reset();errBox.hidden=true;errBox.textContent='';
    resetCreateMode();
    form.querySelectorAll('input[name=password],input[name=password2]').forEach(i=>{i.type='password';});
    form.querySelectorAll('.u-eye').forEach(b=>{b.classList.remove('on');b.setAttribute('aria-pressed','false');});
    modal.hidden=false;scrim.hidden=false;
    setTimeout(()=>form.querySelector('input[name=displayName]').focus(),30);
  }
  function closeCreate(){modal.hidden=true;scrim.hidden=true;}
  let editId=null;
  function resetCreateMode(){
    editId=null;
    form.identifier.disabled=false;
    form.password.required=true;form.password2.required=true;
    q('pwLabel').firstChild.textContent='初始密码';
    q('pw2Label').firstChild.textContent='再次输入密码';
    q('createTitle').textContent='创建用户';
    q('createDesc').textContent='填写基本信息，保存后立即生效，并记入「操作日志」。';
    q('createSave').textContent='保存并添加';
  }
  function openEdit(u){
    if(!u)return;
    if(window.showUsersTab)window.showUsersTab('users');
    form.reset();errBox.hidden=true;errBox.textContent='';
    resetCreateMode();
    editId=u.id;
    form.displayName.value=u.displayName||'';
    form.identifier.value=u.identifier;
    form.identifier.disabled=true;
    form.password.required=false;form.password2.required=false;
    q('pwLabel').firstChild.textContent='重置密码（留空则不修改）';
    q('pw2Label').firstChild.textContent='再次输入新密码';
    form.role.value=u.role;
    q('createTitle').textContent='编辑用户';
    q('createDesc').textContent='修改姓名、角色或重置密码；改动会记入「操作日志」。';
    q('createSave').textContent='保存修改';
    modal.hidden=false;scrim.hidden=false;
    setTimeout(()=>form.querySelector('input[name=displayName]').focus(),30);
  }
  q('goCreate').onclick=openCreate;
  q('createX').onclick=closeCreate;
  q('createCancel').onclick=closeCreate;
  scrim.onclick=closeCreate;
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)closeCreate();});
  /* 👁️ 显示/隐藏密码（两个密码框、两个按钮全联动，按当前实际状态切换） */
  form.querySelectorAll('.u-eye').forEach(btn=>btn.onclick=()=>{
    const show=form.querySelector('input[name=password]').type==='password';
    form.querySelectorAll('input[name=password],input[name=password2]').forEach(i=>{i.type=show?'text':'password';});
    form.querySelectorAll('.u-eye').forEach(b=>{b.classList.toggle('on',show);b.setAttribute('aria-pressed',show?'true':'false');});
  });

  form.onsubmit=async e=>{
    e.preventDefault();
    if(!form.reportValidity())return;
    if(form.password.value!==form.password2.value){errBox.textContent='两次输入的密码不一致，请检查';errBox.hidden=false;form.password2.focus();return;}
    errBox.hidden=true;
    if(editId){
      const body={id:editId,displayName:form.displayName.value.trim(),role:form.role.value};
      if(form.password.value)body.password=form.password.value;
      const ebtn=q('createSave');ebtn.disabled=true;ebtn.textContent='保存中…';
      try{
        const r=await s.authorizedFetch('/api/auth/users',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
        const d=await r.json();
        if(!r.ok){errBox.textContent=d.error||'保存失败';errBox.hidden=false;return;}
        msg.textContent='用户「'+(form.displayName.value.trim()||(byId[editId]||{}).identifier||'')+'」已更新';
        closeCreate();load();
      }catch(err){errBox.textContent=err.message||'网络异常，请重试';errBox.hidden=false;}
      finally{ebtn.disabled=false;ebtn.textContent='保存修改';}
      return;
    }
    const payload=Object.fromEntries(new FormData(form));delete payload.password2;
    const btn=q('createSave');btn.disabled=true;btn.textContent='保存中…';
    try{
      const r=await s.authorizedFetch('/api/auth/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const d=await r.json();
      if(!r.ok){errBox.textContent=d.error||'创建失败';errBox.hidden=false;return;}
      msg.textContent='用户「'+(form.displayName.value.trim()||form.identifier.value.trim())+'」已创建';
      closeCreate();load();
    }catch(err){errBox.textContent=err.message||'网络异常，请重试';errBox.hidden=false;}
    finally{btn.disabled=false;btn.textContent='保存并添加';}
  };
  load();
})();
