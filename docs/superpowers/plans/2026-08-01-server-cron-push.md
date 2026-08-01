# 服务端 Cron 自动推送 + 去等级封顶 + API Key 入环境变量 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ADI 决策逻辑抽到共享模块,新增服务端 cron(每日北京 09:30)自动推送企业微信,删除等级封顶,并把和风天气 key 从前端迁到服务端环境变量(经 `/api/weather` 代理)。

**Architecture:** 抽取纯逻辑到 `js/adi-core.js`(UMD,前端 `<script>` + Node `require` 共用)。前端 `core.js` 改为消费该模块的浏览器胶水层;新增 `api/utils/qweather.js`(服务端抓取)、`api/weather.js`(代理)、`api/cron-push.js`(定时入口)。三处(前端、手动推送、定时推送)共用同一份 ADI 逻辑与城市清单。

**Tech Stack:** 原生 JS(UMD 模块)、Vercel Serverless Functions(`export default` handler)、Vercel Cron、Node 内置测试(`node:test` + `node:assert/strict`,Node v24)。

## Global Constraints

- 测试运行命令统一为 `node --test tests/`(无 `package.json`,Node 内置 runner)。
- 共享模块必须 UMD:同时支持 `window.ADICore = mod`(浏览器)与 `module.exports = mod`(Node)。参照 `js/rain-monitor.js` 的 UMD 写法。
- 浏览器需要 `require` 的共享模块必须放在 `js/`(Vercel 把 `/api/*` 视为 Serverless,浏览器无法 `<script>` 加载)。
- 仅服务端文件放在 `api/`,handler 用 `export default async function handler(req, res)`(参照 `api/push.js`)。
- 城市清单固定 131 城(`CITIES_CONFIG.length === 131`,已核实)。
- 推送时间:北京 09:30 = UTC 01:30 = cron `30 1 * * *`。
- 手动推送链路(`api/push.js` + 按钮行为)不得回归。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `js/adi-core.js`(新) | 单一事实源:ADI 配置/评分/等级/排行/解析/装配 + 摘要构造器。UMD。无 `fetch`/`localStorage`/`window` 依赖(降水富化用 `typeof window` 守卫)。 |
| `js/core.js`(改) | 浏览器胶水层:`fetchWeatherData`(走 `/api/weather`)、`generateCityData`(含 mock 降级)、`generateAllCityData`(去封顶)、`generate7DayDailyData`、`generateDailyBrief`、降水监控委派函数、`escapeHtml`、`QWEATHER_CONFIG`(去 key)。消费 `window.ADICore`。 |
| `js/push.js`(改) | 摘要构造委派给 `ADICore.buildSummary`;按钮 UX 不变。 |
| `api/utils/qweather.js`(新) | 服务端共享:`fetch7d(location, apiKey)`、`buildWeatherUrl`、`mapWithConcurrency`、短时内存缓存。UMD/CJS。 |
| `api/weather.js`(新) | `GET /api/weather?location=lng,lat` 代理 handler。ESM。 |
| `api/cron-push.js`(新) | cron 入口:抓全量城市→装配→摘要→达标推送。ESM。 |
| `vercel.json`(改) | 增加 `crons`。 |
| `index-v2.html`(改) | 在 `js/core.js` 之前加载 `js/adi-core.js`。 |
| `api/README.md`(改) | 文档化新环境变量。 |
| `tests/adi-core.test.js`(新) | 纯逻辑 + 摘要门控测试。 |
| `tests/core-wiring.test.js`(新) | core.js 装配 smoke + 去封顶断言。 |
| `tests/qweather.test.js`(新) | qweather 纯函数测试。 |
| `tests/vercel-config.test.js`(改) | 断言 cron 配置。 |

---

### Task 1: 创建 `js/adi-core.js`(决策逻辑)并加测试

**Files:**
- Create: `js/adi-core.js`
- Test: `tests/adi-core.test.js`

**Interfaces:**
- Produces: UMD 模块 `ADICore`,含 `calculateADI(data)`、`determineLevel(adiScore, data)`、`CITIES_CONFIG`、`LEVELS`、`ADI_CONFIG`、各 `score*`、`parseWeatherData(apiData, city)`、`assembleCityData(parsedData)`、`getTopHeatRise`、`getCitiesByLevel`、`getLevelStats`、`calculateSalesIntensity`、`calculateRegionStats`、`calculateLevelTrend`、`generateShortReason`、`generateReason`、`getLevelInfo`、`getLevelOrder`、`getTopByADI`、`getTopNightMuggy`、`getHotNightCities`、`getLongestHotNight`、`CITY_GROUPS`、`LEVEL_ORDER`。

- [ ] **Step 1: 写失败测试 `tests/adi-core.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ADICore = require(path.join(__dirname, '..', 'js', 'adi-core.js'));

test('CITIES_CONFIG has 131 cities', () => {
    assert.equal(ADICore.CITIES_CONFIG.length, 131);
});

test('calculateADI matches current core.js baselines', () => {
    const mild = { nightMinTemp: 26, maxTemp: 34, feelsLike: 35, continuousHotNightDays: 1, humidity: 70 };
    assert.equal(ADICore.calculateADI(mild).adiScore, 70);

    const maxed = { nightMinTemp: 29, maxTemp: 38, feelsLike: 41, continuousHotNightDays: 3, humidity: 80 };
    assert.equal(ADICore.calculateADI(maxed).adiScore, 100);
});

test('determineLevel applies force-upgrade for night min >= 28', () => {
    const force = { nightMinTemp: 29, maxTemp: 30, feelsLike: 30, continuousHotNightDays: 0, humidity: 50 };
    const r = ADICore.determineLevel(ADICore.calculateADI(force).adiScore, force);
    assert.equal(r.level, 'outbreak');
    assert.ok(r.triggeredRules.includes('夜间最低温≥28℃'));
});

test('determineLevel classifies mild input as opportunity', () => {
    const mild = { nightMinTemp: 26, maxTemp: 34, feelsLike: 35, continuousHotNightDays: 1, humidity: 70 };
    assert.equal(ADICore.determineLevel(70, mild).level, 'opportunity');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/adi-core.test.js`
