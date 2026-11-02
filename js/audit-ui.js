/* 操作日志 + 数据字典（P2，2026-10-30 视觉升级适配）。挂在「用户与权限」页：
 *  · #auditBox：操作日志查询（动作类型筛选 + 关键字 + 加载更多）
 *  · #dictBox ：数据字典展示（lib/dictionary.js 的镜像 js/dictionary.js）
 * 样式已移交 css/users.css（仅 users.html 引用），本文件不再注入 CSS。
 */
(function () {
  'use strict';
  const Session = window.WorkbenchSession ? window.WorkbenchSession.createSessionClient() : null;
  const Dict = window.WorkbenchDictionary || {};
  if (!Session) return;

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* 动作前缀 → 徽章配色（css/users.css 里的 u-bg-log-*） */
  const actionCls = { auth: 'u-bg-log-user', shop: 'u-bg-log-shop', target: 'u-bg-log-target', sales: 'u-bg-log-sales', quality: 'u-bg-log-quality', user: 'u-bg-log-user', agent: 'u-bg-log-agent' };
  const roleBg = { admin: '#7c3aed', operator: '#2563eb', supply_chain: '#0d9488', viewer: '#94a3b8' };

  function relTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const sec = (Date.now() - d.getTime()) / 1000;
    if (sec < 60) return '刚刚';
    if (sec < 3600) return Math.floor(sec / 60) + ' 分钟前';
    if (sec < 86400) return Math.floor(sec / 3600) + ' 小时前';
    const days = Math.floor(sec / 86400);
    if (days < 30) return days + ' 天前';
    return Math.floor(days / 30) + ' 个月前';
  }
  function absTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return String(iso); }
  }

  /* detail → 大白话（与 lib/audit.js describeDetail 同一规则，改要改两处） */
  function describeDetail(action, detail) {
    const d = detail || {};
    switch (action) {
      case 'sales.import': return `新增 ${d.added ?? 0} 行 / 覆盖 ${d.changed ?? 0} 行 · ${d.start || '?'} ~ ${d.end || '?'}`;
      case 'target.year': return `年度合计 ${d.annual == null ? '已清空' : '¥' + Math.round(d.annual / 100).toLocaleString('zh-CN')} · 已填 ${d.months ?? 0}/12 个月`;
      case 'target.update': return `目标金额 ¥${d.yuan == null ? '?' : Number(d.yuan).toLocaleString('zh-CN')}`;
      case 'quality.review': return `AI 分 ${d.aiScore ?? '?'} → 复核后 ${d.finalScore ?? '?'} · 改判 ${d.overrides ?? 0} 项${d.note ? ' · 备注：' + d.note : ''}`;
      case 'user.create': return `账号 ${d.identifier || '?'} · 角色 ${d.role || '?'}`;
      case 'user.update': return [d.role ? '角色→' + d.role : '', d.status ? '状态→' + (d.status === 'active' ? '启用' : '停用') : '', d.displayName ? '姓名→' + d.displayName : ''].filter(Boolean).join('，') || '无字段变化';
      case 'agent.import': return `带入建档 ${d.created ?? 0} 人，跳过 ${d.skipped ?? 0} 人`;
      case 'auth.login': return `IP ${d.ip || '未知'}${d.browser ? ' · ' + d.browser : ''}`;
      default: {
        const parts = Object.entries(d).filter(([, v]) => v != null && v !== '');
        return parts.length ? parts.map(([k, v]) => k + '：' + v).join('，') : '';
      }
    }
  }

  /* ===== 操作日志 ===== */
  const box = document.getElementById('auditBox');
  if (box) {
    let offset = 0;

    const actions = Object.entries(Dict.auditActions || {});
    const actionOptions = ['<option value="">全部动作</option>'].concat(actions.map(([k, label]) => `<option value="${esc(k)}">${esc(label)}</option>`)).join('');

    box.innerHTML = '<div class="wb-audit-filters"><select id="auditAction">' + actionOptions + '</select>' +
      '<input id="auditQ" placeholder="搜操作人 / 对象 / 内容…">' +
      '<button type="button" class="workbench-primary" id="auditGo">查询</button></div>' +
      '<div id="auditRows"></div><div id="auditMoreWrap"></div>';
    const rowsEl = box.querySelector('#auditRows'), moreWrap = box.querySelector('#auditMoreWrap');

    function renderRows(rows, append) {
      if (!rows.length && !append) {
        rowsEl.innerHTML = '<p class="u-note" style="color:#9aa7ba">没有符合条件的记录。</p>';
        return;
      }
      const html = rows.map(r => {
        const act = (Dict.auditActions || {})[r.action] || r.action;
        const cls = actionCls[String(r.action || '').split('.')[0]] || 'u-bg-log-agent';
        const initial = (r.actor_name || '?').slice(0, 1);
        return '<tr>' +
          '<td class="wb-audit-time"><b>' + relTime(r.createdAt) + '</b><small>' + absTime(r.createdAt) + '</small></td>' +
          '<td><div class="wb-audit-who"><span class="u-avatar" style="background:' + (roleBg[r.role] || '#94a3b8') + '">' + initial + '</span>' +
            '<div><div class="u-n">' + esc(r.actor_name || '未知') + '</div><div class="u-r">' + esc(r.role || '') + '</div></div></div></td>' +
          '<td><span class="wb-audit-act ' + cls + '">' + esc(act) + '</span></td>' +
          '<td>' + esc(r.target_label || '') + '</td>' +
          '<td class="wb-audit-detail">' + esc(describeDetail(r.action, r.detail)) + '</td></tr>';
      }).join('');
      if (append && rowsEl.querySelector('tbody')) {
        rowsEl.querySelector('tbody').insertAdjacentHTML('beforeend', html);
      } else {
        rowsEl.innerHTML = '<table class="users-table"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th></tr></thead><tbody>' + html + '</tbody></table>';
      }
    }

    async function load(append) {
      const filters = {
        actionType: box.querySelector('#auditAction').value,
        q: box.querySelector('#auditQ').value.trim()
      };
      if (!append) offset = 0;
      moreWrap.innerHTML = '';
      try {
        const params = new URLSearchParams({ ...filters, limit: '50', offset: String(offset) });
        const resp = await Session.authorizedFetch('/api/audit?action=list&' + params);
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok) throw Error(result.error || '加载失败');
        const rows = (result.data || {}).rows || [];
        renderRows(rows, append);
        if (rows.length === 50) {
          const btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'wb-audit-more'; btn.textContent = '再加载 50 条';
          btn.onclick = () => { offset += 50; load(true); };
          moreWrap.append(btn);
        }
      } catch (error) {
        if (!append) rowsEl.innerHTML = '<p class="u-note" style="color:#b0541e">' + esc(error.message) + '</p>';
      }
    }
    box.querySelector('#auditGo').onclick = () => load(false);
    box.querySelector('#auditQ').addEventListener('keydown', e => { if (e.key === 'Enter') load(false); });
    load(false);
  }

  /* ===== 数据字典（shadcn 三段式：标题+说明 | 枚举 chips） ===== */
  const dictBox = document.getElementById('dictBox');
  if (dictBox && Dict.userRoles) {
    const chip = (v, tone) => '<span class="wb-dict-chip' + (tone ? ' u-chip-' + tone : '') + '">' + esc(v) + '</span>';
    const chipCode = (k, v) => '<span class="wb-dict-chip"><code>' + esc(k) + '</code>' + esc(v) + '</span>';
    const groups = [
      ['用户角色', 'users.role 合法值 · 导航按角色过滤', Object.entries(Dict.userRoles).map(([k, v]) => chipCode(k, v)).join('')],
      ['店铺状态', '店铺档案「状态」字段 · 已闭店不计入目标分母',
        chip(Dict.shopStatus[0], 'green') + chip(Dict.shopStatus[1], 'amber') + chip(Dict.shopStatus[2])],
      ['店铺平台', '销售导入与分店展示的平台枚举', (Dict.shopPlatforms || []).map(v => chip(v)).join('')],
      ['质检 · 是否解决', '京麦「是否解决」结论 · ' + (Dict.quality.resolved.ignored || []).map(v => '「' + esc(v) + '」').join('') + ' 不计入',
        chip(Dict.quality.resolved.yes, 'green') + chip(Dict.quality.resolved.no, 'red')],
      ['质检 · 满意度', '满意率只算绿色两档 · 对应运营指标 tab',
        (Dict.quality.satisfaction.good || []).map(v => chip(v, 'green')).join('') +
        (Dict.quality.satisfaction.mid || []).map(v => chip(v, 'amber')).join('') +
        (Dict.quality.satisfaction.bad || []).map(v => chip(v, 'red')).join('')],
      ['操作日志动作', Object.keys(Dict.auditActions || {}).length + ' 种已登记动作 · 未知动作自动拒写',
        Object.entries(Dict.auditActions || {}).map(([k, v]) => chipCode(k, v)).join('')]
    ];
    dictBox.innerHTML = groups.map(([title, desc, items]) =>
      '<div class="wb-dict-group"><h4>' + esc(title) + '<small>' + esc(desc) + '</small></h4><div class="wb-dict-items">' + items + '</div></div>'
    ).join('');
  }
})();
