# Company Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立公司的统一工作台，接入现有气温页面，为库存提供登录和导航，客服质检与视觉设计显示规划中。

**Architecture:** 保留现有原生 HTML／CSS／JS 和天气服务。增加小型共享导航与会话模块，不引入前端框架、iframe 或微服务。工作台与库存页面需登录；气温原页面的访问策略保持现状。

**Tech Stack:** 现有 Node >=20、CommonJS 服务端、原生浏览器 JS、既有 jose 账号 API、node:test；浏览器行为验证使用 Playwright。

**Spec:** [已确认规格](../specs/2026-09-30-inventory-monitor-design.md)，重点第2、7、11节。

## Global Constraints

- 首期包括统一入口、导航、必要登录态接线、现有气温模块接入、完整库存模块。
- 客服质检和视觉设计不接入数据、模型或计费，不生成真实业务结果。
- 首期提供登录、退出、过期提示及账号角色展示，不扩展未提出的用户管理后台或SSO。
- 现有气温功能及天气推送继续运行。
- 本计划与[库存实施计划](2026-09-30-inventory-monitor.md)顺序执行；工作台先独立验收，完整首期以两份计划全部完成为准。
- 不覆盖已有未提交文件。计划阶段只修改 Markdown，执行方式由用户审阅计划后选择。

## Review Focus

- 登录返回参数含外部 URL／`//host`：只允许本地页面，Task W1。
- 多个请求同时遇到过期令牌：只执行一次 refresh，其余等待，失败清理会话，Task W1。
- 重载、关闭标签及退出失败：重载恢复当前标签会话，关闭标签后新会话需重新登录，不把网络失败伪装为已吊销服务端会话，Task W1。
- 气温旧页面的导航选择器与新侧栏冲突：不改变既有 data-page 行为和地图尺寸，Task W2。
- 规划中入口、空白数据库和小屏：明确状态、可访问导航，不展示模拟业务结果，Task W3。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `js/workbench-session.js` | UMD 会话 API，登录、刷新、退出、授权请求及安全 returnTo |
| `login.html`, `js/workbench-login.js` | 公司标识、账号、密码表单与返回页面 |
| `js/workbench-shell.js`, `css/workbench.css` | 模块目录、导航、账号区、小屏抽屉；不加载天气业务代码 |
| `workbench.html`, `js/workbench-home.js` | 真实模块入口及规划中状态 |
| `index.html`, `index-v2.html`, `vercel.json` | 根入口调整、天气页接入共享导航、保留旧气温链接 |
| `tests/workbench-session.test.js` | 会话及返回地址单元测试 |
| `tests/browser/workbench.spec.js`, `playwright.config.js` | 登录导航和天气布局浏览器验证 |
| `docs/WORKBENCH-SETUP.md` | 登录配置、启动、数据与调度前置条件 |

## 执行前准备

- [ ] 使用 using-git-worktrees 技能确定执行位置；当前存在未提交账号／数据库地基，不能从 HEAD 新建空缺地基的工作树后直接实施。若创建隔离目录，转移必要未提交差异和未跟踪源码，排除 `.env*` 密钥、依赖、`.vercel` 和无关用户设置；保留原目录。不要自动提交用户全部未提交工作。
- [ ] 记录 `git status --short`；运行 `node --version`、`env -u DATABASE_URL npm test`，记录已有失败和数据库跳过，不把基线问题当作本次新增问题，也不把跳过当通过。真实数据库集成另用隔离测试库，不运行生产数据库测试。
- [ ] 验证 `require('jose')` 在实际 Node 运行版本工作；如最低支持版本报 ESM 加载错误，在 W1 内用懒 `import('jose')` 并复跑鉴权测试，不盲目提高版本要求。
- [ ] 每个任务提交仅列明拥有的文件／新增差异，审查暂存内容。已有未跟踪地基若必须作为最终交付依赖，应明确列入集成记录；不得静默遗漏导致干净检出无法运行。

## Task W1：登录与会话客户端

**Files:** Create `js/workbench-session.js`, `login.html`, `js/workbench-login.js`, `tests/workbench-session.test.js`。仅在运行兼容性验证失败时修改 `lib/auth.js` 的 jose 加载。

