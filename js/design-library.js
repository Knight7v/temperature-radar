// 素材库抽屉：图形化地翻历史图，而不是去翻磁盘目录。
//
// 放在独立文件里，一是主图工作室那段逻辑已经很长，二是这个抽屉将来要给
// 卖点图、对比图复用，独立出来才好搬。
//
// 全部用 DOM API 构建而不是拼 innerHTML：库里的标题、提示词都是人填的，
// 拼字符串迟早会被一个引号搞坏。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesignLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const el = (tag, props, children) => {
    const node = document.createElement(tag);
    if (props) {
      Object.entries(props).forEach(([key, value]) => {
        if (value === undefined || value === null || value === false) return;
        if (key === 'text') node.textContent = String(value);
        else if (key === 'className') node.className = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    (Array.isArray(children) ? children : children ? [children] : []).forEach(child => {
      if (child) node.append(child);
    });
    return node;
  };

  const PURPOSE_NAME = {
    first: '首图',
    scene: '场景',
    promo: '活动',
    deal: '大促',
    background: '背景'
  };
  const STATUS_NAME = { draft: '草稿', review: '待审', approved: '通过', archived: '归档' };

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function create({ api, onPickBackground, onNotify }) {
    const state = { open: false, loading: false, items: [], page: 1, pages: 1, total: 0, summary: null, meta: null };
    let root = null;
    const filter = { q: '', purpose: '', status: '', from: '', to: '' };

    const notify = (text, tone) => {
      if (typeof onNotify === 'function') onNotify(text, tone);
    };

    function build() {
      const search = el('input', { type: 'search', placeholder: '搜型号 / 标题 / 提示词', maxlength: '60' });
      search.addEventListener('input', () => {
        filter.q = search.value.trim();
        clearTimeout(search._timer);
        search._timer = setTimeout(() => load(1), 260);
      });

      const purpose = el('select', null, [
        el('option', { value: '', text: '全部用途' }),
        ...(state.meta?.purposes || []).map(item => el('option', { value: item.id, text: item.name }))
      ]);
      purpose.addEventListener('change', () => {
        filter.purpose = purpose.value;
        load(1);
      });

      const status = el('select', null, [
        el('option', { value: '', text: '全部状态' }),
        ...(state.meta?.statuses || []).map(item => el('option', { value: item.id, text: item.name }))
      ]);
      status.addEventListener('change', () => {
        filter.status = status.value;
        load(1);
      });

      const from = el('input', { type: 'date' });
      const to = el('input', { type: 'date' });
      [from, to].forEach(input => {
        input.addEventListener('change', () => {
          filter.from = from.value;
          filter.to = to.value;
          load(1);
        });
      });

      const count = el('small', { id: 'libTotal', text: '' });
      const grid = el('div', { className: 'ds-lib-grid' });
      const pager = el('div', { className: 'ds-lib-pager' });

      const body = el('div', { className: 'ds-drawer-body' }, [
        el('div', { className: 'ds-lib-filters' }, [search, purpose, status, from, to]),
        grid,
        pager
      ]);

      const toggle = el('button', { type: 'button', className: 'ds-drawer-close', text: '关闭' });
      toggle.addEventListener('click', () => close());

      const panel = el('aside', { className: 'ds-drawer-panel', role: 'dialog', 'aria-label': '素材库' }, [
        el('header', { className: 'ds-drawer-head' }, [
          el('h3', { text: '素材库 ' }),
          count,
          toggle
        ]),
        body
      ]);

      const mask = el('div', { className: 'ds-drawer-mask' });
      mask.addEventListener('click', () => close());

      root = el('div', { className: 'ds-drawer', hidden: true }, [mask, panel]);
      root._grid = grid;
      root._pager = pager;
      root._count = count;
      return root;
    }

    function card(item) {
      const thumb = el('img', { src: item.url, alt: item.title || item.sku || '素材', loading: 'lazy' });
      const imageWrap = el('div', { className: 'ds-lib-thumb' }, [
        thumb,
        el('b', { className: 'ds-lib-badge', dataset: { purpose: item.purpose }, text: PURPOSE_NAME[item.purpose] || item.purpose })
      ]);
      imageWrap.addEventListener('click', () => window.open(item.url, '_blank'));

      const meta = el('div', { className: 'ds-lib-meta' }, [
        el('strong', { text: item.sku || item.title || '未命名', title: item.sku || item.title || '' }),
        el('small', {
          text: [item.title && item.sku ? item.title : '', formatDate(item.createdAt), item.width ? `${item.width}×${item.height}` : '']
            .filter(Boolean)
            .join(' · ')
        })
      ]);

      const status = el(
        'select',
        { title: '审核状态' },
        Object.entries(STATUS_NAME).map(([id, name]) =>
          el('option', { value: id, text: name, selected: item.status === id })
        )
      );
      status.addEventListener('change', async () => {
        try {
          await api.assetUpdate({ id: item.id, status: status.value });
          item.status = status.value;
          notify(`已改为「${STATUS_NAME[status.value]}」`, 'ok');
        } catch (error) {
          notify(`改状态失败：${error.message}`, 'error');
          status.value = item.status || 'draft';
        }
      });

      const remove = el('button', { type: 'button', className: 'ds-lib-danger', text: '删除' });
      remove.addEventListener('click', async () => {
        if (!window.confirm('删除后这张图不再出现在素材库里，确定吗？')) return;
        try {
          await api.assetDelete({ id: item.id });
          notify('已从素材库删除', 'ok');
          load(state.page);
        } catch (error) {
          notify(`删除失败：${error.message}`, 'error');
        }
      });

      // 两行布局：卡片在抽屉里只有 200 多像素宽，一行塞不下「价格 + 状态下拉 + 两个按钮」
      const priceLine = el('div', { className: 'ds-lib-line' }, [
        el('small', { className: 'ds-lib-cost', text: item.cost ? `${item.cost.toFixed(2)} 元` : '免费' }),
        status
      ]);
      const actionLine = el('div', { className: 'ds-lib-line ds-lib-actions' });
      if (item.purpose === 'background' && typeof onPickBackground === 'function') {
        const use = el('button', { type: 'button', text: '用作背景' });
        use.addEventListener('click', () => onPickBackground(item));
        actionLine.append(use);
      }
      actionLine.append(remove);

      return el('article', { className: 'ds-lib-card' }, [imageWrap, meta, el('div', { className: 'ds-lib-foot' }, [priceLine, actionLine])]);
    }

    function render(data) {
      state.items = data.items || [];
      state.total = data.total || 0;
      state.pages = data.pages || 1;
      state.page = data.page || 1;
      state.summary = data.summary || null;

      if (!root) return;
      root._count.textContent = `共 ${state.total} 张${state.summary ? ` · 占用 ${formatSize(state.summary.bytes)}` : ''}`;
      root._grid.replaceChildren();

      if (!state.items.length) {
        root._grid.append(
          el('p', {
            className: 'ds-lib-empty',
            text: state.total ? '这一页是空的，换一页看看' : '还没有存过图。出成品后点「存进素材库」，以后就能按型号找回来。'
          })
        );
      } else {
        state.items.forEach(item => root._grid.append(card(item)));
      }

      root._pager.replaceChildren();
      const zip = el('button', { type: 'button', text: `打包这 ${state.items.length} 张（ZIP）` });
      zip.addEventListener('click', () => downloadZip(state.items.map(item => item.id), zip));
      root._pager.append(el('span', { text: `第 ${state.page} / ${state.pages} 页` }));
      if (state.page > 1) {
        const prev = el('button', { type: 'button', text: '上一页' });
        prev.addEventListener('click', () => load(state.page - 1));
        root._pager.append(prev);
      }
      if (state.page < state.pages) {
        const next = el('button', { type: 'button', text: '下一页' });
        next.addEventListener('click', () => load(state.page + 1));
        root._pager.append(next);
      }
      root._pager.append(zip);
    }

    async function downloadZip(ids, button) {
      if (!ids.length) return notify('这一页没有图可以打包', 'warn');
      button.disabled = true;
      button.textContent = '正在打包…';
      try {
        const data = await api.assetsZip({ ids: ids.join(',') });
        const binary = atob(data.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = data.filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        notify(`已打包 ${data.count} 张${data.missing ? `，${data.missing} 张文件缺失被跳过` : ''}`, 'ok');
      } catch (error) {
        notify(`打包失败：${error.message}`, 'error');
      } finally {
        button.disabled = false;
        button.textContent = `打包这 ${ids.length} 张（ZIP）`;
      }
    }

    async function load(page = 1) {
      if (state.loading) return;
      state.loading = true;
      if (root) {
        root._grid.replaceChildren(el('p', { className: 'ds-lib-empty', text: '正在读素材库…' }));
      }
      try {
        const data = await api.assets({ ...filter, page });
        state.meta = data.meta || state.meta;
        render(data);
      } catch (error) {
        if (root) {
          root._grid.replaceChildren(el('p', { className: 'ds-lib-empty', text: `读不到素材库：${error.message}` }));
        }
      } finally {
        state.loading = false;
      }
    }

    function mount(container) {
      if (!container || root) return;
      container.append(build());
    }

    function open() {
      if (!root) return;
      root.hidden = false;
      state.open = true;
      load(1);
    }

    function close() {
      if (!root) return;
      root.hidden = true;
      state.open = false;
    }

    return {
      mount,
      open,
      close,
      refresh: () => (state.open ? load(state.page) : null),
      setMeta: meta => {
        state.meta = meta;
      },
      get total() {
        return state.total;
      }
    };
  }

  return { create };
});
