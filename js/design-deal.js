/* 大促主图渲染器（Deal Poster）
 * 与「背景 + 商品 + 底部文案」三段式完全不同，这是一套按区块排版的版式引擎：
 *   品牌角标 / 规格胶囊 / 主标题 / 副标题 / 商品 / 印章角标 / 气流 / 价格条 / 承诺条 / 人像
 * 所有坐标按 1080 基准设计，渲染时统一 scale，改尺寸不用改坐标。
 * 铁律不变：商品永远是用户上传的真实图片，AI 不参与绘制商品与文字。
 */
(function (global) {
  'use strict';

  const BASE = 1080;
  const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Heiti SC",sans-serif';
  const NUMFONT = '"DIN Alternate","Helvetica Neue","Arial Narrow",Arial,sans-serif';

  // 四套配色。背景程序化生成，不依赖任何图片资源，也不会有 AI 乱加元素的问题。
  const THEMES = {
    gold: {
      label: '暖金大促',
      top: '#6f4a20', mid: '#b9874e', low: '#eccf9d', floor: '#f3dcb2',
      glow: 'rgba(255,238,200,0.62)',
      brand: '#c8102e', accent: '#ffd98a', accentDeep: '#9c5a12',
      priceBg: '#2d2a26', footerBg: '#111010',
      serviceInk: 'rgba(60,40,12,0.92)', serviceInkSoft: 'rgba(60,40,12,0.86)',
      ink: '#ffffff'
    },
    crimson: {
      label: '中国红',
      top: '#5c0d0f', mid: '#96181c', low: '#c93a30', floor: '#d94b3c',
      glow: 'rgba(255,196,150,0.5)',
      brand: '#8f0f14', accent: '#ffd98a', accentDeep: '#ffd98a',
      priceBg: '#231012', footerBg: '#120708',
      serviceInk: 'rgba(58,38,10,0.94)', serviceInkSoft: 'rgba(58,38,10,0.86)',
      ink: '#ffffff'
    },
    ice: {
      label: '冰蓝科技',
      top: '#0a2540', mid: '#12507f', low: '#3d8fc4', floor: '#6fb6de',
      glow: 'rgba(190,235,255,0.55)',
      brand: '#0b63b0', accent: '#a9e4ff', accentDeep: '#a9e4ff',
      priceBg: '#0b1c2b', footerBg: '#08131f',
      serviceInk: 'rgba(20,44,62,0.94)', serviceInkSoft: 'rgba(20,44,62,0.86)',
      ink: '#ffffff'
    },
    ink: {
      label: '高级灰',
      top: '#191b1e', mid: '#3a3f45', low: '#8d959e', floor: '#b6bec6',
      glow: 'rgba(255,255,255,0.4)',
      brand: '#b4832a', accent: '#f0cf90', accentDeep: '#8a5f18',
      priceBg: '#101214', footerBg: '#0a0b0c',
      serviceInk: 'rgba(34,26,14,0.94)', serviceInkSoft: 'rgba(34,26,14,0.86)',
      ink: '#ffffff'
    }
  };

  const DEFAULTS = {
    theme: 'gold',
    brand: 'GREE格力',
    brandSub: '纯铜管空调',
    spec: '1.5匹',
    area: '适用：16-20m²',
    title: '硬核新品 风量新升级',
    sub: '新一级能效 | 56℃净菌自洁 | WiFi智控',
    sealTop: '冷凝器',
    sealMain: '纯铜管',
    sealFoot: '真材实料纯铜管',
    rush: '10月20日晚8点开抢：',
    priceInt: '2124',
    priceDec: '15',
    service1Pre: '整机',
    service1Big: '10年',
    service1Post: '免费包修',
    service2Pre: '以旧换新 至高再抵',
    service2Big: '650',
    service2Unit: '元',
    service3Pre: '价保30天 买贵补差',
    service3Big: '30',
    service3Unit: '天',
    footerLeft: '格力空调官方直营',
    footerRight: '真材实料格力造·纯铜管·真省电',
    showAirflow: true,
    showSeal: true,
    showPortrait: true
  };

  /* ---------- 基础工具 ---------- */

  function setFont(ctx, size, weight, family) {
    ctx.font = `${weight} ${size}px ${family || FONT}`;
  }

  // 字号自动收缩到能放进指定宽度
  function fitFont(ctx, text, maxWidth, size, weight, family, minSize) {
    let s = size;
    const floor = minSize || Math.max(12, size * 0.55);
    setFont(ctx, s, weight, family);
    while (s > floor && ctx.measureText(text).width > maxWidth) {
      s -= 2;
      setFont(ctx, s, weight, family);
    }
    return s;
  }

  function centerText(ctx, text, x, y, maxWidth, size, weight, color, family, stroke) {
    const finalSize = fitFont(ctx, text, maxWidth, size, weight, family);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (stroke) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(2, finalSize * 0.055);
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    return finalSize;
  }

  function leftText(ctx, text, x, y, size, weight, color, family) {
    setFont(ctx, size, weight, family);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    return ctx.measureText(text).width;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Array.isArray(r) ? r : [r, r, r, r];
    const [tl, tr, br, bl] = rr;
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
    ctx.lineTo(x + w, y + h - br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    ctx.lineTo(x + bl, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
    ctx.lineTo(x, y + tl);
    ctx.quadraticCurveTo(x, y, x + tl, y);
    ctx.closePath();
  }

  // 确定性的伪随机，保证每次重绘气流形态完全一致（否则改一个字气流就变了）
  function seeded(seed) {
    let s = seed >>> 0;
    return function next() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ---------- 背景 ---------- */

  function paintBackground(ctx, theme) {
    // 上深下亮的竖向渐变，模拟影棚背景纸的漫反射
    const g = ctx.createLinearGradient(0, 0, 0, BASE);
    g.addColorStop(0, theme.top);
    g.addColorStop(0.42, theme.mid);
    g.addColorStop(0.82, theme.low);
    g.addColorStop(1, theme.floor);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BASE, BASE);

    // 左上主光
    const glow = ctx.createRadialGradient(BASE * 0.38, BASE * 0.1, 0, BASE * 0.38, BASE * 0.1, BASE * 0.82);
    glow.addColorStop(0, theme.glow);
    glow.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, BASE, BASE);

    // 顶部压暗做出层次，避免标题糊在亮底上
    const shade = ctx.createLinearGradient(0, 0, 0, BASE * 0.3);
    shade.addColorStop(0, 'rgba(0,0,0,0.28)');
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, BASE, BASE * 0.3);

    // 商品后方的地面高光，让商品有「站在台上」的感觉
    const floorGlow = ctx.createRadialGradient(BASE * 0.5, BASE * 0.68, 0, BASE * 0.5, BASE * 0.68, BASE * 0.5);
    floorGlow.addColorStop(0, 'rgba(255,255,255,0.3)');
    floorGlow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = floorGlow;
    ctx.fillRect(0, BASE * 0.3, BASE, BASE * 0.5);
  }

  /* ---------- 品牌角标 ---------- */

  function drawBrandTag(ctx, cfg, theme) {
    const w = 402;
    const h = 78;
    ctx.save();
    // 左上角直角、右下角斜切一刀，和平台大促角标观感一致
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h - 26);
    ctx.quadraticCurveTo(w, h, w - 32, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = theme.brand;
    ctx.fill();

    // G 图形标
    const cx = 46;
    const cy = h / 2;
    const r = 19;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.22, Math.PI * 1.62);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.lineCap = 'butt';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx + 2, cy - 5, r + 4, 10);

    // 品牌名
    setFont(ctx, 34, 900, '"Arial Black",' + FONT);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cfg.brand, 80, cy + 1);
    const brandW = ctx.measureText(cfg.brand).width;

    // 竖线 + 副标
    const lineX = 92 + brandW;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(lineX, cy - 17, 2, 34);
    setFont(ctx, 26, 600, FONT);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cfg.brandSub, lineX + 16, cy + 1);
    ctx.restore();
  }

  /* ---------- 规格胶囊 ---------- */

  function drawSpecPill(ctx, cfg, theme) {
    const y = 92;
    const h = 66;
    setFont(ctx, 34, 800, FONT);
    const specW = ctx.measureText(cfg.spec).width;
    setFont(ctx, 28, 600, FONT);
    const areaW = ctx.measureText(cfg.area).width;
    const padX = 30;
    const gap = 22;
    const total = padX * 2 + specW + gap * 2 + areaW;
    const x = (BASE - total) / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(60,30,0,0.28)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    roundRect(ctx, x, y, total, h, h / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
    ctx.restore();

    roundRect(ctx, x, y, total, h, h / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    setFont(ctx, 34, 800, FONT);
    ctx.fillStyle = theme.accentDeep;
    ctx.fillText(cfg.spec, x + padX, y + h / 2 + 1);

    const sep = x + padX + specW + gap;
    ctx.fillStyle = 'rgba(120,80,30,0.35)';
    ctx.fillRect(sep, y + 16, 2, h - 32);

    setFont(ctx, 28, 600, FONT);
    ctx.fillStyle = '#4a3a22';
    ctx.fillText(cfg.area, sep + gap, y + h / 2 + 1);
  }

  /* ---------- 标题 ---------- */

  function drawHeadline(ctx, cfg, theme) {
    centerText(ctx, cfg.title, BASE / 2, 232, BASE - 100, 96, 900, theme.ink, FONT, 'rgba(80,42,4,0.55)');

    if (cfg.sub) {
      const parts = String(cfg.sub).split('|').map(s => s.trim()).filter(Boolean);
      const joined = parts.join('  |  ');
      centerText(ctx, joined, BASE / 2, 284, BASE - 130, 36, 600, 'rgba(255,255,255,0.96)');
    }
  }

  /* ---------- 商品 ---------- */

  function paintProduct(ctx, assets, box) {
    const img = assets.product;
    if (!img) {
      ctx.save();
      ctx.setLineDash([16, 14]);
      roundRect(ctx, box.x, box.y, box.w, box.h, 24);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.setLineDash([]);
      centerText(ctx, '上传商品图后出现在这里', box.x + box.w / 2, box.y + box.h / 2 + 14, box.w - 60, 40, 600, 'rgba(255,255,255,0.8)');
      ctx.restore();
      return null;
    }

    // 宽度优先撑满：大促主图里商品就是要横向占满，按高度反算只在超框时生效
    let w = box.w;
    let h = (img.height / img.width) * w;
    if (h > box.h) {
      h = box.h;
      w = (img.width / img.height) * h;
    }
    const x = box.x + (box.w - w) / 2;
    const y = box.y + (box.h - h) / 2;

    // 落地投影，商品才不会像贴纸浮在背景上
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.filter = 'blur(16px)';
    ctx.fillStyle = 'rgba(40,18,0,0.9)';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h * 0.99, w * 0.44, h * 0.075, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 白底商品图直接贴在暖色背景上会露出一块硬白矩形，非常廉价。
    // 处理办法：先垫一层椭圆柔光、再给商品图加白色外发光，让白底"化"成一片光，
    // 方块的四角被同色光晕包住，视觉上就看不出边界了。透明底图不需要这一步。
    if (assets.whiteBackdrop) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = w * 0.6;
      const ry = Math.max(h * 0.66, w * 0.18);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      const halo = ctx.createRadialGradient(0, 0, rx * 0.34, 0, 0, rx);
      halo.addColorStop(0, 'rgba(255,255,255,0.96)');
      halo.addColorStop(0.62, 'rgba(255,252,244,0.9)');
      halo.addColorStop(1, 'rgba(255,248,232,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 白色台卡：白底图去不掉底，就把白底做成一块有意的展示台，
      // 比直接糊一块硬白方块体面得多。换成透明底 PNG 则完全不需要这一步。
      const cx0 = x - 10;
      const cy0 = y - 10;
      const cw = w + 20;
      const ch = h + 20;
      ctx.save();
      ctx.shadowColor = 'rgba(72,38,6,0.3)';
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 16;
      roundRect(ctx, cx0, cy0, cw, ch, 22);
      ctx.fillStyle = '#fdfaf3';
      ctx.fill();
      ctx.restore();

      ctx.save();
      roundRect(ctx, cx0, cy0, cw, ch, 22);
      ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();

      // 台卡描边 + 顶部一道高光，做出亚克力展台的厚度
      ctx.save();
      roundRect(ctx, cx0, cy0, cw, ch, 22);
      ctx.strokeStyle = 'rgba(196,148,80,0.32)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      const topLight = ctx.createLinearGradient(0, cy0, 0, cy0 + ch * 0.22);
      topLight.addColorStop(0, 'rgba(255,255,255,0.85)');
      topLight.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = topLight;
      ctx.fillRect(cx0, cy0, cw, ch * 0.22);
      ctx.restore();
      return { x, y, w, h, carded: true };
    }

    ctx.drawImage(img, x, y, w, h);
    return { x, y, w, h };
  }

  /* ---------- 气流特效 ---------- */

  // 从出风口向下呈扇形扩散的多条光带，用 lighter 混合叠出体积感
  function drawAirflow(ctx, placed, theme, seed) {
    if (!placed) return;
    const cx = placed.x + placed.w / 2;
    // 起点压在台卡下沿之外：叠在白色台卡上会过曝成一团白雾，落在暖背景上才是金色光带
    const startY = placed.y + placed.h * 0.965;
    const halfStart = placed.w * 0.34;
    const spreadX = placed.w * 0.62;
    const fallY = 218;
    const rand = seeded(seed || 20261020);
    const count = 34;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // 打底光锥：一条很宽的柔光，单靠细线会显得单薄
    const cone = ctx.createLinearGradient(cx, startY, cx, startY + fallY * 0.8);
    cone.addColorStop(0, 'rgba(255,232,158,0.62)');
    cone.addColorStop(0.5, 'rgba(255,200,96,0.2)');
    cone.addColorStop(1, 'rgba(255,186,70,0)');
    ctx.beginPath();
    ctx.moveTo(cx - halfStart * 0.85, startY);
    ctx.lineTo(cx + halfStart * 0.85, startY);
    ctx.lineTo(cx + spreadX * 1.15, startY + fallY * 0.8);
    ctx.lineTo(cx - spreadX * 1.15, startY + fallY * 0.8);
    ctx.closePath();
    ctx.fillStyle = cone;
    ctx.fill();

    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const offset = (t - 0.5) * 2; // -1..1
      const jitter = (rand() - 0.5) * 0.1;
      const sx = cx + offset * halfStart + jitter * placed.w * 0.6;
      const ex = cx + (offset + jitter) * spreadX;
      const ey = startY + fallY * (0.6 + rand() * 0.55);
      const ctrlX = cx + offset * spreadX * 0.42;
      const ctrlY = startY + fallY * 0.4;

      const grad = ctx.createLinearGradient(sx, startY, ex, ey);
      grad.addColorStop(0, 'rgba(255,244,196,1)');
      grad.addColorStop(0.2, 'rgba(255,214,120,0.86)');
      grad.addColorStop(0.55, 'rgba(255,186,70,0.34)');
      grad.addColorStop(1, 'rgba(255,170,50,0)');

      ctx.beginPath();
      ctx.moveTo(sx, startY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, ex, ey);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 12 * (0.4 + (1 - Math.abs(offset)) * 0.9) * (0.65 + rand() * 0.75);
      ctx.shadowColor = 'rgba(255,206,104,0.9)';
      ctx.shadowBlur = 22;
      ctx.stroke();
    }

    // 出风口一道亮边，把气流「接」到机器上
    const mouth = ctx.createLinearGradient(cx - halfStart, startY, cx + halfStart, startY);
    mouth.addColorStop(0, 'rgba(255,232,170,0)');
    mouth.addColorStop(0.5, 'rgba(255,250,226,0.95)');
    mouth.addColorStop(1, 'rgba(255,232,170,0)');
    ctx.beginPath();
    ctx.moveTo(cx - halfStart, startY);
    ctx.lineTo(cx + halfStart, startY);
    ctx.strokeStyle = mouth;
    ctx.lineWidth = 10;
    ctx.shadowColor = 'rgba(255,240,190,1)';
    ctx.shadowBlur = 40;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 印章角标 ---------- */

  function drawSeal(ctx, cfg, theme, placed) {
    if (!cfg.showSeal || !cfg.sealMain) return;
    const w = 246;
    const h = 156;
    const cx = placed ? Math.min(BASE - w / 2 - 18, placed.x + placed.w * 0.86) : BASE - w / 2 - 30;
    const cy = placed ? placed.y + placed.h * 0.26 : 360;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-8 * Math.PI / 180);

    // 外层金色描边
    roundRect(ctx, -w / 2 - 7, -h / 2 - 7, w + 14, h + 14, 20);
    ctx.fillStyle = 'rgba(18,16,14,0.95)';
    ctx.fill();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3;
    ctx.stroke();

    // 内层细线框
    roundRect(ctx, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 14);
    ctx.strokeStyle = 'rgba(255,217,138,0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    setFont(ctx, 27, 700, FONT);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cfg.sealTop, 0, -h / 2 + 30);

    setFont(ctx, 54, 900, FONT);
    ctx.fillStyle = theme.accent;
    ctx.shadowColor = 'rgba(255,190,90,0.7)';
    ctx.shadowBlur = 14;
    ctx.fillText(cfg.sealMain, 0, 2);
    ctx.shadowBlur = 0;

    if (cfg.sealFoot) {
      setFont(ctx, 20, 600, FONT);
      const fw = ctx.measureText(cfg.sealFoot).width + 26;
      roundRect(ctx, -fw / 2, h / 2 - 40, fw, 30, 15);
      ctx.fillStyle = 'rgba(255,217,138,0.16)';
      ctx.fill();
      ctx.fillStyle = '#ffe6b8';
      ctx.fillText(cfg.sealFoot, 0, h / 2 - 24);
    }
    ctx.restore();
  }

  /* ---------- 价格条 ---------- */

  function drawPrice(ctx, cfg, theme, hasPortrait) {
    const y = 738;
    const h = 200;
    const leftW = 566;

    // 左侧深色块
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = -4;
    roundRect(ctx, -40, y, leftW + 40, h, [0, 44, 44, 0]);
    ctx.fillStyle = theme.priceBg;
    ctx.fill();
    ctx.restore();

    // 开抢时间
    setFont(ctx, 33, 500, FONT);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fillText(cfg.rush, 36, y + 56);

    // 价格：货币符号 / 整数 / 小数分开排版，价格才有冲击力
    const baseY = y + 176;
    setFont(ctx, 40, 700, NUMFONT);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('¥', 34, baseY - 6);
    const symW = ctx.measureText('¥').width;

    const intSize = fitFont(ctx, cfg.priceInt, 330, 168, 900, NUMFONT, 96);
    setFont(ctx, intSize, 900, NUMFONT);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cfg.priceInt, 34 + symW + 8, baseY);
    const intW = ctx.measureText(cfg.priceInt).width;

    if (cfg.priceDec) {
      setFont(ctx, 52, 700, NUMFONT);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText('.' + cfg.priceDec, 34 + symW + 12 + intW, baseY);
    }

    /* 右侧服务区：垫一块浅底，文字对比在任何配色下都稳定，也不会被气流冲花 */
    const rx = leftW + 20;
    // 有人像时给它让出右下角，否则「650元」「30天」会被人像盖住
    const rightLimit = hasPortrait ? BASE - 210 : BASE - 16;
    const rw = rightLimit - rx;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = -4;
    roundRect(ctx, leftW - 24, y, BASE - leftW + 24, h, [46, 0, 0, 46]);
    const board = ctx.createLinearGradient(leftW, y, BASE, y);
    board.addColorStop(0, 'rgba(255,252,246,0.97)');
    board.addColorStop(1, 'rgba(255,246,232,0.94)');
    ctx.fillStyle = board;
    ctx.fill();
    ctx.restore();

    // 第一条：整机 10年 免费包修
    let cursorX = rx;
    const row1Y = y + 80;
    cursorX += leftText(ctx, cfg.service1Pre, cursorX, row1Y, hasPortrait ? 26 : 30, 600, theme.serviceInk) + 8;
    const bigSize = hasPortrait ? 56 : 70;
    setFont(ctx, bigSize, 900, FONT);
    ctx.fillStyle = theme.accentDeep;
    const bigW = ctx.measureText(cfg.service1Big).width;
    ctx.textAlign = 'left';
    ctx.fillText(cfg.service1Big, cursorX, row1Y + 4);
    cursorX += bigW + 12;

    if (cfg.service1Post) {
      setFont(ctx, hasPortrait ? 25 : 28, 700, FONT);
      const tagW = ctx.measureText(cfg.service1Post).width + 28;
      roundRect(ctx, cursorX, row1Y - (hasPortrait ? 32 : 36), tagW, hasPortrait ? 42 : 46, 10);
      ctx.fillStyle = '#1f1c18';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(cfg.service1Post, cursorX + tagW / 2, row1Y - 2);
      ctx.textAlign = 'left';
    }

    // 第二、三条：小字 + 大字，各占一行
    const rows = [
      { y: y + 140, pre: cfg.service2Pre, big: cfg.service2Big, unit: cfg.service2Unit },
      { y: y + 186, pre: cfg.service3Pre, big: cfg.service3Big, unit: cfg.service3Unit }
    ];
    rows.forEach(row => {
      let x = rx;
      const preSize = fitFont(ctx, row.pre, rw * 0.62, 24, 500, FONT, 17);
      x += leftText(ctx, row.pre, x, row.y, preSize, 500, theme.serviceInkSoft) + 7;
      setFont(ctx, 44, 900, FONT);
      ctx.fillStyle = theme.accentDeep;
      ctx.fillText(row.big, x, row.y + 2);
      x += ctx.measureText(row.big).width + 3;
      leftText(ctx, row.unit || '', x, row.y - 6, 21, 600, theme.serviceInkSoft);
    });
  }

  /* ---------- 底部承诺条 ---------- */

  function drawFooter(ctx, cfg, theme) {
    const y = 938;
    ctx.fillStyle = theme.footerBg;
    ctx.fillRect(0, y, BASE, BASE - y);

    const midY = y + (BASE - y) / 2 + 12;

    // 房子图标
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(36, midY - 12);
    ctx.lineTo(56, midY - 30);
    ctx.lineTo(76, midY - 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(42, midY - 13);
    ctx.lineTo(42, midY + 8);
    ctx.lineTo(70, midY + 8);
    ctx.lineTo(70, midY - 13);
    ctx.stroke();
    ctx.restore();

    const leftW = leftText(ctx, cfg.footerLeft, 92, midY + 5, 36, 700, '#ffffff');

    // 分隔竖线
    const sepX = 92 + leftW + 40;
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(sepX, y + 30, 2, BASE - y - 60);

    // 盾牌 + 右侧文案
    const sx = sepX + 34;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx + 20, midY - 26);
    ctx.lineTo(sx + 40, midY - 18);
    ctx.lineTo(sx + 40, midY + 4);
    ctx.quadraticCurveTo(sx + 40, midY + 20, sx + 20, midY + 28);
    ctx.quadraticCurveTo(sx, midY + 20, sx, midY + 4);
    ctx.lineTo(sx, midY - 18);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = theme.footerBg;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx + 11, midY + 1);
    ctx.lineTo(sx + 18, midY + 8);
    ctx.lineTo(sx + 30, midY - 9);
    ctx.stroke();
    ctx.restore();

    leftText(ctx, cfg.footerRight, sx + 58, midY + 5, 31, 600, 'rgba(255,255,255,0.95)');
  }

  /* ---------- 人像 ---------- */

  function drawPortrait(ctx, cfg, assets, theme) {
    if (!cfg.showPortrait || !assets.portrait) return;
    const img = assets.portrait;
    const d = 208;
    const cx = BASE - d / 2 - 16;
    const cy = 878;

    ctx.save();
    // 圆形裁切 + 圆形底衬，避免人像方图露出白边
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    const g = ctx.createRadialGradient(cx, cy, d * 0.2, cx, cy, d * 0.5);
    g.addColorStop(0, 'rgba(255,236,200,0.9)');
    g.addColorStop(1, 'rgba(255,210,150,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - d / 2, cy - d / 2, d, d);
    const scale = Math.max(d / img.width, d / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,236,200,0.9)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 主渲染 ---------- */

  function render(ctx, size, cfg, assets) {
    const theme = THEMES[cfg.theme] || THEMES.gold;
    const k = size / BASE;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.scale(k, k);

    paintBackground(ctx, theme);
    drawHeadline(ctx, cfg, theme);

    const box = { x: 34, y: 300, w: BASE - 68, h: 322 };
    const placed = paintProduct(ctx, assets, box);

    if (cfg.showAirflow) drawAirflow(ctx, placed, theme, 20261020);
    drawSeal(ctx, cfg, theme, placed);
    drawPrice(ctx, cfg, theme, Boolean(cfg.showPortrait && assets.portrait));
    drawPortrait(ctx, cfg, assets, theme);
    drawFooter(ctx, cfg, theme);
    drawBrandTag(ctx, cfg, theme);
    drawSpecPill(ctx, cfg, theme);

    ctx.restore();
  }

  /* ---------- 合规检查 ---------- */

  function checks(cfg, size) {
    const rows = [];
    rows.push({ label: '尺寸', ok: size >= 800, text: `${size} × ${size}` });
    const hasPrice = Boolean(String(cfg.priceInt || '').trim());
    rows.push({ label: '价格', ok: hasPrice, text: hasPrice ? `¥${cfg.priceInt}.${cfg.priceDec || '00'}` : '未填写价格' });
    const titleLen = Array.from(String(cfg.title || '')).length;
    rows.push({ label: '主标题', ok: titleLen > 0 && titleLen <= 14, text: `${titleLen} 字 / 建议 ≤14 字` });
    const sealOk = !cfg.showSeal || Boolean(String(cfg.sealMain || '').trim());
    rows.push({ label: '印章角标', ok: sealOk, text: cfg.showSeal ? (cfg.sealMain || '未填写') : '已关闭' });
    rows.push({
      label: '投放位置',
      ok: false,
      level: 'warn',
      text: '大促图不要当京东第 1 张主图，会被判牛皮癣；放第 2-5 张或详情页'
    });
    return rows;
  }

  global.DealKit = { render, checks, THEMES, DEFAULTS, BASE };
})(window);