**Interfaces:**
- 消费现有 `POST /api/auth/login`（slug, identifier, password）、`POST /api/auth/refresh`（refreshToken）、`GET /api/auth/me`、`POST /api/auth/logout`。
- 产出 `createSessionClient({fetchImpl, storage, now})`，返回 `login(credentials)`, `getIdentity()`, `authorizedFetch(url, init)`, `logout()`, `clear()`；导出 `safeReturnTo(input)`。
- storage 注入 Web Storage 接口；生产使用 sessionStorage，键 `workbench.session.v1`，不把 token 放 URL／DOM。浏览器存储受同源 JS 访问，页面渲染不得使用不可信 innerHTML。
- identity 为 `{user:{id,identifier,role},tenant:{id,slug,name}}`；登录存 token 和 expiresAt，重载后 `/me` 刷新身份；刷新请求单飞，原请求最多重试一次。

- [ ] 写失败测试，包括下列可直接运行的测试。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeReturnTo } = require('../js/workbench-session');
test('登录返回仅允许已知本地工作台页面', () => {
  assert.equal(safeReturnTo('//evil.example'), '/workbench.html');
  assert.equal(safeReturnTo('https://evil.example'), '/workbench.html');
  assert.equal(safeReturnTo('/inventory.html?date=2026-09-29'),
    '/inventory.html?date=2026-09-29');
});
```

- [ ] 运行 `node --test tests/workbench-session.test.js`，预期新模块不存在或行为断言失败。
- [ ] 编写 safeReturnTo：用固定同源基准解析 URL，允许路径 `/workbench.html`、`/inventory.html`、`/index-v2.html`；拒绝外部 origin、反斜线及协议相对输入。保留允许页面的 query/hash，不接受任意文件路径。

```js
function safeReturnTo(input) {
  const raw = String(input || '');
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/workbench.html';
  }
  const u = new URL(raw, 'https://workbench.invalid');
  const allowed = new Set(['/workbench.html','/inventory.html','/index-v2.html']);
  return u.origin === 'https://workbench.invalid' && allowed.has(u.pathname)
    ? u.pathname + u.search + u.hash : '/workbench.html';
}
```

- [ ] 写会话测试：用 Map 实现 storage、注入 fetchImpl；模拟两条并发401，只允许一次 refresh，两条请求使用新 accessToken；刷新失败清理存储并抛 `SESSION_EXPIRED`；请求403不得无限刷新；非法JSON存储被清理。
- [ ] 实现单飞刷新和最多一次请求重试。Blob／原始文件请求可重发，流体请求拒绝隐式重试；保存旋转后的两个 token，检查 expiresIn。退出先请求服务端，随后清本地；请求失败仍本地退出但告知“当前设备已退出，服务端会话吊销未确认”。
- [ ] 完成登录表单：租户 slug、账号、密码必填；调用 login，成功后 location.replace(safeReturnTo(returnTo))；无权限、凭据错误和接口不可用分别反馈，提交中禁用重复点击。
- [ ] 运行 `node --test tests/workbench-session.test.js tests/auth.test.js`；覆盖清存储、重载、时间过期和所有上述并发案例，预期通过；记录是否修改既有鉴权。
- [ ] 提交 W1 专属文件，提交信息 `feat: add workbench login and session client`。

## Task W2：共享导航与原气温模块接入

**Files:** Create `js/workbench-shell.js`, `css/workbench.css`, `tests/workbench-shell.test.js`；Modify `index-v2.html`。

**Interfaces:**
- 消费 W1 的 `getIdentity()` / `logout()`；气温原页使用可选身份，禁止强迫改变其原访问策略。
- 导出 UMD `MODULES`、`mountShell({container, activeModule, identity, onLogout})`；返回 `{destroy()}`，移除监听器。
- module `{id,title,href,status}`；`weather`→`/index-v2.html`、`inventory`→`/inventory.html`、`quality`／`design`→工作台对应规划中说明。

- [ ] 写行为契约测试，不用整页快照锁死文案／DOM。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODULES } = require('../js/workbench-shell');
test('仅客服质检与视觉设计规划中', () => {
  assert.deepEqual(MODULES.filter(m => m.status === 'planned').map(m => m.id),
    ['quality','design']);
  assert.equal(MODULES.find(m => m.id === 'weather').href, '/index-v2.html');
});
```

- [ ] 运行 `node --test tests/workbench-shell.test.js`，预期新模块失败；定义目录及 DOM 构造函数。

```js
const MODULES = [
  {id:'weather',title:'气温监控预警',href:'/index-v2.html',status:'active'},
  {id:'inventory',title:'库存监控预警',href:'/inventory.html',status:'active'},
  {id:'quality',title:'客服质检',href:'/workbench.html#quality',status:'planned'},
  {id:'design',title:'视觉设计',href:'/workbench.html#design',status:'planned'}
];
```

