/* 全局 Toast（P1-1）：右上角轻提示，自动消失，成功绿 / 失败红 / 提示蓝。
 * 用法：WBToast.show('导入完成', 'ok')；type: ok | err | info（默认 ok）
 * 样式本文件注入，不碰共享 CSS。任何页面引了本文件即可用，未挂载时 show 会自动补挂。
 */
(function (root) {
  'use strict';
  const CSS = `
.wb-toast-wrap{position:fixed;top:60px;right:20px;z-index:300;display:flex;flex-direction:column;gap:10px;pointer-events:none}
.wb-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:8px;max-width:360px;padding:10px 14px;border-radius:10px;background:#fff;border:1px solid #e3e9f2;box-shadow:0 10px 30px #17233a24;font-size:13px;color:#17233a;line-height:1.5;opacity:0;transform:translateY(-6px);transition:opacity .18s,transform .18s;word-break:break-all}
.wb-toast.is-in{opacity:1;transform:translateY(0)}
.wb-toast-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0}
.wb-toast.ok .wb-toast-dot{background:#1f9d61}.wb-toast.ok{border-color:#cdeeda}
.wb-toast.err .wb-toast-dot{background:#d5443c}.wb-toast.err{border-color:#f3cfcc}
.wb-toast.info .wb-toast-dot{background:#2563eb}.wb-toast.info{border-color:#d3e0fb}
@media (max-width:760px){.wb-toast-wrap{left:16px;right:16px;top:auto;bottom:calc(16px + env(safe-area-inset-bottom));flex-direction:column-reverse}.wb-toast{max-width:none}}
`;
  let wrap = null;
  function mount() {
    if (wrap && document.body.contains(wrap)) return wrap;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    wrap = document.createElement('div');
    wrap.className = 'wb-toast-wrap';
    document.body.append(wrap);
    return wrap;
  }
  function show(msg, type) {
    const box = mount();
    const el = document.createElement('div');
    el.className = 'wb-toast ' + (type === 'err' ? 'err' : type === 'info' ? 'info' : 'ok');
    el.setAttribute('role', 'status');
    const dot = document.createElement('span'); dot.className = 'wb-toast-dot'; el.append(dot);
    el.append(String(msg == null ? '' : msg));
    box.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 220);
    }, 3200);
    /* 同时最多 4 条，超出挤掉最旧的 */
    while (box.children.length > 4) box.firstElementChild.remove();
  }
  root.WBToast = { show };
})(window);
