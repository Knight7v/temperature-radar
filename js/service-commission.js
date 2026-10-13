(async function(){
 const session=WorkbenchSession.createSessionClient(),status=document.getElementById('status');
 try{
  const identity=await session.getIdentity();
  WorkbenchShell.mountShell({container:document.getElementById('shell'),activeModule:'service-commission',identity,onLogout:async()=>{await session.logout();location.replace('/login.html');}});
  status.hidden=true;document.getElementById('commissionContent').hidden=false;
 }catch(error){
  if(error.code==='SESSION_EXPIRED')location.replace('/login.html?returnTo='+encodeURIComponent(location.pathname));
  else{status.className='workbench-error';status.textContent=error.message+'，请刷新重试。';}
 }
})();