Expected: FAIL — `Cannot find module '.../js/adi-core.js'`

- [ ] **Step 3: 创建 `js/adi-core.js`**

用与 `js/rain-monitor.js` 完全一致的 UMD 外壳:

```js
/**
 * ADI Core - 空调热销区域雷达 决策逻辑(单一事实源)
 * 浏览器:<script> → window.ADICore;Node:require() → module.exports。
 * 不含 fetch/localStorage;降水富化用 typeof window 守卫。
 */
(function (root, factory) {
    const moduleValue = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = moduleValue;
    }
    root.ADICore = moduleValue;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    // ===== 从 js/core.js 原样搬入以下定义(按当前行号定位,逐块剪切,不改逻辑)=====
    // ADI_CONFIG        (core.js:42-76)
    // LEVELS            (core.js:80-87)
    // LEVEL_ORDER       (core.js:89)
    // scoreNightMinTemp / scoreDayMaxTemp / scoreFeelsLike / scoreContinuousHeat / scoreHumidityMuggy
    //                   (core.js:490-534)
    // calculateADI      (core.js:538-572)
    // determineLevel    (core.js:576-598)
    // calculateNightMuggyScore (core.js:602-625)
    // isHotNight        (core.js:627-630)
    // generateShortReason (core.js:634-660)
    // calculateSalesIntensity (core.js:664-715)
    // calculateRegionStats (core.js:717-769)
    // calculateLevelTrend (core.js:887-912)
    // generateReason    (core.js:1201-1222)
    // getLevelStats     (core.js:1226-1230)
    // getHotNightCities (core.js:1232-1234)
    // getLongestHotNight(core.js:1236-1245)
    // getTopByADI       (core.js:1247)
    // getTopNightMuggy  (core.js:1249)
    // getTopHeatRise    (core.js:1251-1270)
    // getCitiesByLevel  (core.js:1289-1291)
    // getLevelInfo      (core.js:1305-1307)
    // getLevelOrder     (core.js:1309-1311)
    // CITIES_CONFIG     (core.js:354-486)
    // CITY_GROUPS       (core.js:321-350)
    // <— 搬入结束 —>

    return {
        ADI_CONFIG, LEVELS, LEVEL_ORDER, CITIES_CONFIG, CITY_GROUPS,
        scoreNightMinTemp, scoreDayMaxTemp, scoreFeelsLike, scoreContinuousHeat, scoreHumidityMuggy,
        calculateADI, determineLevel, calculateNightMuggyScore, isHotNight,
        generateShortReason, calculateSalesIntensity, calculateRegionStats,
        calculateLevelTrend, generateReason,
        getLevelStats, getHotNightCities, getLongestHotNight,
        getTopByADI, getTopNightMuggy, getTopHeatRise, getCitiesByLevel,
        getLevelInfo, getLevelOrder
    };
});
```

实现说明:把 core.js 中上述函数/常量的函数体**逐字**搬入工厂函数内(连同它们之间的内部引用,因同作用域可互相解析)。`parseWeatherData`、`assembleCityData`、摘要构造器留到 Task 2 再加。**先不要从 core.js 删除**(Task 3 才删),本任务只新建文件。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/adi-core.test.js`
Expected: PASS(4 tests)

- [ ] **Step 5: 提交**

```bash
git add js/adi-core.js tests/adi-core.test.js
git commit -m "feat: extract pure ADI decision logic into shared js/adi-core.js"
```

---

### Task 2: 给 `js/adi-core.js` 加 `parseWeatherData` + `assembleCityData` + 摘要构造器

**Files:**
- Modify: `js/adi-core.js`
- Test: `tests/adi-core.test.js`(追加)

**Interfaces:**
- Consumes: Task 1 的 `calculateADI`/`determineLevel`/`generateReason`/`generateShortReason`/`calculateLevelTrend`/`getTopHeatRise`/`getCitiesByLevel`/`getLevelStats`/`calculateSalesIntensity`/`calculateRegionStats`。
- Produces: `parseWeatherData(apiData, city)`、`assembleCityData(parsedData)`、`buildSummary(type, cityData, opts)`、`buildHeatFocusSummary(cityData, opts)`、`buildHeatRiseSummary(cityData, opts)`、`RULES = { heatRise: { minAdiChange: 10 } }`。

- [ ] **Step 1: 追加失败测试**

在 `tests/adi-core.test.js` 末尾追加:

```js
test('assembleCityData attaches adiScore/level/reason/trend', () => {
    const parsed = {
        cityName: '测试城', region: '华东', province: '测试',
        lat: 30, lng: 120,
        maxTemp: 34, nightMinTemp: 26, feelsLike: 35, humidity: 70, continuousHotNightDays: 1,
        future3DayMaxTemps: [34, 35, 36], future3NightMinTemps: [26, 26, 27],
        future7DayMaxTemps: [34, 35, 36, 36, 35, 34, 33],
        future7NightMinTemps: [26, 26, 27, 27, 26, 25, 25],
        future7AdiScores: [70, 72, 75, 76, 74, 70, 68],
        future7Days: [],
        nightMuggyScore: 0,
        updatedAt: '00:00'
    };
    const c = ADICore.assembleCityData(parsed);
    assert.equal(c.adiScore, 70);
    assert.equal(c.level, 'opportunity');
    assert.equal(typeof c.reason, 'string');
    assert.equal(c.levelTrend.currentLevel, 'opportunity');
});

