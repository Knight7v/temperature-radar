const { test, expect } = require('@playwright/test');

const PRODUCT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');

async function openReport(page) {
  await page.addInitScript(() => sessionStorage.setItem('workbench.session.v1', JSON.stringify({
    accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 900000
  })));
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    data: { user: { id: 'u', identifier: '运营', role: 'operator' }, tenant: { id: 't', name: '长缨星河' } }
  } }));
  await page.goto('/report-design.html');
  await expect(page.locator('#reportStatus')).toContainText('填写项目信息');
}

test('三个固定底图可切换，项目文案和产品图合成后可下载', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openReport(page);

  const canvas = page.locator('#reportCanvas');
  const initial = await canvas.evaluate(node => node.toDataURL());
  await page.locator('#projectName').fill('四川绵阳中物院');
  await page.locator('#productName').fill('海尔空调');
  await page.locator('#quantity').fill('16');
  await expect(page.locator('#reportCopy')).toHaveText('长缨星河中标四川绵阳中物院海尔空调16台');
  await page.locator('#reportProduct').setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: PRODUCT_PNG });
  await expect(page.locator('#reportStatus')).toContainText('可以下载');
  expect(await canvas.evaluate(node => node.toDataURL())).not.toBe(initial);

  await expect(page.locator('[data-template]')).toHaveCount(3);
  await expect(page.locator('[data-template="silk"]')).toHaveCount(0);
  for (const id of ['starfield', 'orbit', 'vertical']) {
    await page.locator(`[data-template="${id}"]`).click();
    await expect(page.locator(`[data-template="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    expect(await canvas.evaluate(node => node.toDataURL())).toMatch(/^data:image\/png;base64,/);
  }

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#downloadReport').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('四川绵阳中物院');
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(errors).toEqual([]);
});

test('没有项目名称或产品图时不能下载成品', async ({ page }) => {
  await openReport(page);
  await expect(page.locator('#downloadReport')).toBeDisabled();
  await page.locator('#projectName').fill('四川绵阳中物院');
  await page.locator('#productName').fill('海尔空调');
  await page.locator('#quantity').fill('16');
  await expect(page.locator('#downloadReport')).toBeDisabled();
  await page.locator('#reportProduct').setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: PRODUCT_PNG });
  await expect(page.locator('#downloadReport')).toBeEnabled();
  await page.locator('#projectName').fill('');
  await expect(page.locator('#downloadReport')).toBeDisabled();
});
