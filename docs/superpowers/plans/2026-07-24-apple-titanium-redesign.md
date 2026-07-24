# Apple Titanium Full-Site Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将空调热销区域雷达全站改造成已确认的 Apple Pro 风格「深色钛金」数据工作台，同时保留现有业务逻辑和原生技术栈。

**Architecture:** 保留 `index-v2.html`、`js/ui.js`、`js/map.js` 的现有模块边界，新建一个最后加载的 `css/titanium-theme.css` 作为全站主题层，集中管理设计令牌和组件覆盖。使用一个 Node 静态契约测试文件持续验证 DOM、CSS、动态模板和可访问性约束，再用本地浏览器完成桌面与响应式回归。

**Tech Stack:** HTML5、CSS3、原生 JavaScript、ECharts、Node.js 内置 `node:test` 与 `node:assert`

## Global Constraints

- 视觉方向固定为「深色钛金」：近黑背景、玻璃材质、银色高光、局部能量色。
- 全站覆盖首页、热销分析、7 天预测、降水监控、规则设置、城市详情、今日简报、登录和支付。
- 允许适度重排，但保留全部现有功能、数据 ID 和事件入口。
- 1440–1920px 为主体验；1024px 必须可用；小于 768px 保证可操作。
- 不引入 React、Vue、Tailwind 或额外 UI 框架。
- 不修改天气计算、ADI 算法、认证、支付后端或数据模型。
- 普通文本对比度达到 WCAG AA 基本要求。
- 交互控件必须具有可见焦点状态和至少 44×44px 的点击区域。
- 支持 `prefers-reduced-motion`。
- 无新增浏览器控制台错误。

---

## File Structure

### Create

- `css/titanium-theme.css`：深色钛金设计令牌、全局组件、页面布局、响应式与可访问性覆盖。
- `tests/titanium-theme.test.js`：DOM、CSS、动态模板、地图主题和无障碍静态契约测试。

### Modify

- `index-v2.html`：加载主题文件，增加 SVG 图标精灵，重排全局外壳、首页标题区、工具栏和弹窗语义。
- `css/styles-v2.css`：移除 Orbitron 字体依赖，保留现有布局作为兼容基线。
- `js/ui.js`：输出统一组件类名，渲染动态首页结论，补充规则设置脏状态，并修复阻碍降水页视觉验收的两个最小运行时问题。
- `js/map.js`：集中定义深色钛金地图配色和 Tooltip 类名。
- `index.html`：仅在需要时更新主题缓存版本，不改变跳转逻辑。

---

### Task 1: Titanium Theme Foundation

**Files:**
- Create: `css/titanium-theme.css`
- Create: `tests/titanium-theme.test.js`
- Modify: `index-v2.html:5-40`
- Modify: `css/styles-v2.css:1-40`

**Interfaces:**
- Produces: CSS variables `--titanium-bg`, `--titanium-surface`, `--titanium-surface-raised`, `--titanium-text`, `--titanium-text-secondary`, `--titanium-accent`, `--titanium-success`, `--titanium-warning`, `--titanium-danger`, `--titanium-radius-sm`, `--titanium-radius-md`, `--titanium-radius-lg`.
- Produces: Theme utility classes `.glass-panel`, `.surface-raised`, `.focus-ring`.
- Consumes: Existing `css/styles-v2.css` class names and HTML structure.

- [ ] **Step 1: Write the failing theme contract test**

Create `tests/titanium-theme.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('loads titanium theme after legacy styles', () => {
    const html = read('index-v2.html');
    const legacyIndex = html.indexOf('css/styles-v2.css');
    const themeIndex = html.indexOf('css/titanium-theme.css');
    assert.ok(legacyIndex >= 0);
    assert.ok(themeIndex > legacyIndex);
});

test('defines the complete titanium token contract', () => {
    const css = read('css/titanium-theme.css');
    [
        '--titanium-bg',
        '--titanium-surface',
        '--titanium-surface-raised',
        '--titanium-text',
        '--titanium-text-secondary',
        '--titanium-accent',
        '--titanium-success',
        '--titanium-warning',
        '--titanium-danger',
        '--titanium-radius-sm',
        '--titanium-radius-md',
        '--titanium-radius-lg'
    ].forEach((token) => assert.match(css, new RegExp(token)));
});

test('removes Orbitron from the production stylesheet', () => {
    assert.doesNotMatch(read('css/styles-v2.css'), /Orbitron/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/titanium-theme.test.js
```

Expected: FAIL because `css/titanium-theme.css` does not exist.

- [ ] **Step 3: Add the theme stylesheet link and remove Orbitron**

In `index-v2.html`, immediately after the legacy stylesheet:

```html
<link rel="stylesheet" href="css/styles-v2.css?v=3">
<link rel="stylesheet" href="css/titanium-theme.css?v=1">
```

In `css/styles-v2.css`, replace the Google Fonts import with:

```css
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap');
```

Replace every `font-family: 'Orbitron', sans-serif;` declaration with:

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
font-variant-numeric: tabular-nums;
```

- [ ] **Step 4: Create the complete theme foundation**

Create `css/titanium-theme.css` with:

```css
:root {
    color-scheme: dark;
    --titanium-bg: #08080a;
    --titanium-surface: rgba(28, 28, 30, 0.78);
    --titanium-surface-raised: rgba(44, 44, 46, 0.64);
    --titanium-surface-solid: #1c1c1e;
    --titanium-text: #f5f5f7;
    --titanium-text-secondary: #a1a1a6;
    --titanium-text-muted: #6e6e73;
    --titanium-accent: #5e8dff;
    --titanium-success: #30d158;
    --titanium-warning: #ff9f0a;
    --titanium-danger: #ff453a;
    --titanium-border: rgba(255, 255, 255, 0.10);
    --titanium-border-strong: rgba(255, 255, 255, 0.18);
    --titanium-radius-sm: 10px;
    --titanium-radius-md: 16px;
    --titanium-radius-lg: 22px;
    --titanium-shadow: 0 20px 60px rgba(0, 0, 0, 0.34);
    --titanium-blur: blur(28px) saturate(135%);
    --titanium-ease: 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

html,
body {
    background: var(--titanium-bg);
    color: var(--titanium-text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display",
        "PingFang SC", "Helvetica Neue", Arial, sans-serif;
}

body::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background:
        radial-gradient(circle at 72% -10%, rgba(94, 141, 255, 0.16), transparent 36%),
        radial-gradient(circle at 0% 90%, rgba(48, 209, 88, 0.07), transparent 30%);
}

.glass-panel {
    background: linear-gradient(145deg, rgba(44, 44, 46, 0.78), rgba(22, 22, 24, 0.72));
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-lg);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.05), var(--titanium-shadow);
    backdrop-filter: var(--titanium-blur);
    -webkit-backdrop-filter: var(--titanium-blur);
}

