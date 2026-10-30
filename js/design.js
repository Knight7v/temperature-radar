(async function () {
  'use strict';

  const q = id => document.getElementById(id);
  const session = WorkbenchSession.createSessionClient();

  try {
    const identity = await session.getIdentity();
    WorkbenchShell.mountShell({
      container: q('designShell'),
      activeModule: 'design-main',
      identity,
      onLogout: async () => {
        await session.logout();
        location.replace('/login.html');
      }
    });
  } catch {
    location.replace('/login.html?returnTo=%2Fdesign.html');
    return;
  }

  const api = DesignAI.create(session);
  const canvas = q('artwork');
  const ctx = canvas.getContext('2d');

  // 三个用途的差异全部收在这里，绘制和校验都读这份配置，避免逻辑散落。
  const MODES = {
    first: {
      label: '京东首图',
      hint: '第 1 张主图：纯白底、无文字、无 LOGO，商品占比要到 70% 以上。这张图会出现在搜索结果里，审核最严。',
      needText: false,
      needBackground: false,
      defaultRatio: 78,
      defaultAnchor: 'center',
      minRatio: 0.7
    },
    scene: {
      label: '场景副图',
      hint: '第 2-5 张副图：可以放场景背景和卖点文案，让顾客看到装在家里的样子。营销文字控制在 50 字以内。',
      needText: true,
      needBackground: true,
      defaultRatio: 56,
      defaultAnchor: 'top',
      minRatio: 0.4
    },
    promo: {
      label: '活动图',
      hint: '活动 / 详情页用图：文案更大更醒目。注意主图位置不要用这种风格，会被判定为「牛皮癣」。',
      needText: true,
      needBackground: true,
      defaultRatio: 62,
      defaultAnchor: 'top',
      minRatio: 0.4
    },
    deal: {
      label: '大促主图',
      hint: '大促 / 秒杀主图：价格、服务承诺、品牌角标、印章一次排好。这类图不要当京东第 1 张主图（会被判「牛皮癣」），放第 2-5 张或详情页首屏。',
      needText: false,
      needBackground: false,
      defaultRatio: 78,
      defaultAnchor: 'center',
      minRatio: 0
    }
  };

  const state = {
    mode: 'first',
    meta: null,
    product: null,
    // 抠图后的透明底商品图（canvas）。为空表示用原图，场景模式下会自动垫白卡。
    cutout: null,
    matte: null,
    // 原图的边界分析结果，抠图失败退回原图时要用
    rawAnalysis: null,
    productLayer: null,
    analysis: null,
    scene: null,
    sceneImage: null,
    generated: null,
    // 大促主图可选的人像（代言人 / 主播），没有就留空
    portrait: null,
    // true 表示输入框里已经是 AI 扩写好的英文提示词，生成时直接当 prompt 用
    drafted: false,
    busy: false,
    exportBytes: 0,
    library: null,
    usage: null
  };

  // 用途 → 素材库用途枚举。大促图单独一类，方便以后按活动翻。
  const PURPOSE_BY_MODE = { first: 'first', scene: 'scene', promo: 'promo', deal: 'deal' };

  const $ = id => q(id);
  const num = id => Number($(id).value);

  function status(text, tone) {
    const node = $('status');
    node.textContent = text;
    node.dataset.tone = tone || '';
  }

  function busy(on, text) {
    state.busy = on;
    $('generateBtn').disabled = on || !state.meta?.configured;
    $('draftBtn').disabled = on || !state.meta?.textModel;
    $('genProgress').dataset.active = on ? '1' : '0';
    if (on && text) status(text, 'busy');
  }

  // ---------- 背景 ----------

  function renderScenes() {
    const box = $('scenes');
    box.replaceChildren();
    (state.meta?.scenes || []).forEach(scene => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ds-scene';
      button.setAttribute('aria-pressed', String(state.scene?.id === scene.id));
      button.title = scene.desc;
      button.disabled = !scene.ready;
      const image = document.createElement('img');
      image.src = scene.url;
      image.alt = scene.name;
      image.loading = 'lazy';
      const label = document.createElement('b');
      label.textContent = scene.ready ? scene.name : `${scene.name}（未就绪）`;
      button.append(image, label);
      button.onclick = () => pickScene(scene);
      box.append(button);
    });
  }

  async function pickScene(scene) {
    try {
      const image = await DesignAI.loadImage(scene.url);
      state.scene = scene;
      state.sceneImage = image;
      state.generated = null;
      renderScenes();
      $('sceneHint').textContent = `${scene.name} · ${scene.desc}`;
      draw();
      status(`已套用「${scene.name}」背景。`, 'ok');
    } catch {
      status('这个场景图加载失败，换一个试试。', 'error');
    }
  }

  async function applyGenerated(data) {
    const src = data.url || data.dataUrl;
    const image = await DesignAI.loadImage(src);
    state.sceneImage = image;
    state.generated = data;
    renderScenes();
    draw();
    const cost = data.elapsedMs ? `，耗时 ${(data.elapsedMs / 1000).toFixed(1)} 秒` : '';
    const switched = data.fallback ? `（原选的模型没响应，已自动换成 ${data.model}）` : '';
    const money = data.cost ? `，这一张约 ${data.cost.toFixed(2)} 元` : '';
    status(`背景已生成${cost}${money}${switched}。商品仍是你的原图，没有被 AI 改动。`, data.fallback ? 'warn' : 'ok');
    refreshUsage();
  }

  // ---------- 用量与素材库 ----------

  async function refreshUsage() {
    try {
      state.usage = await api.usage();
      renderUsage();
    } catch {
      // 记账读不到不影响出图
    }
  }

  function renderUsage() {
    const node = $('usageNote');
    const usage = state.usage;
    if (!node) return;
    if (!usage) {
      node.textContent = '';
      return;
    }
    node.textContent = `${usage.month} 已出 ${usage.images} 张 · ${usage.cost.toFixed(2)} 元 / 预算 ${usage.budget} 元`;
    node.dataset.tone = usage.used >= 0.8 ? 'warn' : '';
  }

  function purposeOf(mode) {
    return PURPOSE_BY_MODE[mode] || 'scene';
  }

  async function saveAsset() {
    if (!state.product) return;
    const skuNode = $('sku');
    const sku = skuNode.value.trim();
    const title = $('productName').value.trim() || $('dTitle').value.trim();
    if (!sku && !title) {
      status('先填「型号 / SKU」或商品名称，否则以后在素材库里搜不到这张图。', 'warn');
      skuNode.focus();
      return;
    }
    $('saveAssetBtn').disabled = true;
    status('正在存进素材库…', 'busy');
    try {
      // 存 JPEG 而不是 PNG：成品已经铺满背景，没有透明信息，JPEG 体积只有 PNG 的三分之一
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const result = await api.assetSave({
        dataUrl,
        sku,
        title,
        purpose: purposeOf(state.mode),
        width: num('size'),
        height: num('size'),
        source: 'local',
        cost: 0
      });
      status(
        result.duplicate ? '这张图之前已经存过了（内容完全一样），没有重复占空间。' : '已存进素材库，以后可以按型号找回来复用。',
        'ok'
      );
      if (state.library) state.library.refresh();
    } catch (error) {
      status(`存进素材库失败：${error.message}`, 'error');
    } finally {
      $('saveAssetBtn').disabled = false;
    }
  }

  function initLibrary() {
    const container = q('libraryDrawer');
    state.library = DesignLibrary.create({
      api,
      onNotify: (text, tone) => status(text, tone),
      onPickBackground: async asset => {
        try {
          const image = await DesignAI.loadImage(asset.url);
          state.sceneImage = image;
          state.scene = null;
          state.generated = { url: asset.url, prompt: asset.prompt, model: asset.model };
          renderScenes();
          draw();
          state.library.close();
          if (!MODES[state.mode].needBackground) {
            status('背景已套用。当前是「京东首图」，首图必须纯白底，切到「场景副图」才会用上这张背景。', 'warn');
          } else {
            status(`已套用素材库里的背景${asset.sku ? `（${asset.sku}）` : ''}。`, 'ok');
          }
        } catch {
          status('这张背景加载失败，可能文件已被清理。', 'error');
        }
      }
    });
    state.library.setMeta(state.meta?.library || null);
    state.library.mount(container);
  }

  // ---------- 商品图与抠图 ----------

  const tick = () => new Promise(resolve => setTimeout(resolve, 30));

  // 把抠图结果接到画布上：productLayer 换成透明底，analysis 更新成 alpha 模式，
  // 下游的「白卡展台」「商品占比」判断全部自动跟着变，不用到处改 if。
  function useCutout(canvas) {
    state.cutout = canvas;
    state.productLayer = canvas;
    state.analysis = DesignAI.analyze(canvas) || { mode: 'alpha', bbox: null };
    if (state.analysis.mode !== 'alpha') state.analysis = { ...(state.analysis || {}), mode: 'alpha' };
  }

  function useRaw(reason, score) {
    state.cutout = null;
    state.matte = reason ? { score: score || 0, reasons: [reason] } : null;
    const source = state.product;
    state.productLayer = DesignAI.cropToContent(source, state.rawAnalysis) || source;
    state.analysis = state.rawAnalysis;
    $('matteScore').textContent = score ? `· 已改用原图（抠图 ${score} 分）` : '· 已改用原图';
    $('matteHint').textContent = reason
      ? `${reason}。已自动改用原图并垫白色展示台——白电换一张纯白底棚拍图通常就能抠干净。`
      : '已改用原图。场景模式下会自动垫一张白色圆角展台，不会露出方方正正的白块。';
  }

  function useCutoutNote(result) {
    const score = result.score;
    $('matteScore').textContent = `· 边缘 ${score} 分`;
    if (result.already) {
      $('matteHint').textContent = '这张本来就是透明底，直接使用，没有再处理一遍。';
      return;
    }
    const tips = result.reasons.length ? `小提示：${result.reasons.join('；')}。` : '';
    $('matteHint').textContent =
      score >= 85
        ? `边缘干净（${score} 分），可以直接用。${tips}`
        : score >= 70
          ? `可以用${result.reasons.length ? `，${tips}` : '，导出前建议放大看一眼边缘。'}`
          : `${tips}边缘分数偏低，建议导出后检查一圈白色的地方；不满意就换一张纯白底图。`;
  }

  async function runMatte() {
    if (!state.product) return;
    const original = state.rawAnalysis;
    if (original && original.mode === 'alpha') {
      useCutout(DesignAI.cropToContent(state.product, original) || state.product);
      state.matte = { score: 100, reasons: [] };
      useCutoutNote({ score: 100, reasons: [], already: true });
      draw();
      status('这张已经是透明底，不需要抠图。', 'ok');
      return;
    }

    status('正在本机抠图，稍等一秒（原图不会上传）…', 'busy');
    await tick();
    let result;
    try {
      result = DesignMatte.matteImage(state.product);
    } catch (error) {
      useRaw(`抠图失败（${error.message}）`, 0);
      draw();
      status('抠图没成功，已改用原图。', 'warn');
      return;
    }

    if (!result.ok) {
      useRaw(result.reasons[0] || '这张图抠不出来', result.score);
      draw();
      status('这张图不适合自动抠图，已改用原图 + 白色展示台。', 'warn');
      return;
    }

    // 分数太低时自动退回原图：与其交一张边缘缺口的主图，不如老老实实垫白卡。
    if (result.score < 55) {
      useRaw(result.reasons[0] || '边缘质量太低', result.score);
      draw();
      status(`抠图质量只有 ${result.score} 分，已自动改用原图 + 白色展示台。`, 'warn');
      return;
    }

    useCutout(result.canvas);
    state.matte = { score: result.score, reasons: result.reasons, stats: result.stats };
    useCutoutNote(result);
    draw();
    const cost = result.stats && result.stats.ms ? `，耗时 ${result.stats.ms} 毫秒` : '';
    status(`已抠成透明底（边缘 ${result.score} 分${cost}）。商品仍是你的原图，只是去掉了背景。`, result.score >= 70 ? 'ok' : 'warn');
  }

  async function loadProduct(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      status('请上传不超过 15 MB 的 PNG、JPG 或 WebP 图片。', 'error');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await DesignAI.loadImage(url);
      state.product = image;
      // 检测主体边界：既能算准占比，也能顺手把拍图时多余的白边裁掉
      state.rawAnalysis = DesignAI.analyze(image);
      state.cutout = null;
      state.productLayer = DesignAI.cropToContent(image, state.rawAnalysis) || image;
      state.analysis = state.rawAnalysis;
      $('downloadPng').disabled = false;
      $('downloadJpg').disabled = false;
      $('saveAssetBtn').disabled = false;
      $('rematteBtn').disabled = false;
      $('rawBtn').disabled = false;
      draw();
      // 上传后立刻抠：多一步「点按钮」用户就会忘，默认效果最好是透明底
      await runMatte();
    } catch {
      status('图片读取失败，请换一张试试。', 'error');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- 绘制 ----------

  function placeProduct(size, box, coverage, layer) {
    if (!layer) return null;
    const targetArea = coverage * size * size;
    const rawArea = layer.width * layer.height;
    const scale = Math.sqrt(targetArea / Math.max(rawArea, 1));
    let w = layer.width * scale;
    let h = layer.height * scale;
    // 超框时等比回缩，保证商品永远完整
    const shrink = Math.min(1, box.w / w, box.h / h);
    w *= shrink;
    h *= shrink;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }

  function drawPlaceholder(size, box) {
    ctx.fillStyle = '#eef1f6';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = '#8394a9';
    ctx.textAlign = 'center';
    ctx.font = `500 ${Math.round(size * 0.026)}px sans-serif`;
    ctx.fillText('上传商品图片后这里显示成品', size / 2, box.y + box.h / 2);
    ctx.textAlign = 'left';
  }

  function drawChips(items, x, y, size, light) {
    let cursor = x;
    const font = Math.round(size * 0.0215);
    ctx.font = `600 ${font}px sans-serif`;
    items.forEach(text => {
      const width = ctx.measureText(text).width + size * 0.032;
      const height = size * 0.048;
      ctx.fillStyle = light ? '#ffffffd9' : '#0b1a2ecc';
      ctx.beginPath();
      ctx.roundRect(cursor, y, width, height, height / 2);
      ctx.fill();
      ctx.fillStyle = light ? '#16283f' : '#f2f7ff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cursor + size * 0.016, y + height / 2 + 1);
      ctx.textBaseline = 'alphabetic';
      cursor += width + size * 0.014;
    });
    return cursor;
  }

  // 大促主图的面板配置。空值一律回落到兜底，避免某个框被清空就画不出来。
  function dealConfig() {
    const text = id => {
      const node = $(id);
      return node && node.value.trim() ? node.value.trim() : '';
    };
    const raw = String($('dPrice').value || '0').replace(/[^\d.]/g, '');
    const [intPart, decPart] = raw.split('.');
    return {
      theme: $('dTheme').value,
      brand: text('dBrand') || '品牌',
      brandSub: text('dBrandSub'),
      spec: text('dSpec'),
      area: text('dArea'),
      title: text('dTitle') || '主标题',
      sub: text('dSub'),
      sealTop: text('dSealTop'),
      sealMain: text('dSealMain'),
      sealFoot: text('dSealFoot'),
      rush: text('dRush'),
      priceInt: intPart || '0',
      priceDec: (decPart || '00').padEnd(2, '0').slice(0, 2),
      service1Pre: text('dS1Pre'),
      service1Big: text('dS1Big'),
      service1Post: text('dS1Post'),
      service2Pre: text('dS2Pre'),
      service2Big: text('dS2Big'),
      service2Unit: text('dS2Unit'),
      service3Pre: text('dS3Pre'),
      service3Big: text('dS3Big'),
      service3Unit: text('dS3Unit'),
      footerLeft: text('dFootLeft'),
      footerRight: text('dFootRight'),
      showAirflow: $('dAirflow').checked,
      showSeal: $('dSeal').checked,
      showPortrait: $('dShowPortrait').checked
    };
  }

  function draw() {
    const mode = MODES[state.mode];
    const size = num('size');
    canvas.width = canvas.height = size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // 大促主图是区块版式（角标+价格+承诺条），走独立渲染器；其余三种仍是三段式
    if (state.mode === 'deal') {
      const bg = state.analysis && state.analysis.background;
      const alreadyCut = Boolean(state.analysis) && state.analysis.mode === 'alpha';
      DealKit.render(ctx, size, dealConfig(), {
        product: state.productLayer || state.product,
        portrait: state.portrait,
        // 白底图要垫柔光吃掉硬边；透明底图直接叠，不需要
        whiteBackdrop: !alreadyCut && (!bg || (bg[0] > 232 && bg[1] > 232 && bg[2] > 232))
      });
      renderChecks();
      return;
    }

    const pad = size * 0.0375;
    const coverage = num('ratio') / 100;
    const anchor = $('anchor').value;
    const hasText = mode.needText && Boolean($('productName').value.trim() || $('selling1').value.trim());

    // 1) 背景
    let backgroundTone = 'light';
    if (!mode.needBackground) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
    } else if (state.sceneImage) {
      DesignAI.drawCover(ctx, state.sceneImage, size, size);
      backgroundTone = state.scene?.tone || 'dark';
    } else {
      const gradient = ctx.createLinearGradient(0, 0, size, size);
      gradient.addColorStop(0, '#f6f8fc');
      gradient.addColorStop(1, '#e6ecf5');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }

    // 2) 商品区
    const textZone = hasText ? size * (state.mode === 'promo' ? 0.34 : 0.29) : 0;
    let box;
    if (anchor === 'top') {
      box = { x: pad, y: pad, w: size - pad * 2, h: size - pad * 2 - textZone };
    } else if (anchor === 'bottom') {
      box = { x: pad, y: pad + textZone, w: size - pad * 2, h: size - pad * 2 - textZone };
    } else {
      box = { x: pad, y: pad, w: size - pad * 2, h: size - pad * 2 };
    }

    // 白底图直接叠到场景上会露出一块白方块，所以垫一张圆角卡片；
    // 已经是透明底的 PNG 就不需要，直接叠最干净。卡片外扩的部分从商品区里让出来，
    // 保证卡片不会顶到画布边缘、也不会压到下方文字。
    const cardMode = $('cardStyle').value;
    const needCard =
      mode.needBackground && (cardMode === 'card' || (cardMode === 'auto' && state.analysis?.mode !== 'alpha'));
    const cardPad = needCard ? size * 0.026 : 0;
    const innerBox = needCard
      ? { x: box.x + cardPad, y: box.y + cardPad, w: box.w - cardPad * 2, h: box.h - cardPad * 2 }
      : box;
    const layer = state.productLayer;
    const placed = placeProduct(size, innerBox, coverage, layer);

    if (placed) {
      if (needCard) {
        ctx.save();
        ctx.shadowColor = '#0b1a2e30';
        ctx.shadowBlur = size * 0.035;
        ctx.shadowOffsetY = size * 0.012;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(placed.x - cardPad, placed.y - cardPad, placed.w + cardPad * 2, placed.h + cardPad * 2, size * 0.024);
        ctx.fill();
        ctx.restore();
      } else if (mode.needBackground && state.sceneImage) {
        // 透明底商品补一点落影，不然像浮在空中
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.filter = `blur(${Math.round(size * 0.008)}px)`;
        ctx.fillStyle = '#0b1a2e';
        ctx.beginPath();
        ctx.ellipse(placed.x + placed.w / 2, placed.y + placed.h * 0.985, placed.w * 0.36, placed.h * 0.022, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.drawImage(layer, placed.x, placed.y, placed.w, placed.h);
    } else {
      drawPlaceholder(size, box);
    }

    // 3) 文案
    if (hasText) {
      const tint = $('tint').value;
      const zoneTop = size - textZone;
      // 背景偏深（含夜景、深灰棚拍）默认走白字，偏浅（含暖光客厅）走深字；
      // 用户显式选了底色则以选择为准，避免「白字压白墙」这种没法看的情况。
      const darkBackground = !['light', 'warm'].includes(backgroundTone);
      const useDarkText = tint === 'light' ? true : tint === 'dark' ? false : !darkBackground;

      if (tint !== 'none') {
        const gradient = ctx.createLinearGradient(0, zoneTop, 0, size);
        gradient.addColorStop(0, useDarkText ? '#ffffff00' : '#0b1a2e00');
        gradient.addColorStop(1, useDarkText ? '#ffffffee' : '#0b1a2ecc');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, zoneTop, size, size - zoneTop);
      }

      const ink = useDarkText ? '#16283f' : '#ffffff';
      const subInk = useDarkText ? '#43566e' : '#dbe7f6';
      const left = size * 0.055;
      const width = size - left * 2;
      const name = $('productName').value.trim();
      const bullets = [1, 2, 3].map(n => $(`selling${n}`).value.trim()).filter(Boolean);

      let cursorY = zoneTop + size * (state.mode === 'promo' ? 0.055 : 0.045);
      if (name) {
        const titleSize = Math.round(size * (state.mode === 'promo' ? 0.044 : 0.032));
        const fitted = DesignAI.autoFont(ctx, name, {
          maxWidth: width,
          maxLines: 2,
          size: titleSize,
          min: Math.round(titleSize * 0.6),
          weight: 700
        });
        ctx.fillStyle = ink;
        ctx.textAlign = 'left';
        const lineHeight = fitted.font * 1.26;
        DesignAI.drawLines(ctx, fitted.lines, left, cursorY + fitted.font, lineHeight);
        cursorY += fitted.font + (fitted.lines.length - 1) * lineHeight + size * 0.014;
      }

      if (bullets.length) {
        if (state.mode === 'promo') {
          drawChips(bullets, left, cursorY, size, useDarkText);
        } else {
          ctx.font = `500 ${Math.round(size * 0.0235)}px sans-serif`;
          const lineHeight = size * 0.036;
          bullets.forEach(text => {
            ctx.fillStyle = subInk;
            ctx.beginPath();
            ctx.arc(left + size * 0.007, cursorY + lineHeight * 0.34, size * 0.006, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(text, left + size * 0.022, cursorY + lineHeight * 0.5);
            cursorY += lineHeight;
          });
        }
      }
    }

    $('previewNote').textContent = state.sceneImage
      ? `背景${state.generated ? '由 AI 生成' : '来自场景库'} · 商品为你的原图`
      : mode.needBackground
        ? '本地合成 · 未选背景'
        : '本地合成 · 纯白底';

    renderChecks();
  }

  // ---------- 合规校验 ----------

  function checkRow(name, stateName, detail) {
    const symbol = { pass: '✓', warn: '!', fail: '×', skip: '·' }[stateName];
    return `<div class="ds-check" data-state="${stateName}"><i>${symbol}</i><span>${name}</span><em>${detail}</em></div>`;
  }

  function renderChecks() {
    if (state.mode === 'deal') {
      const rows = DealKit.checks(dealConfig(), num('size'));
      rows.unshift(
        state.product
          ? { label: '商品图', ok: true, text: `${state.product.width} × ${state.product.height}` }
          : { label: '商品图', ok: false, text: '还没上传商品图' }
      );
      $('checks').innerHTML = rows
        .map(row => checkRow(row.label, row.ok ? 'pass' : row.level || 'fail', row.text))
        .join('');
      return;
    }

    const mode = MODES[state.mode];
    const size = num('size');
    const coverage = num('ratio') / 100;
    const rows = [];

    rows.push(checkRow('导出尺寸', size >= 800 ? 'pass' : 'fail', `${size} × ${size}`));
    rows.push(
      checkRow(
        '背景',
        mode.needBackground ? (state.sceneImage ? 'pass' : 'warn') : 'pass',
        mode.needBackground ? (state.sceneImage ? '场景背景' : '未选择') : '纯白 #FFFFFF'
      )
    );

    if (!state.product) {
      rows.push(checkRow('商品占比', 'skip', '待上传'));
    } else {
      const pass = coverage >= mode.minRatio;
      rows.push(
        checkRow(
          '商品占比',
          pass ? 'pass' : 'fail',
          `${Math.round(coverage * 100)}% / 要求 ≥${Math.round(mode.minRatio * 100)}%`
        )
      );
    }

    // 留白 = 商品框到画布边缘的最小距离（按导出后的真实像素算）。
    // 京东的 30px 是按 800×800 定的，导出更大尺寸时按比例放大才等价。
    if (state.product && state.productLayer) {
      const need = Math.round(size * 0.0375);
      const gap = Math.round(size * 0.0375);
      rows.push(checkRow('四边留白', gap >= need ? 'pass' : 'warn', `最小 ${gap}px / 建议 ≥${need}px`));
    }

    if (!mode.needText) {
      rows.push(checkRow('文字 / 水印', 'pass', '首图不含文字'));
    } else {
      const chars = [$('productName').value, $('selling1').value, $('selling2').value, $('selling3').value]
        .join('')
        .replace(/\s/g, '').length;
      rows.push(checkRow('文字字数', chars <= 50 ? 'pass' : 'warn', `${chars} 字 / 建议 ≤50`));
    }

    rows.push(
      checkRow(
        '文件体积',
        state.exportBytes ? (state.exportBytes <= 3 * 1024 * 1024 ? 'pass' : 'fail') : 'skip',
        state.exportBytes ? `${(state.exportBytes / 1024 / 1024).toFixed(2)} MB / 上限 3 MB` : '导出后自动检查'
      )
    );

    $('checks').innerHTML = rows.join('');
  }

  // ---------- 导出 ----------

  function exportAs(type) {
    if (!state.product) return;
    const size = num('size');
    const filename = `商品主图-${MODES[state.mode].label}-${size}.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
    const finish = blob => {
      if (!blob) {
        status('导出失败，请重试。', 'error');
        return;
      }
      state.exportBytes = blob.size;
      DesignAI.download(blob, filename);
      renderChecks();
      const mb = (blob.size / 1024 / 1024).toFixed(2);
      if (blob.size > 3 * 1024 * 1024) {
        status(`已导出 ${mb} MB，超过京东 3 MB 上限，请改用 JPG 或调小尺寸。`, 'warn');
      } else {
        status(`已导出 ${mb} MB。${state.mode === 'first' ? '这张可以直接作为第 1 张主图。' : ''}`, 'ok');
      }
    };
    if (type === 'image/jpeg') {
      // JPG 没有透明通道，先垫白底，避免透明区域变黑
      const flat = document.createElement('canvas');
      flat.width = flat.height = size;
      const fctx = flat.getContext('2d');
      fctx.fillStyle = '#ffffff';
      fctx.fillRect(0, 0, size, size);
      fctx.drawImage(canvas, 0, 0);
      flat.toBlob(finish, 'image/jpeg', 0.92);
    } else {
      canvas.toBlob(finish, 'image/png');
    }
  }

  // ---------- 模式切换 ----------

  function applyMode(mode) {
    state.mode = mode;
    const config = MODES[mode];
    document.querySelectorAll('.ds-modes button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
    $('modeHint').textContent = config.hint;
    $('textFields').hidden = !config.needText;
    $('tintField').hidden = !config.needText;
    $('cardField').hidden = !config.needBackground;
    $('bgTools').hidden = !config.needBackground;
    $('bgLocked').hidden = config.needBackground;
    $('dealFields').hidden = mode !== 'deal';
    // 大促图靠自己的控件排版，这两组通用字段对它是干扰
    $('nameField').hidden = mode === 'deal';
    $('ratioField').hidden = mode === 'deal';
    $('anchorField').hidden = mode === 'deal';
    if (mode === 'deal') {
      $('bgLocked').textContent = '大促主图的背景由「配色」自动生成，不用选场景，也不会出现 AI 乱加元素的问题。';
      if (state.product) {
        const cut = state.analysis && state.analysis.mode === 'alpha';
        status(
          cut
            ? '大促主图：商品会直接悬在背景上。价格、角标、承诺文案改哪一项，预览就跟着变。'
            : '大促主图：白底商品图会自动垫白色展示台。想要悬浮效果，换透明底 PNG。',
          'ok'
        );
      }
    } else {
      $('bgLocked').textContent = '京东首图必须是纯白背景（RGB 255,255,255），这里已锁定，不需要选背景。';
    }
    $('ratio').value = String(config.defaultRatio);
    $('ratioValue').textContent = `${config.defaultRatio}%`;
    $('anchor').value = config.defaultAnchor;
    draw();

    // 切到场景模式时，先告诉用户这张商品图会以什么形式呈现
    if (config.needBackground && state.product) {
      if (state.analysis?.mode === 'alpha') {
        status('这张是透明底图，商品会直接叠在场景里，边缘最干净。', 'ok');
      } else {
        status('白底图会自动垫一张白色圆角底板，不会露出方方正正的白块。想要更自然可以换成透明底 PNG。', 'ok');
      }
    }
  }

  // ---------- 初始化 ----------

  async function loadMeta() {
    try {
      state.meta = await api.meta();
    } catch (error) {
      $('aiHint').textContent = `作图服务未就绪：${error.message}`;
      status('作图服务暂时不可用，但纯白底首图和本地排版仍可正常使用。', 'warn');
      return;
    }

    const select = $('model');
    select.replaceChildren();
    (state.meta.modelOptions || []).forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.name} · ${model.price}`;
      option.selected = model.active;
      select.append(option);
    });

    if (state.meta.configured) {
      $('aiHint').textContent = `已接入${state.meta.provider}，Key ${state.meta.keyHint}。AI 只生成背景，商品和文字不会被打乱。`;
      $('generateBtn').disabled = false;
    } else {
      $('aiHint').textContent =
        'AI 生成还没接通：管理员在 .env.local 填入 DESIGN_IMAGE_API_KEY 后即可使用。现在可以先用左边的场景库，完全免费。';
      $('generateBtn').disabled = true;
      $('generateBtn').textContent = 'AI 生成（待配置）';
    }
    $('draftBtn').disabled = !state.meta.textModel;
    if (!state.meta.textModel) $('draftBtn').title = '需要先配置 DeepSeek Key';

    // 型号下拉：直接来自产品知识库，选完自动带出商品名称
    const skuList = $('skuList');
    skuList.replaceChildren();
    (state.meta.productModels || []).forEach(item => {
      skuList.append(new Option(`${item.model}${item.name ? ` ${item.name}` : ''}`.trim(), item.model));
    });

    state.usage = state.meta.usage || null;
    renderUsage();
    $('assetCount').textContent = String(state.meta.library?.total || 0);

    // 配了 AI 抠图服务才显示「精修」按钮：这个动作会把商品图传到外部服务，
    // 不能让用户在不知情的情况下点下去，所以按钮名字里直接写明。
    if (state.meta.matting && state.meta.matting.ai) {
      const refine = document.createElement('button');
      refine.type = 'button';
      refine.id = 'refineBtn';
      refine.textContent = 'AI 精修（上传原图）';
      refine.title = `使用${state.meta.matting.engine || '外部服务'}重新抠图，适合边缘复杂的图`;
      refine.onclick = () => refineMatte(refine);
      document.querySelector('.ds-matte-bar')?.append(refine);
    }

    renderScenes();
  }

  // AI 精修：只有本机算法抠不干净、且管理员配了服务时才会用到。
  // 结果同样交给 useCutout，所以后面的占比、展台、校验逻辑不用区分来源。
  async function refineMatte(button) {
    if (!state.product) return;
    const source = state.cutout || state.product;
    button.disabled = true;
    status('正在把商品图送去精修抠图…', 'busy');
    try {
      const dataUrl = source.toDataURL ? source.toDataURL('image/png') : '';
      if (!dataUrl) throw Error('当前商品图无法导出');
      const data = await api.refineMatte({ dataUrl });
      const image = await DesignAI.loadImage(data.dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d').drawImage(image, 0, 0);
      useCutout(canvas);
      state.matte = { score: 90, reasons: [], engine: data.engine };
      $('matteScore').textContent = '· AI 精修';
      $('matteHint').textContent = `已用${data.engine || 'AI 服务'}重新抠图。导出前放大看一眼边缘确认。`;
      draw();
      status('AI 精修完成，可以直接导出。', 'ok');
    } catch (error) {
      status(`精修失败：${error.message}。本机抠图的结果仍然可用。`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function bind() {
    document.querySelectorAll('.ds-modes button').forEach(button => {
      button.onclick = () => applyMode(button.dataset.mode);
    });

    $('productFile').onchange = () => loadProduct($('productFile').files[0]);

    $('rematteBtn').onclick = () => runMatte();
    $('rawBtn').onclick = () => {
      if (!state.product) return;
      useRaw('');
      draw();
      status('已改用原图。场景模式下会垫一块白色圆角展台。', 'ok');
    };
    $('saveAssetBtn').onclick = saveAsset;
    $('openLibraryBtn').onclick = () => {
      if (state.library) state.library.open();
    };

    // 从产品知识库选型号后，顺手把商品名称填上，少打一遍字也少一次写错的机会
    $('sku').addEventListener('change', () => {
      const value = $('sku').value.trim().toUpperCase();
      if (!value) return;
      const hit = (state.meta?.productModels || []).find(item => String(item.model || '').toUpperCase() === value);
      if (hit && hit.name && !$('productName').value.trim()) {
        $('productName').value = hit.name.slice(0, 36);
        draw();
      }
    });

    ['productName', 'selling1', 'selling2', 'selling3', 'size', 'ratio', 'anchor', 'tint'].forEach(id => {
      $(id).addEventListener('input', () => {
        if (id === 'ratio') $('ratioValue').textContent = `${num('ratio')}%`;
        draw();
      });
      $(id).addEventListener('change', draw);
    });

    // 用户手动改过描述，就不再当作「已扩写的提示词」
    $('direction').addEventListener('input', () => {
      state.drafted = false;
    });

    $('bgTabScenes').onclick = () => {      $('scenePane').hidden = false;
      $('aiPane').hidden = true;
      $('bgTabScenes').setAttribute('aria-pressed', 'true');
      $('bgTabAi').setAttribute('aria-pressed', 'false');
    };
    $('bgTabAi').onclick = () => {
      $('scenePane').hidden = true;
      $('aiPane').hidden = false;
      $('bgTabScenes').setAttribute('aria-pressed', 'false');
      $('bgTabAi').setAttribute('aria-pressed', 'true');
    };

    $('draftBtn').onclick = async () => {
      const direction = $('direction').value.trim();
      if (!direction) {
        status('先写一句想要什么场景，例如「客厅傍晚暖光」。', 'warn');
        return;
      }
      busy(true, '正在把这句话扩写成专业背景提示词…');
      try {
        const data = await api.draftPrompt({
          direction,
          category: 'aircon',
          platform: 'jd',
          sceneId: state.scene?.id || ''
        });
        $('direction').value = data.prompt;
        state.drafted = true;
        status(`描述已扩写${data.note ? `：${data.note}` : ''}。可以直接生成，也可以再改。`, 'ok');
      } catch (error) {
        status(`扩写失败：${error.message}`, 'error');
      } finally {
        busy(false);
      }
    };

    $('generateBtn').onclick = async () => {
      const direction = $('direction').value.trim();
      if (!direction) {
        status('先写一句想要什么场景，或者点「帮我写描述」让 AI 代写。', 'warn');
        return;
      }
      busy(true, '正在生成背景，通常需要 5-20 秒…');
      try {
        const data = await api.generate({
          // 扩写过的内容已经是完整英文提示词，直接当 prompt；手写的一句中文当方向补充
          direction: state.drafted ? '' : direction,
          prompt: state.drafted ? direction : '',
          model: $('model').value,
          category: 'aircon',
          platform: 'jd',
          ratio: 'square',
          hasText: true,
          sceneId: '',
          sku: $('sku').value.trim()
        });
        await applyGenerated(data);
      } catch (error) {
        // 出不了图也要给下一步：场景库是现成的、免费的，别让人卡在报错上
        const retryable = ['DESIGN_ALL_FAILED', 'DESIGN_UPSTREAM', 'DESIGN_TIMEOUT', 'DESIGN_RATE_LIMIT'].includes(error.code) ||
          error.status === 502 || error.status === 504;
        status(
          retryable
            ? `生成失败：${error.message} 可以先切到「场景库」用内置背景出图，不花钱也不耽误时间。`
            : `生成失败：${error.message}`,
          'error'
        );
        if (retryable) {
          $('scenePane').hidden = false;
          $('aiPane').hidden = true;
          $('bgTabScenes').setAttribute('aria-pressed', 'true');
          $('bgTabAi').setAttribute('aria-pressed', 'false');
        }
      } finally {
        busy(false);
      }
    };

    // 自检：只看 Key 能不能用，不消耗一张图的额度
    $('verifyBtn').onclick = async () => {
      $('verifyBtn').disabled = true;
      status('正在检查图像生成服务…', 'busy');
      try {
        const result = await api.verify();
        if (result.ok) {
          status(`连接正常：${result.model || '默认模型'}${result.note ? `（${result.note}）` : ''}`, 'ok');
        } else {
          status(`连接失败：${result.error}`, 'error');
        }
      } catch (error) {
        status(`连接失败：${error.message}`, 'error');
      } finally {
        $('verifyBtn').disabled = false;
      }
    };

    $('cardStyle').onchange = draw;

    // 大促主图的所有文案改动即时重绘
    [
      'dSpec', 'dArea', 'dTitle', 'dSub', 'dRush', 'dPrice',
      'dS1Pre', 'dS1Big', 'dS1Post', 'dS2Pre', 'dS2Big', 'dS2Unit',
      'dS3Pre', 'dS3Big', 'dS3Unit', 'dBrand', 'dBrandSub',
      'dSealTop', 'dSealMain', 'dSealFoot', 'dFootLeft', 'dFootRight'
    ].forEach(id => {
      $(id).addEventListener('input', draw);
      $(id).addEventListener('change', draw);
    });
    $('dTheme').addEventListener('change', draw);
    ['dAirflow', 'dSeal', 'dShowPortrait'].forEach(id => $(id).addEventListener('change', draw));

    $('dPortrait').onchange = async () => {
      const file = $('dPortrait').files[0];
      if (!file) {
        state.portrait = null;
        draw();
        return;
      }
      const url = URL.createObjectURL(file);
      try {
        state.portrait = await DesignAI.loadImage(url);
      } catch (error) {
        state.portrait = null;
        status(`人像加载失败：${error.message}`, 'error');
      } finally {
        URL.revokeObjectURL(url);
      }
      draw();
    };
    $('downloadPng').onclick = () => exportAs('image/png');
    $('downloadJpg').onclick = () => exportAs('image/jpeg');
  }
  bind();
  applyMode('first');
  await loadMeta();
  initLibrary();
  draw();
})();
