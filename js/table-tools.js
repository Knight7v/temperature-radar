/* 表格工具条（P1-2）：给动态渲染的数据表加「列显隐 + 导出」。
 * 用法：TableTools.enhance(containerEl, { key:'sales-report', exportName:'销售统计' })
 *  · container 是装 <table> 的盒子（表格由页面 JS 反复重绘，本组件监听变化自动跟随）
 *  · 列显隐按表头文字记忆（localStorage，key = tt:<key>），换视图导致表头变化时自动放弃旧记忆
 *  · 合并单元格的表头（rowspan/colspan）不支持列显隐，只保留导出
 *  · 导出为 CSV（带 BOM，Excel 双击直开），只导当前显示的列
 * 样式本文件注入，不碰共享 CSS。
 */
(function (root) {
  'use strict';
  if (root.TableTools) return;
  const CSS = `
.tt-bar{display:flex;align-items:center;gap:8px;margin:0 0 8px;justify-content:flex-end}
.tt-bar .tt-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid #e3e9f2;background:#fff;border-radius:8px;height:30px;padding:0 11px;font-size:12.5px;color:#5b6b84;cursor:pointer}
.tt-bar .tt-btn:hover{border-color:#c6d2e3;background:#f7fafd}
.tt-pop{position:absolute;right:0;top:34px;z-index:60;min-width:160px;background:#fff;border:1px solid #e3e9f2;border-radius:10px;box-shadow:0 12px 32px #17233a26;padding:6px;display:none}
.tt-pop.is-open{display:block}
.tt-pop label{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:7px;font-size:12.5px;color:#3a4a63;cursor:pointer;white-space:nowrap}
.tt-pop label:hover{background:#f2f6fd}
.tt-pop input{accent-color:#2563eb}
.tt-pop .tt-hint{padding:7px 9px;font-size:11.5px;color:#93a1b5}
.tt-wrap{position:relative;display:flex;justify-content:flex-end}
`;
  let cssDone = false;
  function injectCss() {
    if (cssDone) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    cssDone = true;
  }
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* CSV 转义：包含逗号/引号/换行就加引号，内部引号翻倍 */
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(name, text) {
    const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function loadState(key) {
    try { return JSON.parse(localStorage.getItem('tt:' + key)) || {}; } catch { return {}; }
  }
  function saveState(key, state) {
    try { localStorage.setItem('tt:' + key, JSON.stringify(state)); } catch { }
  }

  /* 当前表格的表头行文字签名；有合并单元格返回 merged。兼容没有显式 <thead> 的直排表格 */
  function headerInfo(table) {
    let row = null;
    if (table.tHead && table.tHead.rows.length) row = table.tHead.rows[0];
    else {
      const first = table.rows[0];
      if (first && first.cells.length && first.cells[0].tagName === 'TH') row = first;
    }
    if (!row) return null;
    const cols = Array.from(row.cells);
    if (cols.some(c => c.colSpan > 1 || c.rowSpan > 1)) return { merged: true, texts: cols.map(c => c.textContent.trim()) };
    return { merged: false, texts: cols.map(c => c.textContent.trim()) };
  }

  function enhance(box, opts) {
    if (!box || !box.parentNode) return;
    injectCss();
    const key = opts.key, exportName = opts.exportName || '表格导出';
    let state = loadState(key);       // { sig, hidden:[index,...] }
    let currentSig = null, merged = false;

    const bar = document.createElement('div');
    bar.className = 'tt-bar';
    const wrapEl = document.createElement('div');
    wrapEl.className = 'tt-wrap';
    wrapEl.append(bar);
    box.parentNode.insertBefore(wrapEl, box);

    const colBtn = document.createElement('button');
    colBtn.type = 'button'; colBtn.className = 'tt-btn';
    colBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M9 4v16" stroke="currentColor" stroke-width="2"/></svg>列';
    let expBtn = document.createElement('button');
    expBtn.type = 'button'; expBtn.className = 'tt-btn';
    expBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v10m0 0l-4-4m4 4l4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 18h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>导出';
    bar.append(colBtn);
    if (!opts.noExport) bar.append(expBtn);
    else expBtn = null;

    const pop = document.createElement('div');
    pop.className = 'tt-pop';
    wrapEl.append(pop);

    colBtn.onclick = e => { e.stopPropagation(); buildPop(); pop.classList.toggle('is-open'); };
    pop.onclick = e => e.stopPropagation();
    document.addEventListener('click', () => pop.classList.remove('is-open'));

    function buildPop() {
      const table = box.querySelector('table');
      const info = table ? headerInfo(table) : null;
      if (!info || info.merged || !info.texts.length) {
        pop.innerHTML = '<div class="tt-hint">' + (info && info.merged ? '此表有合并单元格，不支持列显隐' : '暂无表头') + '</div>';
        return;
      }
      const hidden = new Set(state.sig === info.texts.join('|') ? state.hidden : []);
      pop.innerHTML = info.texts.map((t, i) =>
        '<label><input type="checkbox" data-i="' + i + '"' + (hidden.has(i) ? '' : ' checked') + '>' + esc(t || ('第' + (i + 1) + '列')) + '</label>'
      ).join('');
      pop.querySelectorAll('input').forEach(cb => cb.onchange = () => {
        const set = new Set(state.sig === info.texts.join('|') ? state.hidden : []);
        pop.querySelectorAll('input').forEach(x => { const i = Number(x.dataset.i); if (!x.checked) set.add(i); else set.delete(i); });
        state = { sig: info.texts.join('|'), hidden: [...set] };
        saveState(key, state);
        apply();
      });
    }

    function apply() {
      const table = box.querySelector('table');
      if (!table) return;
      const info = headerInfo(table);
      if (!info || info.merged) return;
      const sig = info.texts.join('|');
      const hidden = new Set(state.sig === sig ? state.hidden : []);
      for (const row of table.rows) {
        const cells = Array.from(row.cells);
        if (cells.length !== info.texts.length) continue; // 合并行（如空态行）不动
        cells.forEach((cell, i) => { cell.style.display = hidden.has(i) ? 'none' : ''; });
      }
    }

    /* 表格重绘后自动跟随；自身改样式会再触发，用「无变化就跳过」防抖 */
    let timer = null, lastSig = null;
    const mo = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const table = box.querySelector('table');
        const info = table ? headerInfo(table) : null;
        const sig = info ? info.texts.join('|') : null;
        if (sig !== lastSig) { lastSig = sig; buildPop(); } // 表头变了重建勾选列表
        apply();
      }, 120);
    });
    mo.observe(box, { childList: true, subtree: true });

    if (expBtn) expBtn.onclick = () => {
      const table = box.querySelector('table');
      if (!table) { if (root.WBToast) WBToast.show('没有可导出的表格', 'info'); return; }
      const lines = [];
      for (const row of table.rows) {
        const cells = Array.from(row.cells).filter(c => c.style.display !== 'none' && c.offsetParent !== null);
        if (!cells.length) continue;
        const vals = [];
        for (const c of cells) {
          const span = c.colSpan > 1 ? c.colSpan : 1;
          const text = (c.innerText || c.textContent || '').trim();
          for (let k = 0; k < span; k++) vals.push(text);
        }
        lines.push(vals.map(csvCell).join(','));
      }
      if (!lines.length) { if (root.WBToast) WBToast.show('表格是空的，没有内容可导出', 'info'); return; }
      const d = new Date().toISOString().slice(0, 10);
      download(exportName + '-' + d + '.csv', lines.join('\r\n'));
      if (root.WBToast) WBToast.show('已导出 ' + exportName + '（' + (lines.length - 1) + ' 行），Excel 可直接打开');
    };

    apply();
  }

  root.TableTools = { enhance };
})(window);
