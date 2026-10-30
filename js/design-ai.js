// 视觉设计三页共用的 AI 作图客户端与画布工具。
// 约定：所有网络请求走 session.authorizedFetch，Key 永远不进浏览器。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesignAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(session) {
    async function json(url, init) {
      const response = await session.authorizedFetch(url, init);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = Error(typeof body.error === 'string' ? body.error : '作图服务暂不可用');
        error.status = response.status;
        error.code = body.code || '';
        throw error;
      }
      return body.data;
    }
    const post = (action, payload) =>
      json(`/api/design?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      });
    const qs = params => {
      const search = new URLSearchParams();
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) search.set(key, value);
      });
      const text = search.toString();
      return text ? `&${text}` : '';
    };
    return {
      meta: () => json('/api/design?action=meta'),
      scenes: () => json('/api/design?action=scenes'),
      verify: () => json('/api/design?action=verify'),
      usage: month => json(`/api/design?action=usage${month ? `&month=${encodeURIComponent(month)}` : ''}`),
      draftPrompt: payload => post('prompt', payload),
      generate: payload => post('generate', payload),
      refineMatte: payload => post('matting', payload),
      assets: params => json(`/api/design?action=assets${qs(params)}`),
      assetSave: payload => post('asset-save', payload),
      assetUpdate: payload => post('asset-update', payload),
      assetDelete: payload => post('asset-delete', payload),
      assetsZip: params => json(`/api/design?action=assets-zip${qs(params)}`)
    };
  }

  // 统一加载图片。生成接口可能返回 url 或 dataUrl，两种都吃。
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      if (!src) return reject(Error('缺少图片地址'));
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(Error('图片加载失败'));
      image.src = src;
    });
  }

  // 背景铺满画布（cover 语义）：保证不留白，超出部分居中裁掉。
  function drawCover(ctx, image, width, height) {
    const scale = Math.max(width / image.width, height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  }

  // 等比完整放进指定框（contain 语义），商品图绝不能被裁。
  function fitInto(image, box) {
    const scale = Math.min(box.w / image.width, box.h / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }

  // 商品包围盒检测：用来算「商品占比」和自动裁掉多余白边。
  // 优先用透明通道（已抠图），否则拿图片四角的中位色当背景色做色差判断。
  // 返回 null 表示判断不出来（比如商品和背景颜色接近），此时页面不该硬报违规。
  function analyze(image, { tolerance = 26, step = 2 } = {}) {
    const canvas = document.createElement('canvas');
    const width = (canvas.width = image.width);
    const height = (canvas.height = image.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    let data;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch {
      return null;
    }

    // 透明底判定：抽 1/7 的像素数透明度，超过 0.5% 有透明就认为这张图被抠过。
    // 只抽样头几个像素会漏判，因为边缘透明而中心不透明的情况很常见。
    let transparent = 0;
    let sampled = 0;
    for (let i = 3; i < data.length; i += 4 * 7) {
      sampled += 1;
      if (data[i] < 250) transparent += 1;
    }
    const hasAlpha = sampled > 0 && transparent / sampled > 0.005;

    const px = (x, y) => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };

    // 四角取样求背景色；透明底则跳过
    let bg = null;
    if (!hasAlpha) {
      const corners = [px(1, 1), px(width - 2, 1), px(1, height - 2), px(width - 2, height - 2)];
      bg = [0, 1, 2].map(channel => {
        const values = corners.map(c => c[channel]).sort((a, b) => a - b);
        return (values[1] + values[2]) / 2;
      });
    }

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let hits = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        let foreground;
        if (hasAlpha) {
          foreground = data[i + 3] > 12;
        } else {
          foreground =
            Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > tolerance * 3;
        }
        if (!foreground) continue;
        hits += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < 0 || hits < 12) return null;
    // 前景几乎铺满整张图，说明没有明显背景（大概率是场景实拍图），不可信
    const ratio = hits / ((width / step) * (height / step));
    if (ratio > 0.97) return null;

    const bbox = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    return {
      bbox,
      mode: hasAlpha ? 'alpha' : 'chroma',
      background: bg,
      fill: (bbox.w * bbox.h) / (width * height)
    };
  }

  // 从原图里把商品主体裁出来，去掉多余白边。检测失败时原样返回。
  function cropToContent(image, analysis) {
    if (!analysis || !analysis.bbox) return image;
    const { x, y, w, h } = analysis.bbox;
    if (w < 8 || h < 8) return image;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(image, x, y, w, h, 0, 0, w, h);
    return canvas;
  }

  // 按当前 ctx.font 排一次行。中文没有空格，只能逐字符断。
  // 返回 overflow 表示内容是否没排完（需要缩小字号或截断）。
  function layout(ctx, text, maxWidth, maxLines) {
    const chars = Array.from(String(text || ''));
    const lines = [];
    let line = '';
    let index = 0;
    for (; index < chars.length; index += 1) {
      const char = chars[index];
      if (line && ctx.measureText(line + char).width > maxWidth) {
        if (lines.length === maxLines - 1) return { lines: [...lines, line], overflow: true };
        lines.push(line);
        line = '';
      }
      line += char;
    }
    if (line) lines.push(line);
    return { lines, overflow: false };
  }

  // 先找能把整段话排完的最大字号；到最小字号还排不完才截断加省略号。
  function autoFont(ctx, text, { maxWidth, maxLines, size, min = 12, weight = 600, family = 'sans-serif' }) {
    const floor = Math.max(min, Math.round(size * 0.5));
    for (let font = Math.round(size); font >= floor; font -= 1) {
      ctx.font = `${weight} ${font}px ${family}`;
      const result = layout(ctx, text, maxWidth, maxLines);
      if (!result.overflow) return { lines: result.lines, font };
    }
    ctx.font = `${weight} ${floor}px ${family}`;
    const clipped = layout(ctx, text, maxWidth, maxLines);
    const lines = clipped.lines.slice();
    const lastIndex = lines.length - 1;
    if (lastIndex >= 0) {
      let last = lines[lastIndex];
      while (last && ctx.measureText(`${last}…`).width > maxWidth) last = Array.from(last).slice(0, -1).join('');
      lines[lastIndex] = `${last}…`;
    }
    return { lines, font: floor, clipped: true };
  }

  // 根据拟合出的字号画多行文字，返回实际结束的 y，便于连续排版。
  function drawLines(ctx, lines, x, y, lineHeight) {
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
    return y + (lines.length - 1) * lineHeight;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // 说明：这里刻意不做「按颜色抠图」。
  // 空调本身就是白的，白底图上机身和背景色差只有个位数，色差法必然把机身一起抠掉。
  // 要真正抠干净得靠 AI 抠图模型，本地没有也不该在这条链路上硬凑。
  // 所以策略是：透明底（已抠好的 PNG）直接叠；白底图走「白卡展台」，见 design.js。

  return { create, loadImage, drawCover, fitInto, analyze, cropToContent, layout, drawLines, autoFont, download };
});