.surface-raised {
    background: var(--titanium-surface-raised);
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-md);
}

:where(button, input, select, textarea, [tabindex]):focus-visible {
    outline: 2px solid var(--titanium-accent);
    outline-offset: 3px;
}

.focus-ring:focus-visible {
    outline: 2px solid var(--titanium-accent);
    outline-offset: 3px;
}
```

- [ ] **Step 5: Run the theme test and legacy syntax checks**

Run:

```bash
node --test tests/titanium-theme.test.js
for file in js/*.js; do node --check "$file"; done
```

Expected: all theme tests PASS and every JavaScript syntax check exits 0.

- [ ] **Step 6: Commit the theme foundation**

```bash
git add index-v2.html css/styles-v2.css css/titanium-theme.css tests/titanium-theme.test.js
git commit -m "feat: add titanium design system foundation"
```

---

### Task 2: Global Shell, Navigation, and SVG Icon System

**Files:**
- Modify: `index-v2.html:40-165`
- Modify: `css/titanium-theme.css`
- Modify: `js/ui.js:96-115`
- Modify: `tests/titanium-theme.test.js`

**Interfaces:**
- Consumes: Task 1 design tokens and `.glass-panel`.
- Produces: Inline SVG symbols `icon-dashboard`, `icon-analysis`, `icon-calendar`, `icon-rain`, `icon-settings`, `icon-chevron`.
- Produces: Structural classes `.app-shell`, `.titanium-sidebar`, `.titanium-header`, `.header-metric`.
- Produces: DOM target `#headerDate`, updated by `updateCurrentTime()`.
- Preserves: `.nav-item[data-page]`, `#pageTitle`, `#currentTime`, and all existing metric IDs used by `js/ui.js`.

- [ ] **Step 1: Add failing shell and icon tests**

Append to `tests/titanium-theme.test.js`:

```js
test('uses SVG symbols instead of emoji in primary navigation', () => {
    const html = read('index-v2.html');
    const nav = html.match(/<nav class="nav-menu">([\s\S]*?)<\/nav>/)[1];
    ['icon-dashboard', 'icon-analysis', 'icon-calendar', 'icon-rain', 'icon-settings']
        .forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
    assert.doesNotMatch(nav, /🎯|📈|📊|🌧️|⚙️/);
    assert.match(nav, /<svg[^>]*aria-hidden="true"/);
});

test('preserves navigation and header integration IDs', () => {
    const html = read('index-v2.html');
    ['dashboard', 'analysis', 'report', 'rainMonitor', 'rules'].forEach((page) => {
        assert.match(html, new RegExp(`data-page="${page}"`));
    });
    ['headerDate', 'pageTitle', 'currentTime', 'salesIntensity', 'cityCount', 'outbreakCount',
        'actionCount', 'hotNightCount', 'lastUpdateTime'].forEach((id) => {
        assert.match(html, new RegExp(`id="${id}"`));
    });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
node --test tests/titanium-theme.test.js
```

Expected: FAIL because the SVG symbols are absent and Emoji remain.

- [ ] **Step 3: Add the SVG sprite and replace navigation icons**

Add immediately after `<body>`:

```html
<svg class="svg-sprite" aria-hidden="true">
    <symbol id="icon-dashboard" viewBox="0 0 24 24">
        <path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/>
    </symbol>
    <symbol id="icon-analysis" viewBox="0 0 24 24">
        <path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>
    </symbol>
    <symbol id="icon-calendar" viewBox="0 0 24 24">
        <path d="M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z"/>
    </symbol>
    <symbol id="icon-rain" viewBox="0 0 24 24">
        <path d="M7 16a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a3 3 0 0 1-1 5.83M8 19l-1 2m5-2-1 2m5-2-1 2"/>
    </symbol>
    <symbol id="icon-settings" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19 13.5v-3l-2-.7-.6-1.4.9-1.9-2.1-2.1-1.9.9-1.4-.6L11.5 3h-3l-.7 2-1.4.6-1.9-.9-2.1 2.1.9 1.9-.6 1.4-2 .7v3l2 .7.6 1.4-.9 1.9 2.1 2.1 1.9-.9 1.4.6.7 2h3l.7-2 1.4-.6 1.9.9 2.1-2.1-.9-1.9.6-1.4 2-.7Z"/>
    </symbol>
    <symbol id="icon-chevron" viewBox="0 0 24 24">
        <path d="m8 10 4 4 4-4"/>
    </symbol>
</svg>
```

Use this exact pattern for each primary navigation icon:

```html
<svg class="nav-icon" aria-hidden="true"><use href="#icon-dashboard"></use></svg>
```

Use `icon-analysis`, `icon-calendar`, `icon-rain`, and `icon-settings` for the remaining items. Replace the text chevron with:

```html
<svg class="nav-expand" aria-hidden="true"><use href="#icon-chevron"></use></svg>
```

- [ ] **Step 4: Add the header date target and update logic**

Replace the existing header-left content with:

```html
<div class="header-left">
    <p class="header-date" id="headerDate">--</p>
    <h2 id="pageTitle">今日热销</h2>
</div>
```

Replace `updateCurrentTime()` in `js/ui.js` with:

```js
function updateCurrentTime() {
    const now = new Date();
    const currentTime = document.getElementById('currentTime');
    if (currentTime) {
        const date = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
        const time = now.toLocaleTimeString('zh-CN', { hour12: false });
        currentTime.textContent = `${date} ${time}`;
    }

    const headerDate = document.getElementById('headerDate');
    if (headerDate) {
        headerDate.textContent = now.toLocaleDateString('zh-CN', {
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
    }
}
```

- [ ] **Step 5: Add the shell styles**

Append to `css/titanium-theme.css`:

```css
.svg-sprite {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
}

.app-container {
    background: transparent;
}

.sidebar {
    width: 200px;
    margin: 12px 0 12px 12px;
    padding: 18px 10px;
    background: rgba(20, 20, 22, 0.72);
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-lg);
    backdrop-filter: var(--titanium-blur);
    -webkit-backdrop-filter: var(--titanium-blur);
    box-shadow: var(--titanium-shadow);
}

.logo h1 {
    background: none;
    -webkit-text-fill-color: currentColor;
    color: var(--titanium-text);
    font-size: 15px;
    letter-spacing: -0.02em;
}

.logo p,
.sidebar-footer {
    color: var(--titanium-text-muted);
}

.nav-item,
.nav-subitem {
    min-height: 44px;
    color: var(--titanium-text-secondary);
    border-radius: var(--titanium-radius-sm);
    transition: color var(--titanium-ease), background var(--titanium-ease),
        box-shadow var(--titanium-ease);
}

.nav-item:hover,
.nav-subitem:hover {
    color: var(--titanium-text);
    background: rgba(255, 255, 255, 0.06);
}

.nav-item.active,
.nav-subitem.active {
    color: var(--titanium-text);
    background: rgba(255, 255, 255, 0.10);
    border: 0;
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.08);
}

.nav-icon,
.nav-expand {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.header {
    height: 70px;
    margin: 12px 12px 0;
    padding: 0 22px;
    background: rgba(20, 20, 22, 0.68);
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-md);
    backdrop-filter: var(--titanium-blur);
    -webkit-backdrop-filter: var(--titanium-blur);
}

.header-stat-label {
    color: var(--titanium-text-muted);
    font-size: 11px;
}

.header-stat-value,
.current-time {
    color: var(--titanium-text);
    font-variant-numeric: tabular-nums;
}

.content-area {
    padding: 22px;
}

.page {
    width: 100%;
    max-width: 1600px;
    margin-inline: auto;
}

.header-date {
    margin: 0 0 3px;
    color: var(--titanium-text-muted);
    font-size: 11px;
}

.header-left h2 {
    color: var(--titanium-text);
    font-size: 16px;
    letter-spacing: -0.02em;
}
```

- [ ] **Step 6: Run tests and inspect the shell at desktop width**

Run:

```bash
node --test tests/titanium-theme.test.js
python3 -m http.server 4173
```

Expected: tests PASS. In the browser at `http://127.0.0.1:4173/index-v2.html`, the floating sidebar and header render without missing icons.

- [ ] **Step 7: Commit the shell redesign**

```bash
git add index-v2.html css/titanium-theme.css js/ui.js tests/titanium-theme.test.js
git commit -m "feat: redesign global shell and navigation"
```

---

### Task 3: Sales Overview Hero and Titanium Dashboard Grid

**Files:**
- Modify: `index-v2.html:166-233`
- Modify: `css/titanium-theme.css`
- Modify: `js/ui.js:297-330`
- Modify: `tests/titanium-theme.test.js`

**Interfaces:**
- Consumes: `Core.calculateSalesIntensity(cityData)` returning `低`, `中`, `偏强`, or `强`.
- Produces: `renderDashboardHero()` and DOM targets `#dashboardHeroTitle`, `#dashboardHeroSummary`.
- Preserves: `#todayConclusion`, `#regionRanking`, `#longestHotNight`, `#china-map`, `#topCitiesContainer`, `#generateBriefBtn`.

- [ ] **Step 1: Add failing dashboard structure tests**

Append:

```js
test('defines the dashboard hero and preserves dynamic dashboard targets', () => {
    const html = read('index-v2.html');
    ['dashboardHeroTitle', 'dashboardHeroSummary', 'todayConclusion', 'regionRanking',
        'longestHotNight', 'china-map', 'topCitiesContainer', 'generateBriefBtn']
        .forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
    assert.match(html, /class="dashboard-hero"/);
});

test('renders the dashboard hero from current sales intensity', () => {
    const ui = read('js/ui.js');
    assert.match(ui, /function renderDashboardHero\(\)/);
    assert.match(ui, /dashboardHeroTitle/);
    assert.match(ui, /dashboardHeroSummary/);
    assert.match(ui, /renderDashboardHero\(\);/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test tests/titanium-theme.test.js
```

Expected: FAIL because the hero targets and function do not exist.

- [ ] **Step 3: Add the dashboard hero and semantic grid classes**

Inside `#dashboard`, before `.dashboard-layout`, add:

```html
<section class="dashboard-hero" aria-labelledby="dashboardHeroTitle">
    <div>
        <p class="dashboard-eyebrow">全国实时销售机会</p>
        <h2 id="dashboardHeroTitle">正在分析今日机会…</h2>
        <p id="dashboardHeroSummary">正在汇总重点区域与城市信号</p>
    </div>
    <div class="dashboard-live-status">
        <span class="status-dot" aria-hidden="true"></span>
        实时天气数据
    </div>
</section>
```

Add the classes `dashboard-insights`, `dashboard-map`, and `dashboard-ranking` to the existing left, center, and right columns without removing their existing classes or IDs.

- [ ] **Step 4: Implement dynamic hero copy**

In `js/ui.js`, place this function before `renderDashboard(cityData)`:

```js
function renderDashboardHero() {
    const title = document.getElementById('dashboardHeroTitle');
    const summary = document.getElementById('dashboardHeroSummary');
    if (!title || !summary || state.cityData.length === 0) return;

    const intensity = Core.calculateSalesIntensity(state.cityData);
    const regionStats = Core.calculateRegionStats(state.cityData);
    const regions = Object.entries(regionStats)
        .sort((a, b) => {
            const scoreA = a[1].explosiveCount * 2 + a[1].actionCount;
            const scoreB = b[1].explosiveCount * 2 + b[1].actionCount;
            return scoreB - scoreA;
        })
        .slice(0, 3)
        .map(([name]) => name);

    title.textContent = `今天，机会${intensity === '中' ? '正在增强' : intensity + '。'}`;
    summary.textContent = regions.length
        ? `${regions.join('、')}出现当前最集中的销售信号`
        : '当前未发现明显集中的区域销售信号';
}
```

Call it from `renderDashboard(cityData)` immediately after `state.cityData = cityData;`:

```js
renderDashboardHero();
```

- [ ] **Step 5: Add dashboard grid styles**

Append:

```css
.dashboard-hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin: 6px 2px 22px;
}

.dashboard-eyebrow {
    margin-bottom: 8px;
    color: var(--titanium-text-muted);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.dashboard-hero h2 {
    margin: 0;
    color: var(--titanium-text);
    font-size: clamp(32px, 3vw, 44px);
    line-height: 1.02;
    letter-spacing: -0.055em;
}

.dashboard-hero p:last-child {
    margin-top: 10px;
    color: var(--titanium-text-secondary);
    font-size: 14px;
}

.dashboard-live-status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    color: var(--titanium-text-secondary);
    font-size: 13px;
}

.dashboard-layout {
    display: grid;
    grid-template-columns: minmax(230px, 0.9fr) minmax(520px, 2fr) minmax(260px, 1fr);
    gap: 14px;
}

.sidebar-card,
.map-section,
.top-cities-section {
    background: linear-gradient(145deg, rgba(44, 44, 46, 0.78), rgba(22, 22, 24, 0.72));
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-md);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.05), var(--titanium-shadow);
}

.view-mode-toggle,
.top-tabs,
.dimension-toggle {
    padding: 3px;
    background: rgba(255, 255, 255, 0.07);
    border-radius: var(--titanium-radius-sm);
}

.view-mode-btn,
.top-tab,
.dimension-btn {
    min-height: 38px;
    border-radius: 8px;
    color: var(--titanium-text-secondary);
}

.view-mode-btn.active,
.top-tab.active,
.dimension-btn.active {
    color: var(--titanium-text);
    background: rgba(255, 255, 255, 0.12);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 6: Run tests and verify the rendered dashboard**

Run:

```bash
node --test tests/titanium-theme.test.js
node tests/rain-monitor.test.js
```

Expected: all tests PASS. Browser check confirms a three-column dashboard at 1440px with the map as the largest panel.

- [ ] **Step 7: Commit the dashboard redesign**

```bash
git add index-v2.html css/titanium-theme.css js/ui.js tests/titanium-theme.test.js
git commit -m "feat: redesign sales overview dashboard"
```

---

### Task 4: Shared Toolbars, Tables, Analysis, and Rain Monitor Repair

**Files:**
- Modify: `index-v2.html:234-373`
- Modify: `css/titanium-theme.css`
- Modify: `js/ui.js:1007-1595`
- Modify: `tests/titanium-theme.test.js`

**Interfaces:**
- Produces: `.data-toolbar`, `.data-toolbar-search`, `.segmented-control`, `.filter-chip`, `.data-table-shell`.
- Produces: `bindTooltipEvents(container: HTMLElement): void`.
- Preserves: all report/rain search input IDs, filter IDs, table head/body IDs, and `.dimension-btn[data-dimension]`.

- [ ] **Step 1: Add failing data workspace and runtime repair tests**

Append:

```js
test('uses shared data workspace classes on report and rain pages', () => {
    const html = read('index-v2.html');
    assert.ok((html.match(/class="[^"]*data-toolbar[^"]*"/g) || []).length >= 2);
    assert.ok((html.match(/class="[^"]*data-table-shell[^"]*"/g) || []).length >= 2);
});

test('rain monitor resolves its active dimension and tooltip binder', () => {
    const ui = read('js/ui.js');
    assert.doesNotMatch(ui, /#rainMonitorPage/);
    assert.match(ui, /#rainMonitor \.dimension-btn\.active/);
    assert.match(ui, /function bindTooltipEvents\(container\)/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test tests/titanium-theme.test.js
```

Expected: FAIL because shared classes and `bindTooltipEvents` are absent, and `#rainMonitorPage` remains.

- [ ] **Step 3: Apply shared workspace classes**

For both `#report` and `#rainMonitor`:

- Wrap the search box, dimension toggle, and filter bar in:

```html
<div class="data-toolbar glass-panel">
    <!-- existing search, dimension, and filter controls stay here -->
</div>
```

- Add `data-toolbar-search` to the existing `.search-box`.
- Add `segmented-control` to `.dimension-toggle`.
- Add `filter-chip` to every `.filter-btn`.
- Add `data-table-shell` to `.forecast-table-wrapper`.

On the analysis page, add `data-table-shell` to dynamically rendered `.subpage-table-wrapper` and `.citygroup-table-wrapper` class lists in `js/ui.js`.

- [ ] **Step 4: Repair rain dimension lookup and implement tooltip binding**

In `renderRainMonitorPage()`, replace:

```js
const currentDimension = document.querySelector('#rainMonitorPage .dimension-btn.active')?.dataset.dimension || 'rainInsurance';
```

with:

```js
const currentDimension = document.querySelector('#rainMonitor .dimension-btn.active')?.dataset.dimension || 'rainInsurance';
```

Add before `renderRainMonitorPage()`:

```js
function bindTooltipEvents(container) {
    if (!container || container.dataset.tooltipBound === 'true') return;
    container.dataset.tooltipBound = 'true';

    container.addEventListener('mouseover', (event) => {
        const cell = event.target.closest('td[data-city][data-day]');
        if (!cell || !container.contains(cell)) return;
        const city = state.cityData.find((item) => item.cityName === cell.dataset.city);
        const dayIndex = Number(cell.dataset.day);
        const dayData = city?.future7Days?.[dayIndex];
        if (!city || !dayData) return;

        const tooltip = showDayTooltip(city, dayData, dayIndex);
        const rect = cell.getBoundingClientRect();
        tooltip.style.left = `${Math.min(rect.left, window.innerWidth - 340)}px`;
        tooltip.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 320)}px`;
        tooltip.classList.add('show');
    });

    container.addEventListener('mouseout', (event) => {
        const cell = event.target.closest('td[data-city][data-day]');
        if (!cell || !container.contains(cell)) return;
        if (cell.contains(event.relatedTarget)) return;
        hideDayTooltip();
    });
}
```

- [ ] **Step 5: Add shared toolbar and table styles**

Append:

```css
.data-toolbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
    padding: 12px;
}

.data-toolbar-search {
    flex: 1 1 240px;
    min-width: 220px;
    margin: 0;
}

.data-toolbar input {
    min-height: 44px;
    color: var(--titanium-text);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-sm);
}

.filter-bar {
    gap: 6px;
    margin: 0;
}

.filter-chip,
.filter-btn {
    min-height: 36px;
    color: var(--titanium-text-secondary);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 999px;
}

.filter-chip:hover,
.filter-btn:hover {
    color: var(--titanium-text);
    background: rgba(255, 255, 255, 0.07);
    border-color: var(--titanium-border);
}

.filter-chip.active,
.filter-btn.active {
    color: var(--titanium-text);
    background: rgba(94, 141, 255, 0.18);
    border-color: rgba(94, 141, 255, 0.42);
}

.data-table-shell,
.forecast-table-wrapper,
.subpage-table-wrapper,
.citygroup-table-wrapper {
    background: rgba(20, 20, 22, 0.68);
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-md);
    box-shadow: var(--titanium-shadow);
}

.forecast-table thead th,
.subpage-table thead th,
.citygroup-table thead th {
    background: rgba(28, 28, 30, 0.92);
    color: var(--titanium-text-secondary);
    border-color: var(--titanium-border);
    backdrop-filter: blur(18px);
}

.forecast-table tbody td,
.subpage-table tbody td,
.citygroup-table tbody td {
    color: var(--titanium-text);
    border-color: rgba(255, 255, 255, 0.06);
}

.forecast-table tbody tr:hover,
.subpage-table tbody tr:hover,
.citygroup-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.05);
}

.forecast-tooltip {
    width: min(320px, calc(100vw - 24px));
    color: var(--titanium-text);
    background: rgba(35, 35, 38, 0.92);
    border: 1px solid var(--titanium-border-strong);
    border-radius: var(--titanium-radius-md);
    box-shadow: var(--titanium-shadow);
    backdrop-filter: var(--titanium-blur);
}
```

- [ ] **Step 6: Run unit, syntax, and browser interaction checks**

Run:

```bash
node --test tests/titanium-theme.test.js
node tests/rain-monitor.test.js
node --check js/ui.js
```

Expected: all commands PASS.

Browser checks:

1. Open 7 天预测 and switch all five dimensions.
2. Search “上海” and clear the search.
3. Open 降水监控 and switch between 投保提醒 and 雨后湿热.
4. Hover a rain data cell and confirm a titanium Tooltip appears.
5. Confirm no `bindTooltipEvents is not defined` error is logged.

- [ ] **Step 7: Commit the data workspace redesign**

```bash
git add index-v2.html css/titanium-theme.css js/ui.js tests/titanium-theme.test.js
git commit -m "feat: unify analysis and forecast workspaces"
```

---

### Task 5: Rules Settings and Unsaved-State Feedback

**Files:**
- Modify: `index-v2.html:374-424`
- Modify: `css/titanium-theme.css`
- Modify: `js/ui.js:1674-1793`
- Modify: `tests/titanium-theme.test.js`

**Interfaces:**
- Produces: `setRulesStatus(status: 'saved' | 'dirty'): void`.
- Produces: DOM target `#rulesSaveStatus`.
- Preserves: `UI.saveRules()`, `UI.resetRules()`, `UI.updateWeightTotal()`.

- [ ] **Step 1: Add failing rules status tests**

Append:

```js
test('rules page exposes saved and dirty visual status', () => {
    const html = read('index-v2.html');
    const ui = read('js/ui.js');
    assert.match(html, /id="rulesSaveStatus"/);
    assert.match(ui, /function setRulesStatus\(status\)/);
    assert.match(ui, /setRulesStatus\('dirty'\)/);
    assert.match(ui, /setRulesStatus\('saved'\)/);
});
```

- [ ] **Step 2: Run the test to verify failure**

Run:

```bash
node --test tests/titanium-theme.test.js
```

Expected: FAIL because the status target and function are absent.

- [ ] **Step 3: Add the sticky settings action bar**

Replace the current `.settings-actions` contents with:

```html
<div class="rules-save-status" id="rulesSaveStatus" data-status="saved" role="status">
    已保存
</div>
<div class="settings-action-buttons">
    <button class="btn btn-secondary" type="button" onclick="UI.resetRules()">恢复默认设置</button>
    <button class="btn btn-primary" type="button" onclick="UI.saveRules()">保存配置</button>
</div>
```

- [ ] **Step 4: Implement front-end dirty-state feedback**

Add:

```js
function setRulesStatus(status) {
    const target = document.getElementById('rulesSaveStatus');
    if (!target) return;
    target.dataset.status = status;
    target.textContent = status === 'dirty' ? '存在未保存修改' : '已保存';
}
```

At the end of `renderRules()`, add:

```js
container.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => setRulesStatus('dirty'));
});
setRulesStatus('saved');
```

Replace `saveRules()` with:

```js
function saveRules() {
    setRulesStatus('saved');
    showToast('规则配置已保存');
}
```

In `resetRules()`, after `renderRules();`, add:

```js
setRulesStatus('dirty');
```

- [ ] **Step 5: Add rules styles**

Append:

```css
.alert-guide,
.rules-section {
    background: var(--titanium-surface);
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-md);
}

.alert-guide-grid {
    gap: 8px;
}

.guide-card {
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid var(--titanium-border);
    border-left-width: 3px;
    border-radius: var(--titanium-radius-sm);
}

.rule-field input[type="number"] {
    min-height: 44px;
    color: var(--titanium-text);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-sm);
}

.settings-actions {
    position: sticky;
    bottom: 12px;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: rgba(28, 28, 30, 0.90);
    border: 1px solid var(--titanium-border-strong);
    border-radius: var(--titanium-radius-md);
    box-shadow: var(--titanium-shadow);
    backdrop-filter: var(--titanium-blur);
}

.rules-save-status {
    color: var(--titanium-success);
    font-size: 13px;
}

.rules-save-status[data-status="dirty"] {
    color: var(--titanium-warning);
}

.settings-action-buttons {
    display: flex;
    gap: 10px;
}
```

- [ ] **Step 6: Run tests and verify settings behavior**

Run:

```bash
node --test tests/titanium-theme.test.js
node --check js/ui.js
```

Expected: PASS. Browser check confirms editing a numeric input changes the label to “存在未保存修改”, and clicking 保存配置 returns it to “已保存”.

- [ ] **Step 7: Commit the settings redesign**

```bash
git add index-v2.html css/titanium-theme.css js/ui.js tests/titanium-theme.test.js
git commit -m "feat: redesign rules settings workspace"
```

---

### Task 6: Modals, Authentication, Payment, Loading, and Feedback

**Files:**
- Modify: `index-v2.html:425-556`
- Modify: `css/titanium-theme.css`
- Modify: `js/ui.js:1795-1988`
- Modify: `tests/titanium-theme.test.js`

**Interfaces:**
- Produces: `.modal-surface`, `.titanium-input`, `.pricing-card`, `.feedback-toast`.
- Preserves: all modal IDs, form input IDs, inline close handlers, `Auth` and `Payment` method calls.

- [ ] **Step 1: Add failing modal and form contract tests**

Append:

```js
test('applies titanium surfaces to all product modals', () => {
    const html = read('index-v2.html');
    ['cityDetailModal', 'dailyBriefModal', 'loginModal', 'paymentModal'].forEach((id) => {
        const pattern = new RegExp(`id="${id}"[\\s\\S]{0,500}modal-surface`);
        assert.match(html, pattern);
    });
});

test('login controls retain labels and accessible input modes', () => {
    const html = read('index-v2.html');
    assert.match(html, /for="loginPhone"/);
    assert.match(html, /id="loginPhone"[^>]*inputmode="numeric"/);
    assert.match(html, /for="loginCode"/);
    assert.match(html, /id="loginCode"[^>]*inputmode="numeric"/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test tests/titanium-theme.test.js
```

Expected: FAIL because modal surface classes and explicit labels/input modes are absent.

- [ ] **Step 3: Update modal and form markup**

- Add `modal-surface` to every `.modal-content` inside `#cityDetailModal`, `#dailyBriefModal`, `#loginModal`, and `#paymentModal`.
- Add `titanium-input` to `#loginPhone` and `#loginCode`.
- Add explicit labels:

```html
<label for="loginPhone">手机号</label>
<input type="tel" id="loginPhone" class="titanium-input"
    placeholder="请输入手机号" maxlength="11" inputmode="numeric" autocomplete="tel">
```

```html
<label for="loginCode">验证码</label>
<input type="text" id="loginCode" class="titanium-input"
    placeholder="请输入验证码" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
```

- Add `pricing-card` to both `.payment-plan` elements.
- Replace the visible WeChat Emoji mark with:

```html
<div class="wechat-qr-placeholder" role="img" aria-label="微信登录二维码区域">
    <span>登录二维码将在服务接入后显示</span>
</div>
```

- Add `feedback-toast` to `#toast`.

- [ ] **Step 4: Ensure dynamically rendered city modal uses the surface class**

In `showCityDetail()`, do not replace the outer `#cityDetailModal` structure. Ensure the generated content root begins with:

```html
<div class="modal-header titanium-modal-header">
```

and the generated metric items use:

```html
<div class="detail-item surface-raised">
```

- [ ] **Step 5: Add modal, pricing, loading, and feedback styles**

Append:

```css
.modal-overlay {
    background: rgba(0, 0, 0, 0.64);
    backdrop-filter: blur(14px);
}

.modal-surface,
.modal-content {
    color: var(--titanium-text);
    background: rgba(32, 32, 35, 0.92);
    border: 1px solid var(--titanium-border-strong);
    border-radius: var(--titanium-radius-lg);
    box-shadow: 0 28px 90px rgba(0, 0, 0, 0.52);
    backdrop-filter: var(--titanium-blur);
}

.modal-close {
    width: 44px;
    height: 44px;
    color: var(--titanium-text-secondary);
    background: rgba(255, 255, 255, 0.07);
    border-radius: 50%;
}

.titanium-input,
.login-form input {
    min-height: 48px;
    color: var(--titanium-text);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-sm);
}

.pricing-card,
.payment-plan {
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid var(--titanium-border);
    border-radius: var(--titanium-radius-md);
}

.payment-plan.featured {
    border-color: rgba(94, 141, 255, 0.50);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.06), 0 20px 50px rgba(94, 141, 255, 0.12);
}

.wechat-qr-placeholder {
    display: grid;
    place-items: center;
    width: 220px;
    aspect-ratio: 1;
    margin: 18px auto;
    padding: 24px;
    color: var(--titanium-text-muted);
    text-align: center;
    background:
        linear-gradient(90deg, var(--titanium-border) 1px, transparent 1px),
        linear-gradient(var(--titanium-border) 1px, transparent 1px);
    background-size: 14px 14px;
    border: 1px solid var(--titanium-border-strong);
    border-radius: var(--titanium-radius-md);
}

.feedback-toast,
.toast {
    color: var(--titanium-text);
    background: rgba(44, 44, 46, 0.94);
    border: 1px solid var(--titanium-border-strong);
    border-radius: var(--titanium-radius-sm);
    box-shadow: var(--titanium-shadow);
    backdrop-filter: var(--titanium-blur);
}

.loading-screen {
    background: var(--titanium-bg);
}

.loading-logo {
    color: var(--titanium-text);
    background: none;
    -webkit-text-fill-color: currentColor;
}

.loading-progress {
    background: linear-gradient(90deg, #6e6e73, #f5f5f7, #6e6e73);
}

.forecast-table-wrapper,
.analysis-content,
.top-cities-list {
    min-height: 240px;
}
```

- [ ] **Step 6: Run tests and modal smoke checks**

Run:

```bash
node --test tests/titanium-theme.test.js
node --check js/ui.js
node --check js/auth.js
node --check js/payment.js
```

Expected: all commands PASS.

Browser checks:

1. Open a city detail from the dashboard.
2. Open 今日简报 and switch both tabs.
3. Open 登录 and switch phone/WeChat tabs.
4. Open the payment modal without submitting a transaction.
5. Confirm all four surfaces share the same radius, border, blur, and button hierarchy.

- [ ] **Step 7: Commit modal and feedback redesign**

```bash
git add index-v2.html css/titanium-theme.css js/ui.js tests/titanium-theme.test.js
git commit -m "feat: redesign dialogs forms and feedback"
```

---

### Task 7: Titanium Map Palette and Tooltip

**Files:**
- Modify: `js/map.js:1-490`
- Modify: `css/titanium-theme.css`
- Modify: `tests/titanium-theme.test.js`

**Interfaces:**
- Produces: `TITANIUM_MAP_THEME` constant inside `MapModule`.
- Consumes: existing ECharts option generation and `Core.getLevelInfo`.
- Preserves: `MapModule.init()`, `MapModule.render(cityData, viewMode)`, map click behavior, and city highlight behavior.

- [ ] **Step 1: Add failing map theme test**

Append:

```js
test('map module defines and uses the titanium map theme', () => {
    const map = read('js/map.js');
    assert.match(map, /const TITANIUM_MAP_THEME = \{/);
    assert.match(map, /areaColor: TITANIUM_MAP_THEME\.area/);
    assert.match(map, /borderColor: TITANIUM_MAP_THEME\.border/);
    assert.match(map, /class="map-tooltip titanium-map-tooltip"/);
});
```

- [ ] **Step 2: Run the test to verify failure**

Run:

```bash
node --test tests/titanium-theme.test.js
```

Expected: FAIL because `TITANIUM_MAP_THEME` is absent.

- [ ] **Step 3: Define and apply the map theme**

Inside the `MapModule` IIFE, add:

```js
const TITANIUM_MAP_THEME = {
    area: '#242426',
    areaEmphasis: '#343438',
    border: 'rgba(255, 255, 255, 0.16)',
    shadow: 'rgba(0, 0, 0, 0.35)',
    text: '#f5f5f7',
    textSecondary: '#a1a1a6'
};
```

Replace the geo style with:

```js
itemStyle: {
    areaColor: TITANIUM_MAP_THEME.area,
    borderColor: TITANIUM_MAP_THEME.border,
    borderWidth: 0.8,
    shadowColor: TITANIUM_MAP_THEME.shadow,
    shadowBlur: 8
},
emphasis: {
    itemStyle: {
        areaColor: TITANIUM_MAP_THEME.areaEmphasis
    }
},
```

Change every generated map tooltip root to:

```html
<div class="map-tooltip titanium-map-tooltip" style="border-left: 3px solid ${levelInfo.color}">
```

For the loading-data tooltip, use:

```html
<div class="map-tooltip titanium-map-tooltip titanium-map-tooltip-loading">
```

- [ ] **Step 4: Add titanium map styles**

Append:

```css
#china-map {
    border-radius: calc(var(--titanium-radius-md) - 1px);
    overflow: hidden;
    background:
        radial-gradient(circle at 68% 68%, rgba(255, 69, 58, 0.10), transparent 18%),
        radial-gradient(circle at 62% 42%, rgba(255, 159, 10, 0.08), transparent 20%),
        #111113;
}

.titanium-map-tooltip {
    min-width: 220px;
    color: var(--titanium-text);
    background: rgba(35, 35, 38, 0.94);
    border-top: 1px solid var(--titanium-border-strong);
    border-right: 1px solid var(--titanium-border-strong);
    border-bottom: 1px solid var(--titanium-border-strong);
    border-radius: var(--titanium-radius-sm);
    box-shadow: var(--titanium-shadow);
    backdrop-filter: var(--titanium-blur);
}

.titanium-map-tooltip .tooltip-reason,
.titanium-map-tooltip .tooltip-mode-badge {
    color: var(--titanium-text-secondary);
}
```

- [ ] **Step 5: Run tests and map interaction checks**

Run:

```bash
node --test tests/titanium-theme.test.js
node --check js/map.js
```

Expected: PASS.

Browser checks:

1. Switch ADI、夜间温度、体感温度、白天最高温.
2. Hover representative provinces in each mode.
3. Click a mapped city and confirm the existing city detail opens.
4. Confirm the map remains legible without a neon-blue base.

- [ ] **Step 6: Commit map redesign**

```bash
git add js/map.js css/titanium-theme.css tests/titanium-theme.test.js
git commit -m "feat: apply titanium map presentation"
```

---

### Task 8: Responsive Layout, Accessibility, and Motion

**Files:**
- Modify: `index-v2.html`
- Modify: `css/titanium-theme.css`
- Modify: `tests/titanium-theme.test.js`

**Interfaces:**
- Consumes: all components and layout classes from Tasks 1–7.
- Produces: responsive behavior at `1439px`, `1023px`, and `767px`.
- Produces: reduced-motion behavior and accessible icon-button labels.

- [ ] **Step 1: Add failing responsive and accessibility tests**

Append:

```js
test('defines all required responsive breakpoints and reduced motion', () => {
    const css = read('css/titanium-theme.css');
    assert.match(css, /@media \(max-width: 1439px\)/);
    assert.match(css, /@media \(max-width: 1023px\)/);
    assert.match(css, /@media \(max-width: 767px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('icon-only controls have accessible names', () => {
    const html = read('index-v2.html');
    const iconButtons = [...html.matchAll(/<button[^>]*class="[^"]*(?:modal-close|clear-search-btn)[^"]*"[^>]*>/g)];
    assert.ok(iconButtons.length >= 4);
    iconButtons.forEach(([button]) => assert.match(button, /aria-label=/));
});

test('theme defines minimum touch target and visible focus styles', () => {
    const css = read('css/titanium-theme.css');
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /:focus-visible/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test tests/titanium-theme.test.js
```

Expected: FAIL until all breakpoints and accessible names are present.

- [ ] **Step 3: Add accessible labels to icon-only controls**

Add precise `aria-label` attributes:

```html
<button class="clear-search-btn" id="clearSearchBtn" aria-label="清除城市搜索">…</button>
<button class="clear-search-btn" id="clearRainSearchBtn" aria-label="清除降水城市搜索">…</button>
<button class="modal-close" aria-label="关闭城市详情">…</button>
<button class="modal-close" aria-label="关闭今日简报">…</button>
<button class="modal-close" aria-label="关闭登录窗口">…</button>
<button class="modal-close" aria-label="关闭支付窗口">…</button>
```

Preserve each existing `onclick` handler.

- [ ] **Step 4: Add responsive and reduced-motion CSS**

Append:

```css
@media (max-width: 1439px) {
    .dashboard-layout {
        grid-template-columns: minmax(220px, 0.8fr) minmax(520px, 1.8fr);
    }

    .dashboard-ranking {
        grid-column: 1 / -1;
    }

    .right-sidebar {
        min-height: 320px;
    }

    .header-stat:nth-child(4),
    .header-stat:nth-child(5) {
        display: none;
    }
}

@media (max-width: 1023px) {
    .sidebar {
        width: 78px;
    }

    .logo h1,
    .logo p,
    .nav-text,
    .nav-expand,
    .sidebar-footer span:not(.status-dot) {
        display: none;
    }

    .nav-item {
        justify-content: center;
        padding-inline: 0;
    }

    .nav-icon {
        width: 20px;
        height: 20px;
    }

    .dashboard-layout,
    .rules-sections {
        grid-template-columns: 1fr;
    }

    .dashboard-map {
        grid-row: 1;
    }

    .header-stats {
        gap: 12px;
    }

    .data-toolbar {
        align-items: stretch;
    }
}

@media (max-width: 767px) {
    body {
        overflow: auto;
    }

    .app-container {
        display: block;
        min-height: 100vh;
    }

    .sidebar {
        position: sticky;
        top: 0;
        z-index: 100;
        width: auto;
        height: 64px;
        margin: 0;
        padding: 8px;
        border-radius: 0 0 var(--titanium-radius-md) var(--titanium-radius-md);
    }

    .nav-menu {
        display: flex;
        justify-content: space-around;
        padding: 0;
    }

    .nav-item {
        width: 48px;
        min-height: 48px;
        margin: 0;
    }

    .nav-submenu,
    .sidebar-footer,
    .logo {
        display: none;
    }

    .main-content {
        overflow: visible;
    }

    .header {
        height: auto;
        min-height: 64px;
        margin: 10px;
        padding: 12px;
    }

    .header-stats,
    .current-time {
        display: none;
    }

    .content-area {
        padding: 10px;
    }

    .dashboard-hero {
        align-items: flex-start;
        flex-direction: column;
    }

    .dashboard-hero h2 {
        font-size: 32px;
    }

    .dashboard-layout {
        display: flex;
        flex-direction: column;
    }

    .data-toolbar {
        position: static;
        flex-direction: column;
    }

    .modal-content {
        width: calc(100% - 20px);
        max-height: calc(100vh - 20px);
        margin-top: 10px;
    }
}

@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        scroll-behavior: auto !important;
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}
```

- [ ] **Step 5: Run static accessibility tests**

Run:

```bash
node --test tests/titanium-theme.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Run viewport checks**

Start:

```bash
python3 -m http.server 4173
```

Verify these exact viewport sizes in the browser:

- 1920×1080: complete three-column dashboard.
- 1440×900: complete dashboard with no overlap.
- 1024×768: collapsed icon navigation and usable map/table.
- 390×844: top navigation, single-column cards, scrollable tables.

At each viewport verify:

1. No page-level horizontal overflow except inside data-table containers.
2. Current navigation item remains visible.
3. Search, filters, dimension switches, modal close buttons, and save buttons remain reachable.
4. Focus rings are visible when using the Tab key.

- [ ] **Step 7: Commit responsive and accessibility work**

```bash
git add index-v2.html css/titanium-theme.css tests/titanium-theme.test.js
git commit -m "feat: add responsive and accessible titanium UI"
```

---

### Task 9: Full Regression and Visual Acceptance

**Files:**
- Modify only if verification finds a regression:
  - `index-v2.html`
  - `css/titanium-theme.css`
  - `js/ui.js`
  - `js/map.js`
  - `tests/titanium-theme.test.js`

**Interfaces:**
- Consumes: completed implementation from Tasks 1–8.
- Produces: verified full-site titanium UI with no new console errors.

- [ ] **Step 1: Run the complete automated verification suite**

Run:

```bash
node --test tests/titanium-theme.test.js
node tests/rain-monitor.test.js
for file in js/*.js api/**/*.js; do node --check "$file"; done
git diff --check
```

Expected:

- Titanium contract tests: PASS.
- Rain monitor tests: 8 PASS, 0 FAIL.
- Every JavaScript syntax check exits 0.
- `git diff --check` produces no output.

- [ ] **Step 2: Run full browser navigation regression**

Start:

```bash
python3 -m http.server 4173
```

At 1440×900:

1. Wait for the dashboard to render 131 city records.
2. Switch all four map dimensions.
3. Switch all three dashboard city ranking tabs.
4. Open each 热销分析 subpage.
5. Open 7 天预测; test all five dimensions, search, clear, and one regional filter.
6. Open 降水监控; test both dimensions, search, clear, and one regional filter.
7. Open 规则设置; change one weight, verify dirty state, then save.
8. Open city details, daily brief, login, WeChat placeholder, and payment modal.
9. Read console errors and confirm no new errors originate from the changed files.

- [ ] **Step 3: Compare against the approved visual direction**

Capture screenshots at:

- 1920×1080 dashboard.
- 1440×900 7 天预测.
- 1024×768 降水监控.
- 390×844 规则设置.

Check each screenshot against:

- Near-black titanium background.
- Glass sidebar/header/panels.
- Silver borders and restrained shadows.
- Energy colors limited to map and business status.
- No Orbitron typography.
- No navigation Emoji.
- Consistent 10/16/22px radius scale.

- [ ] **Step 4: Fix only verified regressions and rerun affected checks**

For every failure:

1. Record the failing page, viewport, console message, or assertion.
2. Make the smallest change in the owning file.
3. Add or tighten an assertion in `tests/titanium-theme.test.js` when the defect is statically testable.
4. Rerun the failing command or browser path.
5. Rerun the complete suite from Step 1.

- [ ] **Step 5: Commit final verification adjustments**

If files changed:

```bash
git add index-v2.html css/titanium-theme.css js/ui.js js/map.js tests/titanium-theme.test.js
git commit -m "fix: complete titanium visual regression pass"
```

If no files changed, do not create an empty commit.

- [ ] **Step 6: Prepare handoff summary**

Report:

- Changed files.
- Automated verification results.
- Browser viewports checked.
- Existing backend limitations intentionally left unchanged.
- Any existing console error that remains outside the visual redesign scope.
