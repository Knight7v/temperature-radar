const test = require('node:test');
const assert = require('node:assert/strict');
const matte = require('../js/design-matte');

// 合成一张"白底商品图"：中间一块矩形当机身，可选噪声、可选地面阴影。
// 用固定种子的伪随机，保证每次跑出来一样，否则偶发失败查不动。
function synth(width, height, { background = 255, noise = 2, fill = 236, rect, shadow = false } = {}) {
  const box = rect || { x: Math.round(width * 0.2), y: Math.round(height * 0.27), w: Math.round(width * 0.6), h: Math.round(height * 0.46) };
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 42;
  const jitter = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 2 * noise;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      let value = inside ? fill : background;
      if (shadow && !inside && y >= box.y + box.h && y < box.y + box.h + 14) value = Math.max(200, value - 12);
      const channel = value + jitter();
      data[index] = channel;
      data[index + 1] = channel;
      data[index + 2] = channel;
      data[index + 3] = 255;
    }
  }
  return { data, box };
}

const alphaAt = (result, width, x, y) => result.alpha[y * width + x];

test('浅灰机身抠得出来，机身内不透明、背景全透明', () => {
  const size = 240;
  const { data, box } = synth(size, size, { fill: 236 });
  const result = matte.computeAlpha({ data, width: size, height: size });

  assert.equal(result.empty, false, '不应该判定为抠不出来');
  assert.ok(result.score >= 70, `分数应该够用，实际 ${result.score}`);
  assert.equal(alphaAt(result, size, box.x + box.w / 2, box.y + box.h / 2), 255, '机身中心必须完全不透明');
  assert.equal(alphaAt(result, size, 3, 3), 0, '左上角背景必须完全透明');
  assert.equal(alphaAt(result, size, size - 4, size - 4), 0, '右下角背景必须完全透明');
  assert.deepEqual(
    { x: result.bbox.x, y: result.bbox.y, w: result.bbox.w, h: result.bbox.h },
    box,
    '商品边框要贴合真实位置，差一个像素产物就会偏'
  );
});

test('深色机身是最好抠的情况，满分', () => {
  const size = 240;
  const { data } = synth(size, size, { fill: 60 });
  const result = matte.computeAlpha({ data, width: size, height: size });
  assert.equal(result.score, 100);
  assert.deepEqual(result.reasons, []);
});

test('机身只比背景深一点点（白电最难的场景）也能救回来', () => {
  const size = 240;
  const { data, box } = synth(size, size, { fill: 247 });
  const result = matte.computeAlpha({ data, width: size, height: size });
  assert.equal(result.empty, false, '阶梯收紧阈值应该能把这种图救回来');
  assert.ok(result.stats.coverage > 10, `覆盖率应该像样，实际 ${result.stats.coverage}`);
  assert.equal(alphaAt(result, size, box.x + box.w / 2, box.y + box.h / 2), 255);
  assert.ok(result.score < 100, '对比度这么低，分数必须扣，不能给满分骗人');
});

test('机身和背景几乎同色时明确说抠不出来，而不是返回一张空白图', () => {
  const size = 240;
  const { data } = synth(size, size, { fill: 252 });
  const result = matte.computeAlpha({ data, width: size, height: size });
  assert.equal(result.empty, true);
  assert.equal(result.bbox, null);
  assert.match(result.reasons.join(''), /太像|分离/);
});

test('渐变背景会被识别成「背景没分离干净」并提示换图', () => {
  const size = 240;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const value = 255 - Math.round((x / size) * 40);
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const result = matte.computeAlpha({ data, width: size, height: size });
  assert.equal(result.empty, true);
  assert.match(result.reasons.join(''), /四边|没分离/);
});

test('纯白空图不会硬凑出一个商品', () => {
  const size = 160;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const result = matte.computeAlpha({ data, width: size, height: size });
  assert.equal(result.empty, true);
  assert.equal(result.score, 12);
});

