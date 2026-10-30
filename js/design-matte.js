// 商品抠图（本机版）：把白底/纯色底商品图变成透明底 PNG。
//
// 为什么不用「按颜色抠」的老办法：空调本身就是白的，白底图里机身和背景只差个位数，
// 全局色差阈值一定会把机身一起抠掉——这条路之前试过两次都失败。
//
// 这里换的是「从画框四边往里灌水」的思路：
//   只有和画面边缘连通的背景色才被删掉，被商品包在里面的白色（机身正面、面板）永远不动。
// 再叠三步收尾，解决白色家电最难看的三件事：
//   ① 软边带    边缘保留 1px 过渡，不是硬切出来的锯齿
//   ② 去白边    半透明边缘按「前景 = (像素 - 背景×余量) ÷ 透明度」反推，白色残留被算掉
//   ③ 边缘收口  对极淡的过渡提一把 gamma，避免一圈灰白毛边
//
// 核心算法只吃 RGBA 数组，不碰 DOM，所以能在 Node 里直接单测（见 tests/design-matte.test.js）。
// 浏览器里再包一层 canvas，负责缩放、输出和评分文案。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesignMatte = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
  }

  // 背景色只能从画框边缘取样：商品图的主体永远在中间，四边一定压着背景。
  // 用中位数而不是平均值——边缘万一带一条阴影或水印，平均值会被拉偏。
  function estimateBackground(data, width, height) {
    const rs = [];
    const gs = [];
    const bs = [];
    const ring = Math.max(1, Math.min(3, Math.floor(Math.min(width, height) / 40)));
    const push = (x, y) => {
      const i = (y * width + x) * 4;
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    };
    for (let y = 0; y < height; y += 1) {
      for (let d = 0; d < ring; d += 1) {
        push(clamp(d, 0, width - 1), y);
        push(clamp(width - 1 - d, 0, width - 1), y);
      }
    }
    for (let x = 0; x < width; x += 1) {
      for (let d = 0; d < ring; d += 1) {
        push(x, clamp(d, 0, height - 1));
        push(x, clamp(height - 1 - d, 0, height - 1));
      }
    }
    const bg = [median(rs), median(gs), median(bs)];
    // 噪声 = 边缘像素相对背景色的典型偏差。手机拍的图和压缩狠的 JPG 噪声大，
    // 阈值必须跟着放宽，否则背景留一层雪花点。
    const diffs = rs.map((r, index) =>
      Math.max(Math.abs(r - bg[0]), Math.abs(gs[index] - bg[1]), Math.abs(bs[index] - bg[2]))
    );
    return { bg, noise: median(diffs) };
  }

  // 色差用「三通道最大差」而不是欧氏距离：白底图上浅灰机身的三个通道同时差十几，
  // 最大差能稳稳识别；用平方和会把噪声放大成误判。
  function diffAt(data, index, bg) {
    const dr = data[index] - bg[0];
    const dg = data[index + 1] - bg[1];
    const db = data[index + 2] - bg[2];
    return Math.max(dr < 0 ? -dr : dr, dg < 0 ? -dg : dg, db < 0 ? -db : db);
  }

  // 从四边做一次四连通洪水填充，返回「哪些像素是背景」。
  // 单独抽出来是因为低对比场景要拿不同阈值试几遍，见 computeAlpha 里的阶梯逻辑。
  function flood(data, width, height, bg, tolerance) {
    const total = width * height;
    const isBg = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    let count = 0;

    const seed = index => {
      if (isBg[index]) return;
      if (diffAt(data, index * 4, bg) > tolerance) return;
      isBg[index] = 1;
      count += 1;
      queue[tail++] = index;
    };

    for (let x = 0; x < width; x += 1) {
      seed(x);
      if (height > 1) seed((height - 1) * width + x);
    }
    for (let y = 0; y < height; y += 1) {
      seed(y * width);
      if (width > 1) seed(y * width + width - 1);
    }

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1
      ];
      for (const n of neighbours) {
        if (n < 0 || isBg[n]) continue;
        if (diffAt(data, n * 4, bg) > tolerance) continue;
        isBg[n] = 1;
        count += 1;
        queue[tail++] = n;
      }
    }
    return { isBg, count };
  }

  // 去碎点：背景噪声在严格阈值下会留下一些孤立的实心小点，
  // 合成到场景里就是一圈"灰渣"。只保留最大的若干块，其余按背景处理。
  function despeckle(isBg, width, height, keepRatio = 0.02) {
    const total = width * height;
    const comp = new Int32Array(total).fill(-1);
    const sizes = [];
    const queue = new Int32Array(total);
    let next = 0;

    for (let start = 0; start < total; start += 1) {
      if (isBg[start] || comp[start] !== -1) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      comp[start] = next;
      let size = 0;
      while (head < tail) {
        const index = queue[head++];
        size += 1;
        const x = index % width;
        const y = (index - x) / width;
        if (x > 0 && !isBg[index - 1] && comp[index - 1] === -1) {
          comp[index - 1] = next;
          queue[tail++] = index - 1;
        }
        if (x < width - 1 && !isBg[index + 1] && comp[index + 1] === -1) {
          comp[index + 1] = next;
          queue[tail++] = index + 1;
        }
        if (y > 0 && !isBg[index - width] && comp[index - width] === -1) {
          comp[index - width] = next;
          queue[tail++] = index - width;
        }
        if (y < height - 1 && !isBg[index + width] && comp[index + width] === -1) {
          comp[index + width] = next;
          queue[tail++] = index + width;
        }
      }
      sizes.push(size);
      next += 1;
    }

    if (!sizes.length) return { removed: 0, largest: 0 };
    const largest = Math.max(...sizes);
    const floor = Math.max(24, Math.round(largest * keepRatio));
    let removed = 0;
    for (let index = 0; index < total; index += 1) {
      const id = comp[index];
      if (id < 0 || isBg[index]) continue;
      if (sizes[id] < floor) {
        isBg[index] = 1;
        removed += 1;
      }
    }
    return { removed, largest };
  }

  /**
   * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number, tolerance?: number, softness?: number}} input
   * 注意：data 会被就地修改（边缘去白边），这是为了让调用方省掉一次全图拷贝。
   * @returns {{alpha: Uint8Array, score: number, reasons: string[], stats: object, bbox: object|null, empty: boolean}}
   */
  function computeAlpha(input) {
    const { data, width, height } = input;
    const started = Date.now();
    const total = width * height;
    if (!total) {
      return { alpha: new Uint8Array(0), score: 0, reasons: ['图片尺寸异常'], stats: {}, bbox: null, empty: true };
    }

    const { bg, noise } = estimateBackground(data, width, height);
    // 阈值随噪声浮动：干净截图约 10~14，手机实拍约 20~30。上限 34 是为了防止
    // 阈值大到把浅色机身也当成背景。
    const primary = clamp(Number(input.tolerance) || Math.round(10 + noise * 3), 10, 34);
    const softness = clamp(Number(input.softness) || 18, 6, 48);

    // 阶梯重试：白电最常见的情况是「机身 #F7F7F7、背景 #FFFFFF」，色差只有 8，
    // 比噪声大不了多少。一次阈值失败不代表抠不出来——把阈值收紧再试，
    // 能救回来的图很多，救不回来才有资格说"这张图抠不了"。
    //
    // 判定必须放在"去碎点之后"：阈值放得太松时，机身被一起吃掉了，
    // 剩下几个噪声点会让占比看起来不是 0，从而骗过检查。
    const ladders = [primary, Math.max(6, Math.round(primary * 0.6)), Math.max(4, Math.round(primary * 0.32))];
    let isBg = null;
    let chosenTolerance = primary;
    let fgCount = 0;

    for (const tolerance of ladders) {
      const trial = flood(data, width, height, bg, tolerance);
      const removed = despeckle(trial.isBg, width, height).removed;
      const coverage = (total - trial.count - removed) / total;
      isBg = trial.isBg;
      chosenTolerance = tolerance;
      fgCount = total - trial.count - removed;
      if (coverage >= 0.02 && coverage <= 0.95) break;
    }

    const coverage = fgCount / total;

    // 四边有多少像素算成了"商品"。真商品图最多贴住一条边（比如挂机顶到画面上缘），
    // 三条边以上基本可以断定是背景没分离干净（渐变底、实拍场景）。
    let borderPixels = 0;
    let borderFg = 0;
    for (let x = 0; x < width; x += 1) {
      borderPixels += 2;
      if (!isBg[x]) borderFg += 1;
      if (height > 1 && !isBg[(height - 1) * width + x]) borderFg += 1;
    }
    for (let y = 1; y < height - 1; y += 1) {
      borderPixels += 2;
      if (!isBg[y * width]) borderFg += 1;
      if (width > 1 && !isBg[y * width + width - 1]) borderFg += 1;
    }
    const borderTouch = borderFg / Math.max(1, borderPixels);

    const empty = coverage < 0.02 || coverage > 0.95 || borderTouch > 0.35;
    if (empty) {
      return {
        alpha: new Uint8Array(total),
        score: 12,
        reasons: [
          borderTouch > 0.35
            ? '画面四边都是「商品」，像是背景没分离干净：请用纯白/纯色底的棚拍图'
            : '没分离出商品主体：背景可能是渐变、实拍场景，或商品和背景太像'
        ],
        empty: true,
        bbox: null,
        stats: {
          coverage: Math.round(coverage * 1000) / 10,
          contrast: 0,
          softRatio: 0,
          borderTouch: Math.round(borderTouch * 1000) / 10,
          tolerance: chosenTolerance,
          noise: Math.round(noise * 10) / 10,
          backgroundColor: bg.map(value => Math.round(value)),
          ms: Date.now() - started
        }
      };
    }

    const alpha = new Uint8Array(total);
    alpha.fill(255);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let soft = 0;
    let contrastSum = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (isBg[index]) {
          alpha[index] = 0;
          continue;
        }
        const base = index * 4;
        const diff = diffAt(data, base, bg);
        contrastSum += diff;

        // 贴着背景的那一圈是过渡带：透明度按色差在 0→1 之间插值，
        // 这样弯角不会出现一串台阶。
        let touching = false;
        if (x > 0 && isBg[index - 1]) touching = true;
        else if (x < width - 1 && isBg[index + 1]) touching = true;
        else if (y > 0 && isBg[index - width]) touching = true;
        else if (y < height - 1 && isBg[index + width]) touching = true;

        if (touching) {
          const t = clamp((diff - chosenTolerance) / softness, 0, 1);
          // 提一把 gamma，把极淡的过渡压掉：白电的毛边就藏在这段里
          alpha[index] = Math.round(Math.pow(t, 1.25) * 255);
          if (alpha[index] > 0 && alpha[index] < 255) soft += 1;
        }
        if (alpha[index] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // 去白边：半透明像素是「商品色 × a + 背景色 × (1-a)」的混合，
    // 已知背景色和透明度就能反推商品本色，白色残留被减掉。
    for (let index = 0; index < total; index += 1) {
      const a = alpha[index];
      if (!a || a === 255) continue;
      const ratio = a / 255;
      const base = index * 4;
      for (let c = 0; c < 3; c += 1) {
        const mixed = data[base + c];
        const pure = (mixed - bg[c] * (1 - ratio)) / ratio;
        data[base + c] = clamp(Math.round(pure), 0, 255);
      }
    }

    const contrast = fgCount ? contrastSum / fgCount : 0;
    const softRatio = fgCount ? soft / fgCount : 0;

    // 评分：不是给"好看程度"打分，而是回答一个问题——"这个结果敢不敢直接用"。
    // 任何一项触发都会在 reasons 里说人话，前端原样显示给运营看。
    const reasons = [];
    let score = 100;

    if (contrast < 28) {
      const penalty = Math.min(32, Math.round(32 - contrast));
      score -= penalty;
      reasons.push('商品与背景颜色接近，边界可能不干净');
    }
    // 四边取样颜色的离散程度，是「这张图到底是不是棚拍白底」最便宜的判据：
    // 真棚拍图四边几乎一个色（噪声个位数），随手拍的场景图四边会差出几十个色阶。
    // 用真实场景图实测过：客厅照 noise 26、卧室照 37，白底商品图通常 < 8。
    if (noise > 12) {
      score -= Math.min(32, Math.round((noise - 12) * 3));
      reasons.push('背景不是纯色（画面四边颜色差别很大），这样抠出来的边界不可信');
    }
    if (borderTouch > 0.01) {
      score -= Math.min(34, Math.round(borderTouch * 220));
      reasons.push('商品贴到了画面边缘，可能被裁掉一部分');
    }
    if (softRatio > 0.05) {
      score -= Math.min(24, Math.round((softRatio - 0.05) * 260));
      reasons.push('边缘过渡过宽，像是带渐变或阴影的背景');
    }
    score = clamp(Math.round(score), 0, 100);

    return {
      alpha,
      score,
      reasons,
      empty,
      bbox: maxX >= minX ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
      stats: {
        coverage: Math.round(coverage * 1000) / 10,
        contrast: Math.round(contrast * 10) / 10,
        softRatio: Math.round(softRatio * 1000) / 10,
        borderTouch: Math.round(borderTouch * 1000) / 10,
        tolerance: chosenTolerance,
        noise: Math.round(noise * 10) / 10,
        backgroundColor: bg.map(value => Math.round(value)),
        ms: Date.now() - started
      }
    };
  }

  function hasAlphaChannel(data) {
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4 * 7) {
      if (data[i] < 250) transparent += 1;
    }
    return transparent > 8;
  }

  // 浏览器侧：缩放 → 抠图 → 应用 alpha → 裁掉多余空白 → 返回 canvas。
  // 缩放上限 2000px：成品图最大 1600，留一点余量就够，再大只是白占内存。
  function matteImage(image, { maxSide = 2000 } = {}) {
    const source = document.createElement('canvas');
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    source.width = width;
    source.height = height;
    const sctx = source.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(image, 0, 0, width, height);

    let imageData;
    try {
      imageData = sctx.getImageData(0, 0, width, height);
    } catch {
      return { ok: false, score: 0, reasons: ['浏览器不允许读取这张图的像素，请换一张或改用服务端抠图'], canvas: null };
    }

    // 已经是透明底的图不用再抠，直接用原图，避免二次处理把边缘磨毛
    if (hasAlphaChannel(imageData.data)) {
      return { ok: true, score: 100, already: true, reasons: [], canvas: source, stats: { coverage: 0, ms: 0 } };
    }

    const result = computeAlpha({ data: imageData.data, width, height });
    if (result.empty) {
      return { ok: false, score: result.score, reasons: result.reasons, canvas: null, stats: result.stats };
    }

    for (let index = 0; index < width * height; index += 1) {
      imageData.data[index * 4 + 3] = result.alpha[index];
    }
    sctx.putImageData(imageData, 0, 0);

    // 裁掉四周多余空白：商品占比是京东首图的硬指标，白边留着会让占比怎么调都不到 70%
    const box = result.bbox || { x: 0, y: 0, w: width, h: height };
    const pad = 2;
    const cut = document.createElement('canvas');
    cut.width = Math.max(1, Math.min(width, box.w + pad * 2));
    cut.height = Math.max(1, Math.min(height, box.h + pad * 2));
    cut
      .getContext('2d')
      .drawImage(source, box.x - pad, box.y - pad, cut.width, cut.height, 0, 0, cut.width, cut.height);

    return {
      ok: true,
      score: result.score,
      reasons: result.reasons,
      stats: result.stats,
      canvas: cut,
      cropped: true
    };
  }

  return { computeAlpha, matteImage, estimateBackground, hasAlphaChannel };
});
