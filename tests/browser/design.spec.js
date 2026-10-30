const { test, expect } = require('@playwright/test');
const zlib = require('node:zlib');

// 手写一个最小 PNG 编码器：只为了在测试里造一张"白底 + 浅灰机身"的商品图，
// 好把「上传 → 浏览器抠图 → 显示分数」这条链真正跑一遍。装个图像库不值当。
function makeProductPng(width = 240, height = 240) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const box = { x: 50, y: 64, w: 140, h: 112 };
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      const value = inside ? 232 : 255;
      const offset = row + 1 + x * 4;
      raw[offset] = value;
      raw[offset + 1] = value;
      raw[offset + 2] = value;
      raw[offset + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, crcBuffer]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 位深
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const META = {
  configured: false,
  keyHint: '',
  provider: '硅基流动',
  baseUrl: 'https://api.siliconflow.cn/v1',
  model: 'Kwai-Kolors/Kolors',
  modelOptions: [{ id: 'Kwai-Kolors/Kolors', name: 'Kolors 快手可图', price: '免费', priceCny: 0, note: '', active: true }],
  scenes: [{ id: 'living-bright', name: '明亮客厅', desc: '白天客厅', tone: 'light', file: 'x.jpg', url: '/assets/design/scenes/living-bright.jpg', ready: false }],
  categories: [{ id: 'aircon', name: '空调 · 挂机' }],
  platforms: [{ id: 'jd', name: '京东' }],
  sizes: [{ id: 'square', label: '方图', width: 1024, height: 1024 }],
  jdRules: { minSize: 800, recommendSize: 1200, maxBytes: 3145728, productRatio: 0.7, padding: 30, firstImage: '纯白底' },
  textModel: null,
  matting: { local: true, ai: false, engine: '' },
  library: {
    purposes: [
      { id: 'first', name: '京东首图' },
      { id: 'scene', name: '场景副图' },
      { id: 'background', name: 'AI 背景' }
    ],
    statuses: [
      { id: 'draft', name: '草稿' },
      { id: 'approved', name: '通过' }
    ],
    maxBytes: 12582912,
    pageSize: 24,
    zipMaxItems: 40,
    total: 1
  },
  usage: { month: '2026-10', calls: 0, images: 0, failed: 0, cost: 0, budget: 300, used: 0, byModel: [] },
  productModels: [{ model: 'KFR-35GW/(35549)FNhAc-B1', name: '云之海 1.5 匹', brand: '格力' }]
};

const ASSETS = {
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      sku: 'KFR-35GW/(35549)FNHAc-B1',
      title: '明亮客厅',
      purpose: 'background',
      status: 'draft',
      width: 1024,
      height: 1024,
      model: 'Kwai-Kolors/Kolors',
      prompt: 'empty living room',
      cost: 0,
      url: '/assets/design/scenes/living-bright.jpg',
      bytes: 2048,
      createdAt: '2026-10-27T02:00:00.000Z'
    }
  ],
  total: 1,
  page: 1,
  pageSize: 24,
  pages: 1,
  summary: { total: 1, bytes: 2048, cost: 0, backgrounds: 1, withSku: 1 },
  meta: { purposes: META.library.purposes, statuses: META.library.statuses, maxBytes: 12582912, pageSize: 24, zipMaxItems: 40 }
};

async function prepare(page) {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'workbench.session.v1',
      JSON.stringify({ accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 900000 })
    )
  );
  await page.route('**/api/auth/me', route =>
    route.fulfill({ json: { data: { user: { id: 'u', identifier: '运营', role: 'operator' }, tenant: { id: 't', name: '测试公司', slug: 'test' } } } })
  );
  await page.route('**/api/design?action=meta', route => route.fulfill({ json: { data: META } }));
  await page.route(/\/api\/design\?action=assets(&|$)/, route => route.fulfill({ json: { data: ASSETS } }));
}

test('设计页打开不报错，抠图区与额度都显示出来', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.goto('/design.html');

  await expect(page.getByRole('heading', { name: '商品主图工作室' })).toBeVisible();
  await expect(page.locator('#matteHint')).toContainText('自动抠成透明底');
  await expect(page.locator('#usageNote')).toContainText('预算 300');
  await expect(page.locator('#assetCount')).toHaveText('1');
  await expect(page.getByRole('button', { name: /存进素材库/ })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('上传白底图后自动抠图，并报出边缘分数', async ({ page }) => {
  await prepare(page);
  await page.goto('/design.html');
  await page.setInputFiles('#productFile', { name: 'product.png', mimeType: 'image/png', buffer: makeProductPng() });

  // 抠图是同步算的，等分数落在标题上即完成
  await expect(page.locator('#matteScore')).toContainText('边缘', { timeout: 8000 });
  const score = Number((await page.locator('#matteScore').innerText()).replace(/[^\d]/g, ''));
  expect(score).toBeGreaterThan(55);
  await expect(page.getByRole('button', { name: /存进素材库/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: '重新抠图' })).toBeEnabled();
  // 抠成功后商品层是透明底，勾选「不垫白卡」的自动判断应该已经生效
  await expect(page.locator('#status')).toContainText('透明底');
});

test('素材库抽屉能打开、能看到图、能套用背景', async ({ page }) => {
  await prepare(page);
  await page.goto('/design.html');
  await page.locator('#openLibraryBtn').click();

  await expect(page.locator('#libraryDrawer .ds-drawer-panel')).toBeVisible();
  await expect(page.locator('#libTotal')).toContainText('共 1 张');
  await expect(page.locator('.ds-lib-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '用作背景' })).toBeVisible();

  await page.getByRole('button', { name: '用作背景' }).click();
  await expect(page.locator('#libraryDrawer .ds-drawer-panel')).toBeHidden();
  await expect(page.locator('#status')).toContainText('京东首图');
});

test('AI 未配置时生成按钮不可点，并说明怎么开通', async ({ page }) => {
  await prepare(page);
  await page.goto('/design.html');
  await page.getByRole('button', { name: /场景副图/ }).click();
  await page.getByRole('button', { name: 'AI 生成' }).click();
  await expect(page.locator('#generateBtn')).toBeDisabled();
  await expect(page.locator('#aiHint')).toContainText('DESIGN_IMAGE_API_KEY');
});