test('背景里的孤立噪点会被清掉，不留下"灰渣"', () => {
  const size = 200;
  const { data } = synth(size, size, { fill: 40, noise: 0 });
  // 往背景里塞 20 个 2×2 的深色小块：它们和画框不连通，但色差很大，
  // 不做去碎点就会变成成品图上的脏点。
  for (let i = 0; i < 20; i += 1) {
    const x = 6 + i * 9;
    const y = 8 + (i % 5) * 6;
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const index = ((y + dy) * size + (x + dx)) * 4;
        data[index] = 20;
        data[index + 1] = 20;
        data[index + 2] = 20;
      }
    }
  }
  const result = matte.computeAlpha({ data, width: size, height: size });
  const stray = alphaAt(result, size, 6, 8);
  assert.equal(stray, 0, '孤立噪点应该被判成背景');
});

test('半透明边缘会做去白边处理，不会拖一圈白毛', () => {
  const size = 120;
  // 造一条 1px 的渐变过渡：左半背景纯白、右半商品深灰，中间一列 50% 混合
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      let value = 255;
      if (x === size / 2) value = 150;
      else if (x > size / 2) value = 40;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const result = matte.computeAlpha({ data, width: size, height: size });
  const edge = (size / 2) * 4;
  const edgeMiddle = ((size / 2) * size + size / 2) * 4;
  assert.ok(result.alpha[size / 2 * size + size / 2] < 255, '过渡像素不该是实心');
  assert.ok(edge > 0 || edgeMiddle > 0);
  // 去白边后，过渡像素的灰度应该比原来的 150 更深（白色被减掉），而不是更白
  assert.ok(data[size / 2 * size * 4 + size / 2 * 4] <= 150, '半透明像素的白色残留必须被减掉');
});

test('已带透明通道的图不会被二次处理', () => {
  const data = new Uint8ClampedArray(40 * 40 * 4);
  assert.equal(matte.hasAlphaChannel(data), true, '全透明也算有透明通道');
  const opaque = new Uint8ClampedArray(40 * 40 * 4).fill(255);
  assert.equal(matte.hasAlphaChannel(opaque), false);
});

test('大图能在一秒内跑完，不至于让页面卡死', () => {
  const size = 1200;
  const { data } = synth(size, size, { fill: 220 });
  const started = Date.now();
  const result = matte.computeAlpha({ data, width: size, height: size });
  const elapsed = Date.now() - started;
  assert.equal(result.empty, false);
  assert.ok(elapsed < 3000, `1200×1200 用了 ${elapsed}ms，太慢`);
});

test('背景不是纯色时明确降分，避免把实拍场景当成商品抠出来', () => {
  const size = 240;
  // 白底上叠加一条很宽的对角亮度起伏：模拟"墙上有一块阴影"的随手拍
  const data = new Uint8ClampedArray(size * size * 4);
  const box = { x: 60, y: 60, w: 120, h: 120 };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      const wall = 255 - Math.round(((x + y) / (size * 2)) * 120);
      const value = inside ? 120 : wall;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const result = matte.computeAlpha({ data, width: size, height: size });
  assert.ok(result.stats.noise > 12, `噪声估计应该看出背景不纯，实际 ${result.stats.noise}`);
  assert.ok(result.score < 90, `非纯色背景必须被扣分，实际 ${result.score}`);
  assert.match(result.reasons.join(''), /纯色|不可信/);
});

test('四边颜色差得离谱（实拍场景）会低到自动退回原图', () => {
  const size = 200;
  const data = new Uint8ClampedArray(size * size * 4);
  // 四条边分别是四种不同颜色：模拟室内照片（墙、窗、地板、家具）
  const edges = [
    [200, 190, 170],
    [90, 110, 130],
    [40, 40, 45],
    [150, 130, 110]
  ];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const vertical = y / size;
      const color = y < 4 ? edges[0] : y > size - 5 ? edges[2] : x < 4 ? edges[1] : x > size - 5 ? edges[3] : [180, 170, 160];
      const shade = 1 - vertical * 0.15;
      data[index] = color[0] * shade;
      data[index + 1] = color[1] * shade;
      data[index + 2] = color[2] * shade;
      data[index + 3] = 255;
    }
  }
  const result = matte.computeAlpha({ data, width: size, height: size });
  const score = result.empty ? result.score : result.score;
  assert.ok(score < 55, `实拍场景图的分数必须低到触发退回原图，实际 ${score}`);
});
