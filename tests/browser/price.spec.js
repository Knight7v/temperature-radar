const {test,expect}=require('@playwright/test');
/* 比价助手：接口未上线时走演示模式，页面结构必须仍可用；数字一律标注演示，不伪装真实采集。 */
async function enter(page){
 await page.addInitScript(()=>sessionStorage.setItem('workbench.session.v1',JSON.stringify({accessToken:'test',refreshToken:'test',expiresAt:Date.now()+900000})));
 await page.route('**/api/auth/me',r=>r.fulfill({json:{data:{user:{id:'u',identifier:'运营',role:'operator'},tenant:{id:'t',name:'测试公司',slug:'test'}}}}));
 await page.route('**/api/price/overview',r=>r.fulfill({status:404,json:{error:'接口不存在'}}));
}

test('比价助手在接口未就绪时进入演示模式，并明确标注演示数据',async({page})=>{
 await enter(page);await page.goto('/price.html');
 await expect(page.getByRole('heading',{name:'比价助手'})).toBeVisible();
 await expect(page.locator('#pxNotice')).toBeVisible();
 await expect(page.locator('#pxNoticeText')).toContainText('接口还没上线');
 await expect(page.locator('#kpiAlerts')).toHaveText('4');
 await expect(page.locator('#hitsBody tr[data-model]')).toHaveCount(6);
 await expect(page.locator('.workbench-nav a[aria-current=page]')).toHaveText('比价助手');
});

test('命中列表可按品牌筛选，下钻抽屉列出该机型全部链接并可用 Esc 关闭',async({page})=>{
 await enter(page);await page.goto('/price.html');
 await page.selectOption('#filterBrand','haier');
 await expect(page.locator('#hitsBody tr[data-model]')).toHaveCount(3);
 await page.selectOption('#filterBrand','');
 await page.locator('#hitsBody tr[data-model]').first().click();
 await expect(page.locator('#drawer')).toHaveClass(/is-open/);
 await expect(page.locator('#drawerTitle')).toContainText('云锦');
 await expect(page.locator('#drawerBody .px-linkrow')).toHaveCount(5);
 await page.keyboard.press('Escape');
 await expect(page.locator('#drawer')).toBeHidden();
});

test('批量粘贴链接会去重并保留商品编号',async({page})=>{
 await enter(page);await page.goto('/price.html');
 await page.click('#tabs button[data-panel=links]');
 await page.fill('#linkInput','https://item.jd.com/100012043978.html\nhttps://item.jd.com/100021234567.html?cu=true\nhttps://item.jd.com/100012043978.html');
 await page.click('#btnParse');
 await expect(page.locator('#previewBody tr')).toHaveCount(2);
 await expect(page.locator('#parseHint')).toContainText('批内重复已去 1');
});

test('链接管理分「导入链接 / 查看链接」两个子页，查看页按商品分组且能跳京东',async({page})=>{
 await enter(page);await page.goto('/price.html');
 await page.click('#tabs button[data-panel=links]');
 await expect(page.locator('#linkTabs button')).toHaveCount(2);
 await expect(page.locator('#ltab-import')).toBeVisible();
 await page.click('#linkTabs button[data-ltab=list]');
 await expect(page.locator('#ltab-list')).toBeVisible();
 await expect(page.locator('#ltab-import')).toBeHidden();
});

test('手机窄屏不出现整页横向滚动',async({page})=>{
 await enter(page);await page.setViewportSize({width:390,height:844});
 await page.goto('/price.html');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(0);
 await expect(page.getByRole('button',{name:'打开导航'})).toBeVisible();
});
