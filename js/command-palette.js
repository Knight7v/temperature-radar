/* 全局快速跳转（P0-2，参照 Shadcn Admin / Apex 的 Command Palette）：
 *  · Ctrl/Cmd+K 或顶栏「搜索」按钮唤起，输入即搜：全部页面 + 全部店铺
 *  · 选店铺 → 跳销售分析并自动带上店铺筛选（sales.js 认 ?shop= 参数）
 *  · 纯原生 JS，样式本文件注入，不碰共享 CSS；角色不足的条目自动隐藏
 */
(function () {
  'use strict';
  const Session = window.WorkbenchSession ? window.WorkbenchSession.createSessionClient() : null;
  if (!Session) return;

  const CSS = `
.wb-cmdk-btn{display:flex;align-items:center;gap:6px;border:1px solid #e3e9f2;background:#fff;border-radius:8px;height:32px;padding:0 10px;font-size:12.5px;color:#8291a8;cursor:pointer}
.wb-cmdk-btn:hover{border-color:#c6d2e3;background:#f7fafd;color:#3a4a63}
.wb-cmdk-btn kbd{font-family:inherit;font-size:10.5px;border:1px solid #e3e9f2;border-radius:4px;padding:1px 4px;color:#a5b1c4;background:#f7f9fc}
@media (max-width:760px){.wb-cmdk-btn span,.wb-cmdk-btn kbd{display:none}.wb-cmdk-btn{width:32px;padding:0;justify-content:center}}
.wb-cmdk-mask{position:fixed;inset:0;background:#17233a52;z-index:210;display:none;align-items:flex-start;justify-content:center;padding-top:12vh}
.wb-cmdk-mask.is-open{display:flex}
.wb-cmdk{width:560px;max-width:92vw;background:#fff;border-radius:14px;box-shadow:0 24px 64px #17233a3d;overflow:hidden;display:flex;flex-direction:column}
.wb-cmdk-input{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #eef2f8}
.wb-cmdk-input input{flex:1;border:none;outline:none;font-size:15px;color:#17233a;background:transparent}
.wb-cmdk-input input::placeholder{color:#a5b1c4}
.wb-cmdk-input kbd{font-family:inherit;font-size:10.5px;border:1px solid #e3e9f2;border-radius:4px;padding:2px 5px;color:#a5b1c4;background:#f7f9fc;white-space:nowrap}
.wb-cmdk-list{max-height:52vh;overflow:auto;padding:6px}
.wb-cmdk-group{font-size:11px;color:#93a1b5;padding:8px 10px 4px;font-weight:600}
.wb-cmdk-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;font-size:13.5px;color:#3a4a63;cursor:pointer}
.wb-cmdk-item .tag{margin-left:auto;font-size:10.5px;color:#a5b1c4;border:1px solid #eef2f8;border-radius:5px;padding:1px 6px;white-space:nowrap}
.wb-cmdk-item.on,.wb-cmdk-item:hover{background:#eef4ff;color:#2563eb}
.wb-cmdk-item.on .tag{color:#5b7ce0;border-color:#dbe6fb}
.wb-cmdk-empty{padding:28px 14px;text-align:center;font-size:13px;color:#93a1b5}
.wb-cmdk-foot{display:flex;gap:14px;padding:8px 14px;border-top:1px solid #f1f4f9;font-size:11px;color:#a5b1c4}
`;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  /* 全部可跳转页面。roles 缺省 = 所有角色可见 */
  const PAGES = [
    { t: '工作台首页', href: '/workbench.html', kw: '首页 驾驶舱 总览 dashboard' },
    { t: '销售概况', href: '/sales.html#overview', kw: '销售 分析 报表', roles: ['admin', 'operator', 'viewer'], group: '销售分析' },
    { t: '店铺档案', href: '/sales.html#shops', kw: '销售 店铺 档案', roles: ['admin', 'operator', 'viewer'], group: '销售分析' },
    { t: '数据导入', href: '/sales.html#import', kw: '销售 导入 excel', roles: ['admin', 'operator', 'viewer'], group: '销售分析' },
    { t: '目标管理', href: '/sales.html#targets', kw: '销售 目标', roles: ['admin', 'operator', 'viewer'], group: '销售分析' },
    { t: '导入记录', href: '/sales.html#logs', kw: '销售 导入 记录', roles: ['admin', 'operator', 'viewer'], group: '销售分析' },
    { t: '销售结构 · 格力空调', href: '/sales-structure.html?category=gree-ac', kw: '销售结构 格力', roles: ['admin', 'operator', 'viewer'] },
    { t: '销售结构 · 海尔空调', href: '/sales-structure.html?category=haier-ac', kw: '销售结构 海尔 空调', roles: ['admin', 'operator', 'viewer'] },
    { t: '销售结构 · 海尔冰箱', href: '/sales-structure.html?category=haier-fridge', kw: '销售结构 海尔 冰箱', roles: ['admin', 'operator', 'viewer'] },
    { t: '库存看板', href: '/inventory.html', kw: '库存 缺货 积压' },
    { t: '补货分析', href: '/replenishment.html', kw: '库存 补货' },
    { t: '客服质检', href: '/quality.html', kw: '质检 客服 会话', roles: ['admin', 'operator', 'viewer'] },
    { t: '客服档案', href: '/agents.html', kw: '客服 档案 人员', roles: ['admin', 'operator', 'viewer'] },
    { t: '客服提成方案', href: '/service-commission.html', kw: '客服 提成', roles: ['admin', 'operator', 'viewer'] },
    { t: '商品主图编辑器', href: '/design.html', kw: '设计 主图 ai 作图' },
    { t: '一页纸卖点编辑器', href: '/selling.html', kw: '设计 卖点' },
    { t: '功能参数对比', href: '/comparison.html', kw: '设计 参数 对比' },
    { t: '战报设计', href: '/report-design.html', kw: '设计 战报 海报' },
    { t: '产品知识库', href: '/products.html', kw: '知识库 产品 参数' },
    { t: '售后知识库', href: '/after-sales.html', kw: '知识库 售后' },
    { t: '空调热销区域雷达', href: '/index-v2.html', kw: '气温 天气 工具 雷达' },
    { t: '机型性能PK', href: '/pk.html', kw: '机型 pk 对比 选机' },
    { t: '比价助手', href: '/price.html', kw: '比价 竞品 到手价 价格监控 工具' },
    { t: '准确率校准', href: '/quality-calibration.html', kw: '质检 校准 盲评', roles: ['admin', 'operator'] },
    { t: '账号安全', href: '/password.html', kw: '密码 安全 账号' },
    { t: '用户与权限', href: '/users.html', kw: '用户 权限 账号 管理', roles: ['admin'] }
  ];

  /* 店铺懒加载：销售接口仅 admin/operator/viewer 可读 */
  let role = null, shopsCache = null, shopsPromise = null;
  function canSee(item) { return !item.roles || (role && item.roles.includes(role)); }
  function fetchShops() {
    if (!['admin', 'operator', 'viewer'].includes(role)) return Promise.resolve([]);
    if (shopsCache) return Promise.resolve(shopsCache);
    if (!shopsPromise) shopsPromise = Session.authorizedFetch('/api/sales?action=shops')
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => { shopsCache = (d.data || []).map(v => ({ id: v.id, name: v.data && v.data.name || v.id })); return shopsCache; })
      .catch(() => []);
    return shopsPromise;
  }

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = v => String(v || '').toLowerCase().trim();

  /* ===== 面板状态（单向数据流：state → render，事件只改 state） ===== */
  const state = { open: false, query: '', items: [], active: 0 };
  let mask, input, listBox, btn;

  function buildItems() {
    const query = norm(state.query);
    const pages = PAGES.filter(canSee).filter(p => !query || norm(p.t).includes(query) || norm(p.kw).includes(query) || norm(p.href).includes(query))
      .map(p => ({ kind: 'page', title: p.t, hint: p.group || '页面', href: p.href }));
    const queryShop = norm(state.query);
    const shops = !queryShop ? [] : (shopsCache || []).filter(s => norm(s.name).includes(queryShop)).slice(0, 8)
      .map(s => ({ kind: 'shop', title: s.name, hint: '店铺', href: '/sales.html?shop=' + encodeURIComponent(s.id) }));
    return [...shops, ...pages];
  }

  function render() {
    if (!state.items.length) {
      listBox.innerHTML = '<div class="wb-cmdk-empty">' + (state.query ? '没有匹配的页面或店铺' : '正在载入…') + '</div>';
      return;
    }
    let lastGroup = null, html = '';
    state.items.forEach((item, i) => {
      if (item.hint !== lastGroup) { html += '<div class="wb-cmdk-group">' + esc(item.hint) + '</div>'; lastGroup = item.hint; }
      html += '<div class="wb-cmdk-item' + (i === state.active ? ' on' : '') + '" data-i="' + i + '">' +
        '<span>' + esc(item.title) + '</span><span class="tag">' + (item.kind === 'shop' ? '跳转销售分析' : '进入') + '</span></div>';
    });
    listBox.innerHTML = html;
    const on = listBox.querySelector('.wb-cmdk-item.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function refresh() { state.items = buildItems(); state.active = 0; render(); }

  function open() {
    state.open = true; state.query = '';
    input.value = '';
    mask.classList.add('is-open');
    refresh();
    if (role == null) {
      Session.getIdentity().then(who => { role = (who.user || {}).role || 'viewer'; refresh(); return fetchShops(); })
        .then(() => { if (state.open) refresh(); })
        .catch(() => { role = 'viewer'; refresh(); });
    } else {
      fetchShops().then(() => { if (state.open) refresh(); });
    }
    setTimeout(() => input.focus(), 0);
  }
  function close() { state.open = false; mask.classList.remove('is-open'); }
  function go(item) {
    close();
    if (item && item.href) location.href = item.href;
  }

  /* ===== 挂载：等 shell 顶栏出现（与通知铃铛同一套路，最多等约 10 秒） ===== */
  let waited = 0;
  const timer = setInterval(() => {
    const top = document.querySelector('.workbench-topbar');
    const wrapEl = document.querySelector('.workbench-account-menu');
    if ((top && wrapEl) || (waited += 200) >= 10000) {
      clearInterval(timer);
      if (top && wrapEl) mount(top, wrapEl);
    }
  }, 200);

  function mount(topbarEl, accountWrapEl) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-cmdk-btn';
    btn.setAttribute('aria-label', '搜索页面和店铺（Ctrl+K）');
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2.4"/><path d="M20 20l-3.8-3.8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>' +
      '<span>搜索</span><kbd>' + (/Mac/i.test(navigator.platform || '') ? '⌘K' : 'Ctrl K') + '</kbd>';
    topbarEl.insertBefore(btn, accountWrapEl);

    mask = document.createElement('div');
    mask.className = 'wb-cmdk-mask';
    mask.innerHTML = '<div class="wb-cmdk" role="dialog" aria-label="快速跳转"><div class="wb-cmdk-input">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="#a5b1c4" stroke-width="2.4"/><path d="M20 20l-3.8-3.8" stroke="#a5b1c4" stroke-width="2.4" stroke-linecap="round"/></svg>' +
      '<input type="text" placeholder="搜页面或店铺名，回车直达…" aria-label="搜索页面和店铺"><kbd>Esc 关闭</kbd></div>' +
      '<div class="wb-cmdk-list"></div><div class="wb-cmdk-foot"><span>↑↓ 选择</span><span>↵ 打开</span><span>Esc 关闭</span></div></div>';
    document.body.append(mask);
    input = mask.querySelector('input');
    listBox = mask.querySelector('.wb-cmdk-list');

    btn.onclick = open;
    mask.onclick = e => { if (e.target === mask) close(); };
    listBox.onclick = e => {
      const item = e.target.closest('.wb-cmdk-item');
      if (item) go(state.items[Number(item.dataset.i)]);
    };
    input.oninput = () => { state.query = input.value; refresh(); };

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        state.open ? close() : open();
        return;
      }
      if (!state.open) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (state.items.length) { state.active = (state.active + 1) % state.items.length; render(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (state.items.length) { state.active = (state.active - 1 + state.items.length) % state.items.length; render(); } }
      else if (e.key === 'Enter') { e.preventDefault(); go(state.items[state.active]); }
    });
  }
})();