- [ ] 实现导航 CSS 以 `.workbench-*` 命名，使用 `data-module`，避免旧 `.nav-item`、`data-page` 委派监听器。用 textContent 填账号／公司名；当前导航加 aria-current，折叠按钮有 aria-expanded，Escape关闭。
- [ ] 天气页面侧栏增加工作台入口／模块导航，原天气业务子导航保留。避免包裹或重设地图内层 flex 容器；如宽度变化，在布局稳定后调用现有图表 resize 接口，不能通过反复重建地图解决。
- [ ] 运行单元测试和既有 `tests/titanium-theme.test.js`、`tests/core-wiring.test.js`；浏览器检查放 W3：在天气页切原业务页、返回工作台再进入，地图和旧筛选仍工作。
- [ ] 提交 `feat: add shared workbench navigation`。

## Task W3：工作台首页、根路由与浏览器验收

**Files:** Create `workbench.html`, `js/workbench-home.js`, `playwright.config.js`, `tests/browser/workbench.spec.js`, `docs/WORKBENCH-SETUP.md`；Modify `index.html`, `vercel.json`, `package.json`, `package-lock.json`。库存实际页面由后续计划创建；独立验证阶段入口提示库存开发中，库存完成时取消此临时状态。

**Interfaces:** 消费 W1/W2；页面有语义化“公司工作台”标题、模块卡片、账号区和真实加载／失败状态。根路径最终返回 workbench.html；登录 returnTo 保留。

- [ ] 在实施时安装并锁定开发依赖 `@playwright/test`，添加 `test:browser` 脚本；浏览器测试用注入的身份和接口 fixtures，不访问真实群、天气供应商或生产数据库。
- [ ] 写浏览器测试，补入401跳转、恶意returnTo、移动抽屉和天气原导航用例。

```js
const { test, expect } = require('@playwright/test');
test('预留模块不展示虚假生成功能', async ({ page }) => {
  await page.route('**/api/auth/me', r => r.fulfill({json:{success:true,data:{
    user:{id:'u1',identifier:'viewer',role:'viewer'},
    tenant:{id:'t1',slug:'test',name:'测试公司'}
  }}}));
  await page.addInitScript(() => sessionStorage.setItem('workbench.session.v1',
    JSON.stringify({accessToken:'test',refreshToken:'test',expiresAt:Date.now()+60000})));
  await page.goto('/workbench.html#design');
  await expect(page.getByRole('heading', {name:'公司工作台'})).toBeVisible();
  await expect(page.getByTestId('module-design')).toContainText('规划中');
  await expect(page.getByRole('button', {name:'生成视频'})).toHaveCount(0);
});
```

- [ ] 启动本地开发服务，配置 playwright baseURL，运行 `npx playwright test tests/browser/workbench.spec.js`，确认缺失页面／状态导致失败。
- [ ] 首页以模块卡片为主，不加载库存业务大表或伪造全公司指标；未登录跳登录、鉴权接口失败显示重试、禁止循环跳转。标题使用账号返回的公司名称（有值时）及“工作台”，无值时“公司工作台”。
- [ ] 将 `index.html` 跳转目标与根 rewrite 指向 `/workbench.html`；保留 `/index-v2.html`，保持天气 cron `30 1 * * *`。工作台HTML与受保护API使用合适的不缓存策略，不让旧根页重定向缓存阻碍上线。
- [ ] 浏览器验证桌面1440宽与移动390宽、键盘进入及关闭导航、页面重载、退出、旧气温链接。布局截图只保存测试输出，不纳入业务资源。
- [ ] 运行 `env -u DATABASE_URL npm test`、`npm run test:browser -- tests/browser/workbench.spec.js` 和 `vercel build`（需本地CLI及项目环境已具备）；工具／环境缺失如实记录，不能把静态页面可打开写成部署成功。
- [ ] 文档写明公司标识登录、角色、启动方式及尚待库存计划完成项；提交 `feat: launch company workbench shell`。

## 交付与下一步

W1→W2→W3顺序实施。完成后继续库存计划，不把只有卡片的工作台宣称为首期全部完成。两个计划的后端权限／数据迁移及真实企微联调均完成，才满足总体规格。

执行方式待用户审阅后选择：本会话顺序实施，或按任务由子代理实施并逐项复核。当前没有分派代理，也没有修改产品代码。
