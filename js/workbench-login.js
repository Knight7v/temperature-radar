'use strict';
const session=WorkbenchSession.createSessionClient();
const form=document.getElementById('loginForm'),message=document.getElementById('loginMessage');
form.addEventListener('submit',async(event)=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;message.textContent='正在登录…';try{await session.login(Object.fromEntries(new FormData(form)));location.replace(WorkbenchSession.safeReturnTo(new URLSearchParams(location.search).get('returnTo')));}catch(error){message.textContent=error.message||'暂时无法登录，请重试';}finally{button.disabled=false;}});
