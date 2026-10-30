(async function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const session = WorkbenchSession.createSessionClient();
  try {
    const identity = await session.getIdentity();
    WorkbenchShell.mountShell({ container: $('reportShell'), activeModule: 'design-report', identity,
      onLogout: async () => { await session.logout(); location.replace('/login.html'); } });
  } catch {
    location.replace('/login.html?returnTo=%2Freport-design.html');
    return;
  }

  const templates = {
    starfield: { file: 'bid-win-starfield.png', text: { x: 470, top: 585, width: 760, color: '#fff1cf' }, product: { x: 140, y: 865, w: 660, h: 440 } },
    orbit: { file: 'bid-win-orbit.png', text: { x: 470, top: 748, width: 770, color: '#fff1cf' }, product: { x: 170, y: 1010, w: 600, h: 390 } },
    vertical: { file: 'bid-win-vertical.png', text: { x: 470, top: 858, width: 770, color: '#fff1cf' }, product: { x: 155, y: 1080, w: 630, h: 355 } }
  };
  const canvas = $('reportCanvas');
  const ctx = canvas.getContext('2d');
  const state = { selected: 'starfield', base: null, product: null, productUrl: null, loadId: 0 };
  const fields = ['projectName', 'productName', 'quantity', 'unit', 'productScale'];

  function imageFrom(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片加载失败'));
      image.src = src;
    });
  }

  function data() {
    const project = $('projectName').value.trim();
    const product = $('productName').value.trim();
    const quantity = Number($('quantity').value);
    const unit = $('unit').value.trim() || '台';
    return { project, product, quantity, unit,
      valid: Boolean(project && product && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 999999) };
  }

  function setStatus(message, tone = '') {
    $('reportStatus').textContent = message;
    $('reportStatus').dataset.tone = tone;
  }

  function lineWidth(text, maxWidth, startSize, minSize = 27) {
    let size = startSize;
    while (size > minSize) {
      ctx.font = `700 ${size}px "Noto Sans CJK SC", "PingFang SC", sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 2;
    }
    return size;
  }

  function drawLine(text, x, y, maxWidth, size, color) {
    const fontSize = lineWidth(text, maxWidth, size);
    ctx.font = `700 ${fontSize}px "Noto Sans CJK SC", "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.shadowColor = '#420400';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillText(text, x, y, maxWidth);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  function drawCopy(info, template) {
    if (!info.project && !info.product && !Number.isInteger(info.quantity)) return;
    const area = template.text;
    const detail = `${info.product || '产品名称'}${info.quantity > 0 ? info.quantity : '—'}${info.unit}`;
    drawLine('长缨星河中标', area.x, area.top, area.width, 49, area.color);
    drawLine(info.project || '项目名称', area.x, area.top + 77, area.width, 61, area.color);
    drawLine(detail, area.x, area.top + 155, area.width, 57, area.color);
  }

  function drawProduct(template) {
    if (!state.product) return;
    const box = template.product;
    const image = state.product;
    const scale = Number($('productScale').value) / 100;
    const fit = Math.min(box.w / image.width, box.h / image.height) * scale;
    const width = image.width * fit;
    const height = image.height * fit;
    const x = box.x + (box.w - width) / 2;
    const y = box.y + (box.h - height) / 2;
    ctx.save();
    ctx.shadowColor = '#35060088';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 13;
    ctx.drawImage(image, x, y, width, height);
    ctx.restore();
  }

  function render() {
    if (!state.base) return;
    canvas.width = state.base.naturalWidth;
    canvas.height = state.base.naturalHeight;
    ctx.drawImage(state.base, 0, 0);
    const info = data();
    const template = templates[state.selected];
    drawCopy(info, template);
    drawProduct(template);
    $('reportCopy').textContent = info.project || info.product || $('quantity').value
      ? `长缨星河中标${info.project || '……'}${info.product || '……'}${info.quantity > 0 ? info.quantity : '……'}${info.unit}`
      : '长缨星河中标……';
    $('productScaleValue').textContent = `${$('productScale').value}%`;
    $('downloadReport').disabled = !(info.valid && state.product);
    if (info.valid && state.product) setStatus('喜报已合成，可以下载 PNG。', 'ok');
    else if (!state.product) setStatus('填写项目信息并上传产品图片，即可下载喜报。');
    else setStatus('请填写完整的项目名称、产品名称和数量。');
  }

  async function selectTemplate(id) {
    if (!templates[id]) return;
    const loadId = ++state.loadId;
    setStatus('正在加载模板……');
    try {
      const base = await imageFrom(`/assets/design/report-templates/${templates[id].file}`);
      if (loadId !== state.loadId) return;
      state.selected = id;
      state.base = base;
      document.querySelectorAll('[data-template]').forEach(button =>
        button.setAttribute('aria-pressed', String(button.dataset.template === id)));
      render();
    } catch {
      setStatus('模板加载失败，请刷新页面重试。', 'error');
    }
  }

  async function loadProduct() {
    const file = $('reportProduct').files?.[0];
    if (state.productUrl) URL.revokeObjectURL(state.productUrl);
    state.productUrl = null;
    state.product = null;
    if (!file) { render(); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      $('reportProduct').value = '';
      render();
      setStatus('请选择 15 MB 以内的 PNG、JPG 或 WebP 图片。', 'error');
      return;
    }
    state.productUrl = URL.createObjectURL(file);
    setStatus('正在处理产品图片……');
    try {
      const image = await imageFrom(state.productUrl);
      if ($('autoMatte').checked) {
        const result = DesignMatte.matteImage(image);
        state.product = result.ok ? result.canvas : image;
        if (!result.ok) setStatus('自动去底未成功，已使用原图；透明底图片效果更好。', 'warn');
      } else state.product = image;
      render();
    } catch {
      state.product = null;
      render();
      setStatus('产品图片无法读取，请换一张图片。', 'error');
    }
  }

  document.querySelectorAll('[data-template]').forEach(button =>
    button.addEventListener('click', () => selectTemplate(button.dataset.template)));
  fields.forEach(id => $(id).addEventListener('input', render));
  $('reportProduct').addEventListener('change', loadProduct);
  $('autoMatte').addEventListener('change', loadProduct);
  $('downloadReport').addEventListener('click', () => {
    if ($('downloadReport').disabled) return;
    const project = data().project.replace(/[\\/:*?"<>|]/g, '').slice(0, 24) || '项目';
    canvas.toBlob(blob => {
      if (!blob) { setStatus('图片导出失败，请重试。', 'error'); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `长缨星河中标喜报-${project}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, 'image/png');
  });
  for (const [tab, pane] of [['engineeringTab', 'engineeringPane'], ['promotionTab', 'promotionPane']]) {
    $(tab).addEventListener('click', () => {
      $('engineeringTab').setAttribute('aria-selected', String(tab === 'engineeringTab'));
      $('promotionTab').setAttribute('aria-selected', String(tab === 'promotionTab'));
      $('engineeringPane').hidden = pane !== 'engineeringPane';
      $('promotionPane').hidden = pane !== 'promotionPane';
    });
  }
  await selectTemplate('starfield');
})();
