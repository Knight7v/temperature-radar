# 首页体感温度色阶调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将首页地图体感温度上限调整为 45°C，并按严格边界显示连续加深的低温、黄色、橙色和红色色阶。

**Architecture:** 在现有 `js/map.js` 内增加一个纯函数，负责体感温度分段插值和上下限钳制。首页体感模式的地图数据、视觉映射、图例和悬浮提示统一复用该规则，避免不同 UI 位置出现颜色偏差。

**Tech Stack:** 浏览器原生 JavaScript、ECharts、Node.js `assert`/`vm` 测试

## Global Constraints

- 仅修改首页地图体感温度模式。
- 26°C 仍为低温色；27–35°C 为黄色系；36–40°C 为橙色系；41°C 及以上为红色系。
- 色彩在每个区间内随温度升高逐渐加深。
- 首页体感温度显示上限为 45°C；超过 45°C 使用最深红色。
- 不修改 `.claude/settings.local.json`。

---

### Task 1: 体感温度色阶与首页地图配置

**Files:**
- Create: `tests/map-feels-like.test.js`
- Modify: `js/map.js:12-50, 228-425, 477-490`

**Interfaces:**
- Consumes: `city.feelsLike: number` 和现有 `MapModule.render(cityData, viewMode)`
- Produces: `MapModule.getFeelsLikeColor(temperature): string`，返回 `#RRGGBB` 颜色；`MapModule.getLegendConfig('feelsLike')` 返回更新后的严格区间文案

- [ ] **Step 1: 写出失败测试**

创建 `tests/map-feels-like.test.js`，通过 `vm` 加载浏览器 IIFE，并断言：

```js
assert.equal(MapModule.getFeelsLikeColor(26), '#4A90E2');
assert.match(MapModule.getFeelsLikeColor(27), /^#F[0-9A-F]{5}$/);
assert.notEqual(MapModule.getFeelsLikeColor(27), MapModule.getFeelsLikeColor(35));
assert.match(MapModule.getFeelsLikeColor(36), /^#F[0-9A-F]{5}$/);
assert.notEqual(MapModule.getFeelsLikeColor(36), MapModule.getFeelsLikeColor(40));
assert.match(MapModule.getFeelsLikeColor(41), /^#[CD][0-9A-F]{5}$/);
assert.equal(MapModule.getFeelsLikeColor(46), MapModule.getFeelsLikeColor(45));

const legend = MapModule.getLegendConfig('feelsLike');
assert.deepEqual(legend.items.map(item => item.label), ['≥41℃', '36-40℃', '27-35℃', '≤26℃']);
```

使用 ECharts 假对象捕获 `render(..., 'feelsLike')` 的 option，并断言：

```js
assert.equal(option.visualMap.min, 20);
assert.equal(option.visualMap.max, 45);
assert.equal(option.series[0].symbolSize([0, 0, 45]), 20);
assert.equal(option.series[0].data[0].itemStyle.color, MapModule.getFeelsLikeColor(41));
assert.match(option.tooltip.formatter({ data: option.series[0].data[0] }), /体感温度/);
assert.match(option.tooltip.formatter({ data: option.series[0].data[0] }), new RegExp(MapModule.getFeelsLikeColor(41), 'i'));
```

- [ ] **Step 2: 运行测试并确认因缺少新接口而失败**

运行：

```bash
node tests/map-feels-like.test.js
```

预期：测试失败，错误指出 `MapModule.getFeelsLikeColor` 不存在。

- [ ] **Step 3: 实现分段渐变纯函数**

在 `js/map.js` 的常量区域增加 RGB 插值工具和严格边界色阶：

```js
function interpolateColor(startHex, endHex, progress) {
    const clamped = Math.max(0, Math.min(1, progress));
    const start = startHex.match(/\w\w/g).map(value => parseInt(value, 16));
    const end = endHex.match(/\w\w/g).map(value => parseInt(value, 16));
    const channels = start.map((value, index) =>
        Math.round(value + (end[index] - value) * clamped)
    );
    return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function getFeelsLikeColor(temperature) {
    const value = Number.isFinite(Number(temperature)) ? Number(temperature) : 20;
    if (value <= 26) return interpolateColor('#00D4FF', '#4A90E2', (value - 20) / 6);
    if (value <= 35) return interpolateColor('#FFE082', '#F5A623', (value - 27) / 8);
    if (value <= 40) return interpolateColor('#FFB15C', '#F57C00', (value - 36) / 4);
    return interpolateColor('#D0021B', '#8B0012', (value - 41) / 4);
}
```

将该函数暴露为 `MapModule.getFeelsLikeColor`，供测试及后续一致性复用。

- [ ] **Step 4: 同步图例、量程、归一化、地图圆点和悬浮提示**

更新 `js/map.js`：

```js
items: [
    { label: '≥41℃', class: 'outbreak', desc: '极闷热' },
    { label: '36-40℃', class: 'action', desc: '闷热' },
    { label: '27-35℃', class: 'opportunity', desc: '炎热' },
    { label: '≤26℃', class: 'observe', desc: '舒适' }
]
```

体感量程与尺寸归一化改为 20–45°C；`getSplitListForMode('feelsLike')` 使用同样四段。生成地图数据时，为体感模式的数据项写入：

```js
itemStyle: viewMode === 'feelsLike'
    ? { color: getFeelsLikeColor(value) }
    : undefined
```

体感模式的 `visualMap.inRange.color` 使用 20–45°C 每个整数温度对应的颜色数组，悬浮提示的 `feelsLike` 分支调用 `getFeelsLikeColor(value)`。

- [ ] **Step 5: 运行定向测试并确认通过**

运行：

```bash
node tests/map-feels-like.test.js
```

预期：所有体感色阶、量程、图例、圆点及提示断言通过，退出码为 0。

- [ ] **Step 6: 运行完整回归检查**

运行：

```bash
node tests/map-feels-like.test.js
node tests/rain-monitor.test.js
node --check js/map.js
git diff --check
```

预期：两个测试文件均无失败，语法检查和差异检查退出码均为 0。

- [ ] **Step 7: 提交实现**

```bash
git add tests/map-feels-like.test.js js/map.js
git commit -m "feat: refine home feels-like temperature scale"
```