test('buildHeatFocusSummary sets hasContent=false when no outbreak/action', () => {
    const cities = [
        { cityName: 'A', adiScore: 60, level: 'opportunity', region: '华东', future7AdiScores: [60, 60, 60] }
    ];
    const s = ADICore.buildSummary('heatFocus', cities, { updateTime: '08/01 09:30' });
    assert.equal(s.hasContent, false);
});

test('buildHeatFocusSummary sets hasContent=true with outbreak city', () => {
    const cities = [
        { cityName: 'A', adiScore: 90, level: 'outbreak', region: '华东', maxTemp: 38, nightMinTemp: 29, feelsLike: 41, future7AdiScores: [90, 90, 90] }
    ];
    const s = ADICore.buildSummary('heatFocus', cities, { updateTime: '08/01 09:30' });
    assert.equal(s.hasContent, true);
    assert.equal(s.outbreakCities[0].name, 'A');
});

test('buildHeatRiseSummary filters by minAdiChange=10', () => {
    const cities = [
        { cityName: 'R', adiScore: 60, level: 'opportunity', region: '华东', maxTemp: 33, nightMinTemp: 24,
          future7AdiScores: [60, 65, 75], future3DayMaxTemps: [33, 34, 36], future3NightMinTemps: [24, 25, 26] }
    ];
    const s = ADICore.buildSummary('heatRise', cities, { updateTime: '08/01 09:30' });
    assert.equal(s.hasContent, true);
    assert.equal(s.risingCities.length, 1);
    // adiChange = futureAdi3(75) - adiNow(60) = 15 >= 10
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/adi-core.test.js`
Expected: FAIL — `assembleCityData is not a function`

- [ ] **Step 3: 实现 — 搬入 `parseWeatherData` 并加守卫 + 新增 `assembleCityData` 与摘要构造器**

3a. 把 `parseWeatherData`(core.js:164-308)**逐字**搬入 adi-core 工厂内,仅改一处:把对 `window.RainMonitor` 的富化调用改为守卫。将 core.js:274-282 的:

```js
const enrichedFuture7Days = window.RainMonitor
    ? window.RainMonitor.enrichFuture7Days(future7Days)
    : future7Days;
const maxRainInsuranceLevel = window.RainMonitor
    ? window.RainMonitor.getMaxRainInsuranceLevel(enrichedFuture7Days)
    : 'none';
const maxPostRainMuggyLevel = window.RainMonitor
    ? window.RainMonitor.getMaxPostRainMuggyLevel(enrichedFuture7Days)
    : 'none';
```

改为(加 `typeof window` 守卫,服务端跳过):

```js
const RainMonitor = (typeof window !== 'undefined') ? window.RainMonitor : null;
const enrichedFuture7Days = RainMonitor
    ? RainMonitor.enrichFuture7Days(future7Days)
    : future7Days;
const maxRainInsuranceLevel = RainMonitor
    ? RainMonitor.getMaxRainInsuranceLevel(enrichedFuture7Days)
    : 'none';
const maxPostRainMuggyLevel = RainMonitor
    ? RainMonitor.getMaxPostRainMuggyLevel(enrichedFuture7Days)
    : 'none';
```

3b. 在 adi-core 工厂内新增 `assembleCityData`(封装 core.js `generateCityData` 中 API 成功路径的装配块):

```js
function assembleCityData(parsedData) {
    parsedData.nightMuggyScore = calculateNightMuggyScore(parsedData);
    const adiResult = calculateADI(parsedData);
    parsedData.adiScore = adiResult.adiScore;
    const levelResult = determineLevel(adiResult.adiScore, parsedData);
    const reason = generateReason(parsedData, adiResult.adiScore, levelResult.level, levelResult.triggeredRules);
    const shortReason = generateShortReason(parsedData, levelResult.level, levelResult.triggeredRules);
    const levelTrend = calculateLevelTrend(levelResult.level, parsedData.future7AdiScores);
    return {
        ...parsedData,
        adiBreakdown: adiResult.breakdown,
        level: levelResult.level,
        triggeredRules: levelResult.triggeredRules,
        reason, shortReason, levelTrend
    };
}
```

3c. 新增摘要构造器(把 `js/push.js` 的逻辑改为接收 `cityData` 的纯函数,返回纯数据对象,不含 HTML):

```js
const RULES = { heatRise: { minAdiChange: 10 } };

function fmtUpdateTime(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function toOutbreak(c) {
    return { name: c.cityName, adi: c.adiScore, maxTemp: c.maxTemp, nightMin: c.nightMinTemp, feelsLike: c.feelsLike };
}

function regionList(cityData) {
    return Object.entries(calculateRegionStats(cityData))
        .filter(([, st]) => st.explosiveCount > 0 || st.actionCount > 0)
        .sort((a, b) => (b[1].explosiveCount * 2 + b[1].actionCount) - (a[1].explosiveCount * 2 + a[1].actionCount))
        .slice(0, 3)
        .map(([name, st]) => ({
            name, level: st.level, explosive: st.explosiveCount,
            action: st.actionCount, reps: st.representativeCities || []
        }));
}

function buildHeatFocusSummary(cityData, opts) {
    const summary = {
        updateTime: (opts && opts.updateTime) || fmtUpdateTime(new Date()),
        totalCities: cityData.length,
        stats: { outbreak: 0, action: 0 }
    };
    const outbreak = getCitiesByLevel(cityData, 'outbreak');
    const action = getCitiesByLevel(cityData, 'action');
    const st = getLevelStats(cityData);
    summary.stats = { outbreak: st.outbreak || 0, action: st.action || 0 };
    summary.outbreakCities = outbreak.map(toOutbreak);
    summary.actionCities = action.map((c) => c.cityName);
    summary.activeRegions = regionList(cityData);
    summary.hasContent = outbreak.length > 0 || action.length > 0;
    return summary;
}

function buildHeatRiseSummary(cityData, opts) {
    const summary = {
        updateTime: (opts && opts.updateTime) || fmtUpdateTime(new Date()),
        totalCities: cityData.length
    };
    const minChg = RULES.heatRise.minAdiChange;
    const rising = getTopHeatRise(cityData, 50)
        .filter((c) => (c.adiChange || 0) >= minChg)
        .sort((a, b) => (b.adiChange || 0) - (a.adiChange || 0))
        .map((c) => ({
            name: c.cityName, adiNow: c.adiScore, adiFuture3: c.futureAdi3,
            adiChange: c.adiChange, maxTempChange: c.maxTempChange
        }));
    summary.risingCities = rising;
    summary.hasContent = rising.length > 0;
    return summary;
}

function buildSummary(type, cityData, opts) {
    if (type === 'heatFocus') return buildHeatFocusSummary(cityData, opts);
    if (type === 'heatRise') return buildHeatRiseSummary(cityData, opts);
    // brief:完整简报(强度+重点+升温+大区)
    const summary = {
        updateTime: (opts && opts.updateTime) || fmtUpdateTime(new Date()),
        totalCities: cityData.length,
        stats: { outbreak: 0, action: 0, opportunity: 0, observe: 0 }
    };
    summary.intensity = calculateSalesIntensity(cityData);
    const st = getLevelStats(cityData);
    summary.stats = { outbreak: st.outbreak || 0, action: st.action || 0, opportunity: st.opportunity || 0, observe: st.observe || 0 };
    summary.outbreakCities = getCitiesByLevel(cityData, 'outbreak').map(toOutbreak);
    summary.actionCities = getCitiesByLevel(cityData, 'action').map((c) => c.cityName);
    summary.risingCities = getTopHeatRise(cityData, 8).map((c) => ({
        name: c.cityName, adiNow: c.adiScore, adiFuture3: c.futureAdi3,
        adiChange: c.adiChange, maxTempChange: c.maxTempChange
    }));
    summary.activeRegions = regionList(cityData);
    return summary;
}
```

3d. 在 adi-core 的 `return { … }` 里追加导出:`parseWeatherData, assembleCityData, buildSummary, buildHeatFocusSummary, buildHeatRiseSummary, RULES`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/adi-core.test.js`
Expected: PASS(全部)

- [ ] **Step 5: 提交**

```bash
git add js/adi-core.js tests/adi-core.test.js
git commit -m "feat(adi-core): add parseWeatherData, assembleCityData, summary builders"
```

---

### Task 3: `js/core.js` 改为消费 `js/adi-core.js`;删除等级封顶;`index-v2.html` 加载脚本

**Files:**
- Modify: `js/core.js`(删搬走的定义、删封顶、顶部解构别名)
- Modify: `index-v2.html`(加 `<script src="js/adi-core.js">`)
- Test: `tests/core-wiring.test.js`

**Interfaces:**
- Consumes: `window.ADICore`(Task 1/2 产出)。
- Produces: 仍暴露全局 `Core`(词法 `const`),`Core.*` 对外 API 不变,供 `app.js`/`ui.js`/`push.js` 使用。

- [ ] **Step 1: 写失败测试 `tests/core-wiring.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function loadCore() {
    const sandbox = {
        console,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        AbortController, setTimeout, clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const src = read('js/adi-core.js') + '\n' + read('js/core.js') + '\n;globalThis.__Core = Core;';
    vm.runInContext(src, sandbox);
    return sandbox;
}

test('index-v2.html loads adi-core.js before core.js', () => {
    const html = read('index-v2.html');
    const adiIdx = html.indexOf('js/adi-core.js');
    const coreIdx = html.indexOf('js/core.js');
    assert.ok(adiIdx > 0, 'adi-core.js script tag must exist');
    assert.ok(coreIdx > adiIdx, 'adi-core.js must load before core.js');
});

test('core.js no longer applies level capping', () => {
    const src = read('js/core.js');
    assert.equal(src.includes('MAX_OUTBREAK'), false);
    assert.equal(src.includes('actionThreshold'), false);
});

test('Core loads via ADICore and keeps public API', () => {
    const s = loadCore();
    assert.equal(typeof s.__Core.calculateADI, 'function');
    assert.equal(s.__Core.CITIES_CONFIG.length, 131);
    const r = s.__Core.calculateADI({ nightMinTemp: 26, maxTemp: 34, feelsLike: 35, continuousHotNightDays: 1, humidity: 70 });
    assert.equal(r.adiScore, 70);
    assert.equal(typeof s.__Core.generateAllCityData, 'function');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/core-wiring.test.js`
Expected: FAIL(脚本顺序、key、封顶断言不通过)

- [ ] **Step 3: 改造 `js/core.js`**

3a. 在 IIFE 内、`'use strict';` 之后,加入解构别名(覆盖所有仍被 core.js 内部引用的搬出符号):

```js
const ADICore = window.ADICore;
if (!ADICore) throw new Error('js/adi-core.js 必须在 js/core.js 之前加载');
const {
    ADI_CONFIG, LEVELS, LEVEL_ORDER, CITIES_CONFIG, CITY_GROUPS,
    scoreNightMinTemp, scoreDayMaxTemp, scoreFeelsLike, scoreContinuousHeat, scoreHumidityMuggy,
    calculateADI, determineLevel, calculateNightMuggyScore, isHotNight,
    generateShortReason, generateReason, calculateSalesIntensity, calculateRegionStats,
    calculateLevelTrend, parseWeatherData, assembleCityData,
    getLevelStats, getHotNightCities, getLongestHotNight,
    getTopByADI, getTopNightMuggy, getTopHeatRise, getCitiesByLevel,
    getLevelInfo, getLevelOrder
} = ADICore;
```

3b. **删除** core.js 中已搬出的全部定义(见 Task 1 清单 + `parseWeatherData`)。

> **`QWEATHER_CONFIG`(含 `apiKey`/`baseUrl`)本任务不动** —— key 移除与 `fetchWeatherData` 改造在 Task 6 一并完成,避免出现「key 已删但 fetch 仍引用它」的破坏性中间态。Task 3 提交后,前端仍可用旧 fetch 正常取数。

3c. **删除等级封顶块**:移除 `generateAllCityData` 中 core.js:1166-1196 的封顶逻辑(`MAX_OUTBREAK`、`MAX_ACTION_TOP`、`sorted`、`outbreakThreshold`、`actionThreshold` 及末尾的 `raw.forEach(...)` 降级循环)。改造后 `generateAllCityData` 直接 `return raw;`(保留分批抓取与 `Promise.all` 逻辑)。

3d. `generateCityData` 的 API 成功路径里,把原来「手算 adiScore/level/reason/...」的块替换为调用 `assembleCityData(parsedData)`:

```js
if (apiData) {
    const parsedData = parseWeatherData(apiData, city);
    if (parsedData) {
        return assembleCityData(parsedData);
    }
}
```

(mock 降级路径保留不变,但其内部对 `calculateADI`/`determineLevel` 等的调用现走别名,正常解析。)

3e. IIFE 末尾 `return { … }` 保持原样(这些名字现指向别名,对外 API 不变)。确保仍包含 `ADI_CONFIG, QWEATHER_CONFIG, LEVELS, LEVEL_ORDER, CITIES_CONFIG, CITY_GROUPS, calculateADI, determineLevel, …, generateAllCityData, parseWeatherData, assembleCityData, …` 等原先导出的全部名字(`parseWeatherData`/`assembleCityData` 现经别名导出)。

- [ ] **Step 4: 改 `index-v2.html`,在 `js/core.js` 之前加载 adi-core**

定位(index-v2.html:629 附近,`<script src="js/rain-monitor.js"></script>` 之后、`<script src="js/core.js"></script>` 之前),插入:

```html
<script src="js/adi-core.js"></script>
```

- [ ] **Step 5: 运行全部测试确认通过**

Run: `node --test tests/`
Expected: PASS(core-wiring 4 项 + adi-core 全部 + 既有 rain-monitor/wecom-message 等)

- [ ] **Step 6: 提交**

```bash
git add js/core.js index-v2.html tests/core-wiring.test.js
git commit -m "refactor(core): consume shared ADICore, remove level capping, drop hardcoded key"
```

---

### Task 4: `js/push.js` 摘要构造委派给 `ADICore`

**Files:**
- Modify: `js/push.js`
- Test: `tests/adi-core.test.js`(追加,验证 push.js 与 cron 同源)

**Interfaces:**
- Consumes: `window.ADICore.buildSummary`(Task 2)。
- Produces: `Push.buildSummary(type)` 行为不变(读 `UI.state.cityData`),内部委派。

- [ ] **Step 1: 追加测试(确保 push 走同一份摘要逻辑)**

在 `tests/adi-core.test.js` 末尾追加(直接测 `ADICore.buildSummary`,作为 push 与 cron 共用的契约):

```js
test('buildSummary brief shape matches manual-push contract', () => {
    const cities = [
        { cityName: 'A', adiScore: 90, level: 'outbreak', region: '华东', maxTemp: 38, nightMinTemp: 29, feelsLike: 41, future7AdiScores: [90, 90, 90], future3DayMaxTemps: [38, 38, 38], future3NightMinTemps: [29, 29, 29] }
    ];
    const s = ADICore.buildSummary('brief', cities, { updateTime: '08/01 09:30' });
    assert.equal(s.intensity === '强' || s.intensity === '偏强' || s.intensity === '中' || s.intensity === '低', true);
    assert.equal(Array.isArray(s.outbreakCities), true);
    assert.equal(Array.isArray(s.activeRegions), true);
});
```

- [ ] **Step 2: 运行确认通过(此契约本应已通过,作为门控)**

Run: `node --test tests/adi-core.test.js`
Expected: PASS

- [ ] **Step 3: 改 `js/push.js` 委派**

把 `buildBriefSummary`/`buildHeatFocusSummary`/`buildHeatRiseSummary`/`buildSummary`/`regionList`/`toOutbreak`/`baseSummary`/`emptyStats` 这些本地实现**删除**,改为:

```js
function buildSummary(type) {
    const cityData = getCityData();
    return window.ADICore.buildSummary(type, cityData, { updateTime: fmtDate(new Date()) });
}
```

保留 `getCityData`、`getPushType`、`showToast`、`fmtDate`、`RULES`(仍导出,值与 adi-core 一致)、`pushBrief`。`pushBrief` 内 `summary.hasContent` 判断逻辑不变(adi-core 已返回 `hasContent`)。

- [ ] **Step 4: 运行全部测试**

Run: `node --test tests/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add js/push.js tests/adi-core.test.js
git commit -m "refactor(push): delegate summary building to shared ADICore"
```

---

### Task 5: 创建 `api/utils/qweather.js`(服务端抓取 + 并发)

**Files:**
- Create: `api/utils/qweather.js`
- Test: `tests/qweather.test.js`

**Interfaces:**
- Produces: `buildWeatherUrl(location, apiKey)`、`mapWithConcurrency(items, concurrency, fn)`、`fetch7d(location, apiKey, opts)`、`fetch7dBatch(cities, apiKey, opts)`(返回 `{ results, failed }`)、`QWEATHER_BASE`。

- [ ] **Step 1: 写失败测试 `tests/qweather.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Q = require(path.join(__dirname, '..', 'api', 'utils', 'qweather.js'));

test('buildWeatherUrl encodes location and appends key', () => {
    const url = Q.buildWeatherUrl('120.00,30.00', 'KEY123');
    assert.ok(url.startsWith(Q.QWEATHER_BASE));
    assert.ok(url.includes('location=120.00%2C30.00') || url.includes('location=120.00,30.00'));
    assert.ok(url.includes('key=KEY123'));
});

test('mapWithConcurrency respects concurrency limit and preserves order', async () => {
    const inFlight = [];
    const maxSeen = { v: 0 };
    const items = [1, 2, 3, 4, 5];
    const out = await Q.mapWithConcurrency(items, 2, async (n) => {
        inFlight.push(n);
        maxSeen.v = Math.max(maxSeen.v, inFlight.length);
        await new Promise((r) => setTimeout(r, 10));
        inFlight.pop();
        return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
    assert.ok(maxSeen.v <= 2, 'concurrency never exceeds limit');
});

test('fetch7dBatch reports failed cities without throwing', async () => {
    const cities = [
        { name: 'OK', lat: 30, lng: 120 },
        { name: 'BAD', lat: 0, lng: 0 }
    ];
    // 注入 fetch:对 'BAD' 返回非 200
    const fakeFetch = (url) => Promise.resolve({
        ok: !url.includes('location=0.00'),
        status: 200,
        json: () => Promise.resolve({ code: '200', daily: [{ tempMax: '30', tempMin: '20', humidity: '60', fxDate: '2026-08-01' }] })
    });
    const { results, failed } = await Q.fetch7dBatch(cities, 'KEY', { fetchImpl: fakeFetch, concurrency: 2, timeoutMs: 500 });
    assert.ok(results.length >= 1);
    assert.ok(failed.includes('BAD'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/qweather.test.js`
Expected: FAIL — `Cannot find module '.../api/utils/qweather.js'`

- [ ] **Step 3: 实现 `api/utils/qweather.js`**

```js
// 服务端和风天气抓取(代理与 cron 共用)。UMD/CJS。
(function (root, factory) {
    const mod = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = mod;
    if (typeof window !== 'undefined') root.QWeather = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const QWEATHER_BASE = 'https://m96x89njb8.re.qweatherapi.com/v7/weather/7d';

    // 短时内存缓存(同实例内减少上游调用,保护配额)。key=location。
    const _cache = new Map();
    const CACHE_TTL = 3 * 60 * 60 * 1000; // 3h

    function buildWeatherUrl(location, apiKey) {
        return QWEATHER_BASE + '?location=' + encodeURIComponent(location) + '&key=' + encodeURIComponent(apiKey);
    }

    async function fetch7d(location, apiKey, opts) {
        opts = opts || {};
        const fetchImpl = opts.fetchImpl || fetch;
        const timeoutMs = opts.timeoutMs || 10000;

        const now = Date.now();
        const cached = _cache.get(location);
        if (cached && now - cached.t < CACHE_TTL) return cached.data;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetchImpl(buildWeatherUrl(location, apiKey), {
                signal: controller.signal,
                headers: { Accept: 'application/json' }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const result = await resp.json();
            if (result.code !== '200') throw new Error('QWeather code ' + result.code);
            _cache.set(location, { data: result, t: now });
            return result;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function mapWithConcurrency(items, concurrency, fn) {
        const results = new Array(items.length);
        let i = 0;
        async function worker() {
            while (i < items.length) {
                const idx = i++;
                results[idx] = await fn(items[idx], idx);
            }
        }
        const workers = [];
        for (let w = 0; w < Math.min(concurrency, items.length); w++) workers.push(worker());
        await Promise.all(workers);
        return results;
    }

    // 抓全量城市;单城失败计入 failed,不抛。返回 { results: [{city, data}], failed: [name] }
    async function fetch7dBatch(cities, apiKey, opts) {
        opts = opts || {};
        const concurrency = opts.concurrency || 6;
        const failed = [];
        const results = [];
        await mapWithConcurrency(cities, concurrency, async (city) => {
            try {
                const location = city.lng.toFixed(2) + ',' + city.lat.toFixed(2);
                const data = await fetch7d(location, apiKey, opts);
                results.push({ city, data });
            } catch (e) {
                failed.push(city.name);
            }
        });
        return { results, failed };
    }

    return { QWEATHER_BASE, buildWeatherUrl, fetch7d, mapWithConcurrency, fetch7dBatch };
});
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/qweather.test.js`
Expected: PASS(3 tests)

- [ ] **Step 5: 提交**

```bash
git add api/utils/qweather.js tests/qweather.test.js
git commit -m "feat(api): add server-side qweather fetch module with concurrency"
```

---

### Task 6: `api/weather.js` 代理 + `core.js` fetchWeatherData 改走代理

**Files:**
- Create: `api/weather.js`
- Modify: `js/core.js`(`fetchWeatherData`)
- Test: `tests/core-wiring.test.js`(已断言 key 已删除;此处补 fetchWeatherData 走代理的断言)

**Interfaces:**
- Consumes: `api/utils/qweather.js` 的 `fetch7d`。
- Produces: `GET /api/weather?location=lng,lat` → 和风原始 JSON。前端 `fetchWeatherData(city)` 改调它。

- [ ] **Step 1: 追加测试(在 `tests/core-wiring.test.js`)**

```js
test('core.js fetchWeatherData targets the /api/weather proxy', () => {
    const src = read('js/core.js');
    assert.ok(src.includes('/api/weather'), 'fetchWeatherData must call /api/weather');
    assert.equal(src.includes('qweatherapi.com'), false, 'must not call QWeather host directly');
});

test('core.js no longer contains hardcoded QWeather key or baseUrl', () => {
    const src = read('js/core.js');
    assert.equal(src.includes('c7d384b2fa484e558b11e316ca4bb161'), false, 'hardcoded key must be gone');
    assert.equal(src.includes('qweatherapi.com'), false, 'baseUrl must be gone (moved to server)');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/core-wiring.test.js`
Expected: FAIL(新断言不通过)

- [ ] **Step 3: 创建 `api/weather.js` 代理 handler**

```js
// 天气代理:key 只在服务端 env;前端匿名 GET。
const { fetch7d } = require('./utils/qweather.js');

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const apiKey = process.env.QWEATHER_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ error: '未配置 QWEATHER_API_KEY' });
    }
    const location = req.query && req.query.location;
    if (!location) {
        return res.status(400).json({ error: '缺少 location 参数' });
    }
    try {
        const data = await fetch7d(location, apiKey);
        // 缓存代理结果(和风数据约 1h 刷新)
        res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
        return res.status(200).json(data);
    } catch (e) {
        console.error('weather proxy 失败:', e);
        return res.status(502).json({ error: '天气数据获取失败', detail: String((e && e.message) || e) });
    }
}
```

- [ ] **Step 4: 改 `js/core.js` 的 `fetchWeatherData`**

把 `fetchWeatherData`(原 core.js:98-156,直连和风)替换为走代理(保留 localStorage 缓存层):

```js
async function fetchWeatherData(city) {
    const cacheKey = `weather_cache_${CACHE_VERSION}_${city.name}`;
    const now = Date.now();

    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (now - timestamp < QWEATHER_CONFIG.cacheDuration) return data;
        }
    } catch (e) {
        console.warn('缓存读取失败:', e);
    }

    const location = `${city.lng.toFixed(2)},${city.lat.toFixed(2)}`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), QWEATHER_CONFIG.requestTimeout);
        const response = await fetch(`/api/weather?location=${encodeURIComponent(location)}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (result.code !== '200') throw new Error(`API错误: ${result.code}`);
        try {
            localStorage.setItem(cacheKey, JSON.stringify({ data: result, timestamp: now }));
        } catch (e) {
            console.warn('缓存保存失败:', e);
        }
        return result;
    } catch (error) {
        console.error(`获取 ${city.name} 天气数据失败:`, error);
        return null;
    }
}
```

同时把 `QWEATHER_CONFIG` 里的 `apiKey` 与 `baseUrl` **删除**(key 已迁 env、URL 已在服务端 `api/utils/qweather.js`),只保留前端缓存层需要的两个字段:

```js
const QWEATHER_CONFIG = {
    requestTimeout: 10000,              // /api/weather 请求超时
    cacheDuration: 6 * 60 * 60 * 1000   // 6 小时 localStorage 缓存
};
```

- [ ] **Step 5: 运行全部测试**

Run: `node --test tests/`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add api/weather.js js/core.js tests/core-wiring.test.js
git commit -m "feat(api): add /api/weather proxy; frontend fetches via proxy (key server-side)"
```

---

### Task 7: `api/cron-push.js` 定时入口

**Files:**
- Create: `api/cron-push.js`
- Test: 手动端到端(见 Step 4);纯逻辑已被 adi-core 测试覆盖。

**Interfaces:**
- Consumes: `require('../js/adi-core.js')`、`require('./utils/qweather.js')`、`require('./utils/wecom-message.js')`、`process.env.QWEATHER_API_KEY`、`process.env.WECOM_BOT_WEBHOOK`、`process.env.CRON_SECRET`。
- Produces: `GET /api/cron-push` → `{ cities, failed, pushed: { heatFocus, heatRise } }`。

- [ ] **Step 1: 创建 `api/cron-push.js`**

```js
// 定时推送入口(北京 09:30 = UTC 01:30)。Vercel cron 以 GET 调用。
const ADICore = require('../js/adi-core.js');
const QWeather = require('./utils/qweather.js');
const WecomMessage = require('./utils/wecom-message.js');

function authorized(req) {
    if (req.headers && req.headers['x-vercel-cron'] === '1') return true;
    const secret = process.env.CRON_SECRET;
    if (secret && req.query && req.query.token === secret) return true;
    return false;
}

async function pushType(type, summary, webhook) {
    summary.type = type;
    const content = WecomMessage.buildForType(type, summary);
    const resp = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { content } })
    });
    let data = {};
    try { data = await resp.json(); } catch (_) {}
    if (!resp.ok || data.errcode !== 0) {
        throw new Error('企业微信推送失败: ' + (data.errmsg || ('HTTP ' + resp.status)));
    }
}

export default async function handler(req, res) {
    if (!authorized(req)) return res.status(401).json({ error: '未授权' });

    const apiKey = process.env.QWEATHER_API_KEY;
    const webhook = process.env.WECOM_BOT_WEBHOOK;
    if (!apiKey) return res.status(503).json({ error: '未配置 QWEATHER_API_KEY' });
    if (!webhook) return res.status(503).json({ error: '未配置 WECOM_BOT_WEBHOOK' });

    // 1. 抓全量城市
    const { results, failed } = await QWeather.fetch7dBatch(ADICore.CITIES_CONFIG, apiKey, { concurrency: 6, timeoutMs: 10000 });

    // 2. 装配 cityData(与前端 generateCityData 的 API 路径同源)
    const cityData = [];
    for (const { city, data } of results) {
        const parsed = ADICore.parseWeatherData(data, city);
        if (parsed) cityData.push(ADICore.assembleCityData(parsed));
    }

    // 3. 构造摘要,达标才推
    const pushed = { heatFocus: false, heatRise: false };
    const errors = [];

    const heatFocus = ADICore.buildSummary('heatFocus', cityData);
    if (heatFocus.hasContent !== false) {
        try { await pushType('heatFocus', heatFocus, webhook); pushed.heatFocus = true; }
        catch (e) { errors.push('heatFocus: ' + e.message); }
    }

    const heatRise = ADICore.buildSummary('heatRise', cityData);
    if (heatRise.hasContent !== false) {
        try { await pushType('heatRise', heatRise, webhook); pushed.heatRise = true; }
        catch (e) { errors.push('heatRise: ' + e.message); }
    }

    const payload = { cities: cityData.length, failed, pushed, errors };
    console.log('cron-push 完成', payload);
    return res.status(200).json(payload);
}
```

- [ ] **Step 2: 语法/require 自检**

Run: `node -e "require('./js/adi-core.js'); require('./api/utils/qweather.js'); require('./api/utils/wecom-message.js'); console.log('deps OK')"`
Expected: 输出 `deps OK`(注意:`api/cron-push.js` 本身因 `export default` 不能直接 `require`,只校验其依赖。)

- [ ] **Step 3: 运行全部单元测试确认无回归**

Run: `node --test tests/`
Expected: PASS

- [ ] **Step 4: 本地端到端冒烟(手动)**

- 在 `.env.local` 设置 `QWEATHER_API_KEY`(原前端 key 值)、`WECOM_BOT_WEBHOOK`(测试机器人)。
- 启动:`vercel dev`(或 `npx vercel dev`)。
- 触发:`curl 'http://localhost:3000/api/cron-push?token=<CRON_SECRET>'`(若设了 secret)或带 `x-vercel-cron: 1` 头。
- 预期:返回 `{ "cities": <数>, "failed": [...], "pushed": { "heatFocus": true/false, "heatRise": true/false }, "errors": [] }`;测试企业微信群收到对应 markdown(达标时)。

- [ ] **Step 5: 提交**

```bash
git add api/cron-push.js
git commit -m "feat(api): add /api/cron-push daily auto-push (heatFocus + heatRise)"
```

---

### Task 8: `vercel.json` cron 配置 + 环境变量文档

**Files:**
- Modify: `vercel.json`
- Modify: `api/README.md`
- Test: `tests/vercel-config.test.js`(追加)

**Interfaces:**
- Produces: Vercel 每日 01:30 UTC 触发 `/api/cron-push`;文档列出所需 env。

- [ ] **Step 1: 追加测试(在 `tests/vercel-config.test.js`)**

```js
test('vercel cron triggers cron-push daily at 01:30 UTC', () => {
    const config = JSON.parse(read('vercel.json'));
    assert.ok(Array.isArray(config.crons), 'crons array must exist');
    const cron = config.crons.find((c) => c.path === '/api/cron-push');
    assert.ok(cron, '/api/cron-push cron entry must exist');
    assert.equal(cron.schedule, '30 1 * * *');
});
```

> 注:`vercel-config.test.js` 已用 `read()` 读 `vercel.json`;若该文件用 `fs.readFileSync(path.join(__dirname,'..','vercel.json'))` 而非 `read()`,沿用其既有变量名。

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/vercel-config.test.js`
Expected: FAIL(crons 不存在)

- [ ] **Step 3: 改 `vercel.json`**

在顶层对象加 `crons`(与现有 `rewrites`/`headers` 平级):

```json
"crons": [
  { "path": "/api/cron-push", "schedule": "30 1 * * *" }
]
```

- [ ] **Step 4: 改 `api/README.md`「开发环境配置」**

把 `.env.local` 示例补为本轮所需变量:

```
QWEATHER_API_KEY=你的和风天气key
WECOM_BOT_WEBHOOK=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
CRON_SECRET=自定义cron鉴权token(可选)
```

并在「开发环境配置」段后补一小节:

```markdown
## 定时推送(cron)

- `/api/cron-push` 由 Vercel Cron 每日 01:30 UTC(北京 09:30)以 GET 触发。
- 推送「高温重点关注」与「升温预报」,达标才推(无爆热/行动级或无显著升温则不推)。
- 需配置环境变量:`QWEATHER_API_KEY`、`WECOM_BOT_WEBHOOK`;可选 `CRON_SECRET`(查询参 `?token=` 额外鉴权)。
- 生产用 `vercel env add QWEATHER_API_KEY` 等命令配置。
```

- [ ] **Step 5: 运行全部测试**

Run: `node --test tests/`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add vercel.json api/README.md tests/vercel-config.test.js
git commit -m "feat(vercel): add daily cron-push schedule and document env vars"
```

---

## 部署前清单(实现完成后,非任务步骤)

- `vercel env add QWEATHER_API_KEY`(生产+预览)、`vercel env add WECOM_BOT_WEBHOOK`、(可选)`vercel env add CRON_SECRET`。
- 部署后在 Vercel dashboard → Cron Jobs 确认 `/api/cron-push` 下次触发时间为北京 09:30。
- 用真实测试机器人验证一次推送内容。
