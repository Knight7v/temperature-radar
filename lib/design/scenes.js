'use strict';

// 内置场景库：随仓库分发的背景图，不依赖任何 API Key。
// 用途是让「没配 Key」的时候也能立刻出图，配了 Key 之后再做自定义场景。
//
// 字段说明：
//   id      前端与接口使用的稳定标识，不要改（改了等于让历史记录失效）
//   file    assets/design/scenes/ 下的文件名
//   tone    整体色调，前端用来给文字配自动对比色
//   zone    商品建议摆放区（相对画布 0-1 的比例），前端据此给默认构图
//   prompt  重新生成这张背景时用的提示词，留档用；不参与日常出图

const SCENES = Object.freeze([
  {
    id: 'living-bright',
    name: '明亮客厅',
    tag: '最常用',
    desc: '浅色墙面 + 木地板，墙面大面积留白，适合挂机 / 柜机',
    tone: 'light',
    zone: { x: 0.16, y: 0.2, w: 0.68, h: 0.52 },
    file: 'living-bright.jpg',
    prompt:
      'Empty bright modern living room interior, soft daylight from window on the left, light warm gray wall with large clean empty area, oak wood floor, hint of linen sofa at the edge, minimalist, photorealistic interior photography, 50mm lens, soft natural shadows, no text, no logo, no people, no product, no furniture in center'
  },
  {
    id: 'living-warm',
    name: '暖光客厅',
    tag: '温暖居家',
    desc: '暖米色墙面 + 落地灯氛围，适合强调舒适送风',
    tone: 'warm',
    zone: { x: 0.14, y: 0.18, w: 0.72, h: 0.54 },
    file: 'living-warm.jpg',
    prompt:
      'Warm cozy living room interior at golden hour, beige wall with generous empty space, warm ambient floor lamp glow, soft shadows, light wood floor, minimal decor at frame edges, photorealistic interior photography, no text, no logo, no people, no product, clean center'
  },
  {
    id: 'bedroom-calm',
    name: '静谧卧室',
    tag: '卧室场景',
    desc: '雾霾蓝墙面 + 柔和床品一角，适合静音卖点',
    tone: 'cool',
    zone: { x: 0.18, y: 0.16, w: 0.64, h: 0.56 },
    file: 'bedroom-calm.jpg',
    prompt:
      'Calm bedroom interior with muted dusty blue wall, large empty wall area on upper half, soft white bedding visible at bottom edge only, gentle diffused morning light, photorealistic, minimal, no text, no logo, no people, no product, tidy and airy'
  },
  {
    id: 'nordic-wood',
    name: '北欧原木',
    tag: '清新',
    desc: '白墙 + 原木元素，干净通透，适合年轻客群',
    tone: 'light',
    zone: { x: 0.15, y: 0.18, w: 0.7, h: 0.54 },
    file: 'nordic-wood.jpg',
    prompt:
      'Scandinavian nordic interior, white wall with clean empty space, light oak wood slats and a small plant at the frame edge, bright airy natural light, photorealistic interior photography, minimal, no text, no logo, no people, no product'
  },
  {
    id: 'living-night',
    name: '客厅夜景',
    tag: '氛围',
    desc: '深蓝夜色 + 城市灯光，适合主推静谧与节能',
    tone: 'dark',
    zone: { x: 0.14, y: 0.14, w: 0.72, h: 0.56 },
    file: 'living-night.jpg',
    prompt:
      'Modern living room at night, deep blue ambient light, warm city lights bokeh through large window at the right edge, dark wall with clean empty space, subtle cool rim light, photorealistic, cinematic, no text, no logo, no people, no product'
  },
  {
    id: 'studio-white',
    name: '白底棚拍',
    tag: '主图安全',
    desc: '纯白背景 + 地面柔光，最接近京东首图底色要求',
    tone: 'light',
    zone: { x: 0.2, y: 0.14, w: 0.6, h: 0.66 },
    file: 'studio-white.jpg',
    prompt:
      'Clean white studio background for ecommerce product photography, seamless pure white to very light gray gradient, soft floor reflection at the bottom, large empty center, professional softbox lighting, no text, no logo, no people, no product, no props'
  },
  {
    id: 'studio-gray',
    name: '高级灰棚拍',
    tag: '质感',
    desc: '灰阶渐变 + 侧硬光，适合强调金属与工艺',
    tone: 'dark',
    zone: { x: 0.18, y: 0.14, w: 0.64, h: 0.64 },
    file: 'studio-gray.jpg',
    prompt:
      'Premium dark gray studio backdrop for product photography, smooth gradient from charcoal to light gray, dramatic side light, subtle floor reflection, large empty center space, photorealistic, no text, no logo, no people, no product, no props'
  },
  {
    id: 'office-modern',
    name: '现代办公',
    tag: '商用',
    desc: '简洁办公空间，适合商用机型与工程机',
    tone: 'cool',
    zone: { x: 0.15, y: 0.16, w: 0.7, h: 0.56 },
    file: 'office-modern.jpg',
    prompt:
      'Modern minimal office interior, white and light gray palette, glass partition blurred in background, clean empty wall area, bright cool daylight, photorealistic architectural photography, no text, no logo, no people, no product'
  }
]);

const BY_ID = new Map(SCENES.map(scene => [scene.id, scene]));

function list() {
  return SCENES.map(scene => ({ ...scene, url: `/assets/design/scenes/${scene.file}` }));
}

function get(id) {
  const scene = BY_ID.get(String(id || ''));
  if (!scene) return null;
  return { ...scene, url: `/assets/design/scenes/${scene.file}` };
}

module.exports = { list, get, ids: () => Array.from(BY_ID.keys()) };
