const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scenes = require('../lib/design/scenes');
const prompt = require('../lib/design/prompt');
const provider = require('../lib/design/provider');
const store = require('../lib/design/store');

test('场景库结构完整且背景图已入库', () => {
  const list = scenes.list();
  assert.ok(list.length >= 8, '至少 8 个内置场景');
  const ids = new Set();
  for (const scene of list) {
    assert.ok(scene.id && !ids.has(scene.id), `id 重复：${scene.id}`);
    ids.add(scene.id);
    assert.ok(scene.name && scene.desc, `${scene.id} 缺少文案`);
    assert.ok(['light', 'warm', 'cool', 'dark'].includes(scene.tone), `${scene.id} 色调不合法`);
    assert.equal(scene.url, `/assets/design/scenes/${scene.file}`);
    const file = path.resolve(__dirname, '../assets/design/scenes', scene.file);
    assert.ok(fs.existsSync(file), `背景图缺失：${scene.file}`);
    assert.ok(fs.statSync(file).size > 20 * 1024, `${scene.file} 体积异常，可能是坏图`);
  }
});

test('场景查询命中与未命中', () => {
  assert.equal(scenes.get('living-bright').name, '明亮客厅');
  assert.equal(scenes.get('not-exist'), null);
  assert.equal(scenes.get(''), null);
});

test('背景提示词强制排除文字与商品', () => {
  const built = prompt.build({ category: 'aircon', platform: 'jd', ratio: 'square', hasText: true });
  assert.match(built.prompt, /1024:1024/);
  assert.match(built.prompt, /no text/i);
  assert.match(built.prompt, /no appliance or product/i);
  assert.match(built.prompt, /empty interior background/i);
  assert.match(built.negativePrompt, /watermark/);
  assert.match(built.negativePrompt, /product/);
});

test('需要叠文案时要求留出干净区域', () => {
  const withText = prompt.build({ category: 'aircon', ratio: 'square', hasText: true });
  const noText = prompt.build({ category: 'aircon', ratio: 'square', hasText: false });
  assert.match(withText.prompt, /clean low-detail area for text overlay/);
  assert.doesNotMatch(noText.prompt, /for text overlay/);
});

test('比例映射与非法值回退', () => {
  assert.equal(prompt.sizeOf('square').imageSize, '1024x1024');
  assert.equal(prompt.sizeOf('portrait').imageSize, '1024x1536');
  assert.equal(prompt.sizeOf('wide').imageSize, '1536x1024');
  assert.equal(prompt.sizeOf('乱填').imageSize, '1024x1024');
  assert.equal(prompt.pickSize('乱填'), 'square');
});

test('用户描述会被收敛长度且不吞掉硬约束', () => {
  const long = '很'.repeat(500);
  const built = prompt.build({ category: 'aircon', ratio: 'square', direction: long, hasText: true });
  assert.ok(built.prompt.length < 1200, '提示词不应无限膨胀');
  assert.match(built.prompt, /no text/i);
});

test('模型清单有且只有一个默认', () => {
  const list = provider.models();
  assert.equal(list.filter(item => item.active).length, 1);
  assert.ok(list.some(item => item.id === 'Kwai-Kolors/Kolors' && item.price === '免费'));
  assert.equal(provider.modelInfo('Kwai-Kolors/Kolors').name, 'Kolors 快手可图');
  assert.equal(provider.modelInfo('不存在的模型'), null);
});

test('未配置 Key 时拒绝生成并给出可读提示', async () => {
  const old = process.env.DESIGN_IMAGE_API_KEY;
  const oldAlt = process.env.SILICONFLOW_API_KEY;
  delete process.env.DESIGN_IMAGE_API_KEY;
  delete process.env.SILICONFLOW_API_KEY;
  try {
    assert.equal(provider.configured(), false);
    await assert.rejects(
      () => provider.generate({ prompt: 'test', imageSize: '1024x1024' }),
      error => error.code === 'DESIGN_NOT_CONFIGURED' && error.status === 503
    );
  } finally {
    if (old !== undefined) process.env.DESIGN_IMAGE_API_KEY = old;
    if (oldAlt !== undefined) process.env.SILICONFLOW_API_KEY = oldAlt;
  }
});

test('配置后可识别，且空提示词被拦截', async () => {
  const old = process.env.DESIGN_IMAGE_API_KEY;
  process.env.DESIGN_IMAGE_API_KEY = 'sk-test-placeholder';
  try {
    assert.equal(provider.configured(), true);
    await assert.rejects(
      () => provider.generate({ prompt: '   ' }),
      error => error.code === 'DESIGN_NO_PROMPT'
    );
  } finally {
    if (old === undefined) delete process.env.DESIGN_IMAGE_API_KEY;
    else process.env.DESIGN_IMAGE_API_KEY = old;
  }
});

test('生成结果可转成内联图片，空值返回空串', () => {
  const buffer = Buffer.from('fake-image');
  assert.equal(store.toDataUrl(buffer), `data:image/jpeg;base64,${buffer.toString('base64')}`);
  assert.equal(store.toDataUrl(Buffer.alloc(0)), '');
  assert.equal(store.toDataUrl(null), '');
});

test('落盘路径在静态白名单内', () => {
  assert.match(store.URL_PREFIX, /^\/assets\//);
  assert.ok(store.ROOT.endsWith(path.join('assets', 'design', 'generated')));
});
