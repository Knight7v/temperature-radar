(function(root){
 root.InventoryFollowups={async load(session,date,writable,rows){
  const response=await session.authorizedFetch('/api/inventory/followups?date='+encodeURIComponent(date));
  const payload=await response.json();if(!response.ok)throw Error(payload.error||'处理记录读取失败');
  const saved=new Map(payload.data.map(r=>[r.key,r]));
  const key=r=>JSON.stringify([r.warehouse,r.kind,r.entityId]);
  return {
   cell(row){
    const cell=document.createElement('td'),select=document.createElement('select'),note=document.createElement('input'),button=document.createElement('button'),message=document.createElement('small');
    ['待处理','处理中','已处理'].forEach(v=>select.append(new Option(v,v)));
    const existing=saved.get(key(row));select.value=existing?.status||'待处理';note.value=existing?.note||'';note.placeholder='处理备注（已处理时必填）';note.maxLength=500;
    select.setAttribute('aria-label','处理状态');note.setAttribute('aria-label','处理备注');button.textContent='保存';select.disabled=note.disabled=button.disabled=!writable;
    if(existing)message.textContent='更新于 '+new Date(existing.updatedAt).toLocaleString('zh-CN');
    button.onclick=async()=>{button.disabled=true;try{const r=await session.authorizedFetch('/api/inventory/followups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,warehouse:row.warehouse,kind:row.kind,entityId:row.entityId,status:select.value,note:note.value})});const d=await r.json();if(!r.ok)throw Error(d.error||'保存失败');saved.set(key(row),d.data);message.textContent='已保存 '+new Date(d.data.updatedAt).toLocaleString('zh-CN');}catch(e){message.textContent=e.message;}finally{button.disabled=!writable;}};
    cell.append(select,note,button,document.createElement('br'),message);return cell;
   },
   download(){
    const data=[['日期','仓库','商品','业务预警','数据异常','处理状态','处理备注','最后处理时间'],...rows.filter(r=>(r.businessAlerts||[]).length||(r.issues||[]).length).map(r=>{const state=saved.get(key(r));return [date,r.warehouse,r.name||r.entityId,(r.businessAlerts||[]).join('、'),(r.issues||[]).join('、'),state?.status||'待处理',state?.note||'',state?.updatedAt||''];})];
    const quote=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    const url=URL.createObjectURL(new Blob(['\uFEFF'+data.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='库存处理清单-'+date+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }
  };
 }};
})(globalThis);
