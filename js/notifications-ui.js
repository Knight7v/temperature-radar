/* 站内信/通知中心（P1）：
 * 顶栏铃铛 → 下拉面板显示当前待办（缺数据 / 推送失败 / 质检待复核）。
 * 通知是服务端实时算的，这里只负责展示 + 已读。
 * 页面里如果有 #tasksBox（用户与权限页），顺带渲染「定时任务」看板。
 * 样式走本文件注入，不碰共享 CSS，免得全站刷版本号。
 */
(function () {
  'use strict';
  const Session = window.WorkbenchSession ? window.WorkbenchSession.createSessionClient() : null;
  if (!Session) return;

  const CSS = `
.wb-ntf{position:relative}
.wb-ntf-btn{position:relative;border:1px solid #e3e9f2;background:#fff;border-radius:8px;width:32px;height:32px;font-size:15px;cursor:pointer;color:#5b6b84;display:flex;align-items:center;justify-content:center;padding:0}
.wb-ntf-btn:hover{border-color:#c6d2e3;background:#f7fafd}
.wb-ntf-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;border-radius:8px;background:#e05252;color:#fff;font-size:10px;line-height:16px;text-align:center;padding:0 4px;font-weight:700}
.wb-ntf-panel{position:absolute;right:0;top:38px;width:340px;max-height:70vh;overflow:auto;background:#fff;border:1px solid #e3e9f2;border-radius:12px;box-shadow:0 14px 38px #17233a24;z-index:80;display:none}
.wb-ntf-panel.is-open{display:block}
.wb-ntf-head{display:flex;align-items:center;padding:11px 14px;border-bottom:1px solid #eef2f8;font-size:13px;font-weight:700;color:#17233a}
.wb-ntf-head button{margin-left:auto;border:none;background:none;color:#5b7ce0;font-size:12px;cursor:pointer}
.wb-ntf-item{display:grid;gap:3px;padding:11px 14px;border-bottom:1px solid #f1f4f9;font-size:12.5px;color:#3a4a63}
.wb-ntf-item:last-child{border-bottom:none}
.wb-ntf-item .t{font-weight:600;color:#17233a;display:flex;align-items:center;gap:6px}
.wb-ntf-item .d{color:#708097;line-height:1.5;word-break:break-all}
.wb-ntf-item .ops{display:flex;gap:10px;margin-top:2px}
.wb-ntf-item .ops a,.wb-ntf-item .ops button{font-size:12px;color:#5b7ce0;text-decoration:none;background:none;border:none;cursor:pointer;padding:0}
.wb-ntf-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.wb-ntf-dot.error{background:#e05252}.wb-ntf-dot.warn{background:#e08b2f}.wb-ntf-dot.info{background:#5b7ce0}
.wb-ntf-item.is-read{opacity:.45}
.wb-ntf-empty{padding:26px 14px;text-align:center;font-size:12.5px;color:#93a1b5}
.wb-ntf-err{padding:18px 14px;text-align:center;font-size:12.5px;color:#b0541e}
/* 定时任务看板（用户与权限页） */
.wb-tasks-table{width:100%;border-collapse:collapse;font-size:12.5px}
.wb-tasks-table th,.wb-tasks-table td{padding:10px 12px;border-bottom:1px solid #edf0f4;text-align:left;vertical-align:top}
.wb-tasks-table th{color:#708097;font-weight:600;font-size:11.5px;white-space:nowrap}
.wb-tasks-ok{color:#1f9d61;font-weight:600;white-space:nowrap}
.wb-tasks-bad{color:#d5443c;font-weight:600;white-space:nowrap}
.wb-tasks-never{color:#93a1b5;white-space:nowrap}
.wb-tasks-detail{color:#708097;word-break:break-all}
`;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = iso => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return String(iso); }
  };

  /* ===== 铃铛（等 shell 顶栏画出来再挂） ===== */
  let bell = null, panel = null;
  let readKeys = new Set();
  let alerts = [];

  async function api(action, opts) {
    const resp = await Session.authorizedFetch('/api/notifications?action=' + action, opts);
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) throw Error(result.error || '请求失败');
    return result.data || {};
  }

  function renderBadge() {
    const unread = alerts.filter(a => !readKeys.has(a.key)).length;
    let badge = bell.querySelector('.wb-ntf-badge');
    if (unread > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'wb-ntf-badge'; bell.append(badge); }
      badge.textContent = unread > 99 ? '99+' : String(unread);
    } else if (badge) badge.remove();
  }

  function renderPanel() {
    const body = panel.querySelector('.wb-ntf-body');
    if (!alerts.length) {
      body.innerHTML = '<div class="wb-ntf-empty">👍 都处理完了，没有提醒</div>';
      return;
    }
    body.innerHTML = alerts.map(a => {
      const isRead = readKeys.has(a.key);
      return '<div class="wb-ntf-item' + (isRead ? ' is-read' : '') + '" data-key="' + esc(a.key) + '">' +
        '<div class="t"><span class="wb-ntf-dot ' + esc(a.level) + '"></span>' + esc(a.title) + '</div>' +
        '<div class="d">' + esc(a.detail) + '</div>' +
        '<div class="ops">' + (a.href ? '<a href="' + esc(a.href) + '" data-go="1">去处理</a>' : '') +
        (isRead ? '' : '<button type="button" data-read="' + esc(a.key) + '">知道了</button>') + '</div></div>';
    }).join('');
  }

  async function load() {
    try {
      const data = await api('list');
      alerts = data.alerts || [];
      readKeys = new Set(data.readKeys || []);
      renderBadge();
      if (panel.classList.contains('is-open')) renderPanel();
    } catch { /* 静默：铃铛坏了不影响页面 */ }
  }

  /* 顶栏是各页面脚本调 shell 画出来的，本文件可能先跑——等它出现再挂铃铛（最多约 10 秒） */
  let waited = 0;
  const timer = setInterval(() => {
    const top = document.querySelector('.workbench-topbar');
    const wrapEl = document.querySelector('.workbench-account-menu');
    if ((top && wrapEl) || (waited += 200) >= 10000) {
      clearInterval(timer);
      if (top && wrapEl) mountBell(top, wrapEl);
    }
  }, 200);

  function mountBell(topbarEl, accountWrapEl) {
    const wrap = document.createElement('div');
    wrap.className = 'wb-ntf';
    wrap.innerHTML = '<button type="button" class="wb-ntf-btn" aria-label="通知中心" title="通知中心">🔔</button>' +
      '<div class="wb-ntf-panel" role="menu"><div class="wb-ntf-head">提醒<button type="button" data-readall="1">全部已读</button></div><div class="wb-ntf-body"></div></div>';
    topbarEl.insertBefore(wrap, accountWrapEl);
    bell = wrap.querySelector('.wb-ntf-btn');
    panel = wrap.querySelector('.wb-ntf-panel');

    bell.onclick = () => {
      const open = panel.classList.toggle('is-open');
      if (open) renderPanel();
    };
    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) panel.classList.remove('is-open');
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') panel.classList.remove('is-open'); });

    panel.onclick = async e => {
      const readBtn = e.target.closest('[data-read]');
      const goLink = e.target.closest('[data-go]');
      if (readBtn) {
        const key = readBtn.getAttribute('data-read');
        readKeys.add(key);
        renderBadge(); renderPanel();
        try { await api('read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }); } catch { }
      } else if (goLink) {
        const item = goLink.closest('.wb-ntf-item');
        const key = item ? item.getAttribute('data-key') : '';
        if (key && !readKeys.has(key)) {
          readKeys.add(key); renderBadge();
          try { await api('read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }); } catch { }
        }
      }
      const readAll = e.target.closest('[data-readall]');
      if (readAll) {
        const keys = alerts.filter(a => !readKeys.has(a.key)).map(a => a.key);
        readKeys = new Set([...readKeys, ...keys]);
        renderBadge(); renderPanel();
        if (keys.length) { try { await api('readAll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }) }); } catch { } }
      }
    };
    load();
  }

  /* ===== 定时任务看板（用户与权限页 #tasksBox） ===== */
  const tasksBox = document.getElementById('tasksBox');
  if (tasksBox) {
    (async () => {
      tasksBox.innerHTML = '<p style="color:#93a1b5;font-size:12.5px;margin:0">正在读取任务运行状态…</p>';
      try {
        const data = await api('tasks');
        const rows = (data.tasks || []).map(t => {
          let state, detail;
          if (!t.last) { state = '<span class="wb-tasks-never">从未运行</span>'; detail = '<span class="wb-tasks-detail">还没跑过一次——本机服务的定时轮询只负责日报，其余任务靠服务器 cron 触发。</span>'; }
          else if (t.last.ok) { state = '<span class="wb-tasks-ok">✓ ' + fmtTime(t.last.ranAt) + '</span>'; detail = '<span class="wb-tasks-detail">' + esc(t.last.detail || '') + '</span>'; }
          else { state = '<span class="wb-tasks-bad">✗ ' + fmtTime(t.last.ranAt) + '</span>'; detail = '<span class="wb-tasks-detail">' + esc(t.last.detail || '执行失败') + '</span>'; }
          return '<tr><td><b>' + esc(t.title) + '</b><br><span class="wb-tasks-detail">' + esc(t.desc) + '</span></td>' +
            '<td>' + esc(t.schedule) + '</td><td>' + state + '</td><td>' + detail + '</td></tr>';
        }).join('');
        tasksBox.innerHTML = '<table class="wb-tasks-table"><thead><tr><th>任务</th><th>计划</th><th>上次执行</th><th>结果</th></tr></thead><tbody>' + rows + '</tbody></table>';
      } catch (error) {
        tasksBox.innerHTML = '<p style="color:#b0541e;font-size:12.5px;margin:0">' + esc(error.message) + '</p>';
      }
    })();
  }
})();
