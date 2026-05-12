# 首页"今日销售机会总览"改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将空调热销区域雷达首页从"天气数据监控看板"升级为"销售机会决策看板"，帮助管理层快速判断销售机会。

**Architecture:** 保持现有模块化架构（core.js、map.js、ui.js、app.js），通过新增函数和修改现有函数实现新功能。HTML结构保持侧边栏+头部+内容区布局，CSS保持深色科技风主题。

**Tech Stack:** 原生JavaScript、ECharts地图、CSS Grid布局

---

## 文件结构

### 需要修改的文件
- `index-v2.html` - 主HTML文件，包含页面结构和内联样式
- `js/core.js` - 核心业务逻辑模块，新增统计和判断函数
- `js/ui.js` - UI渲染模块，新增和修改渲染函数
- `js/map.js` - 地图模块，新增视图说明切换逻辑
- `css/styles-v2.css` - 样式文件，新增新组件样式

### 不变的部分
- 其他页面（机会分析、7天趋势、历史复盘、规则设置）
- 测试页面（test.html、standalone-test.html等）
- 深色科技风主题
- 整体布局结构
- 地图核心交互逻辑

---

## Task 1: 文件备份

**Files:**
- Modify: `index-v2.html`

- [ ] **Step 1: 创建备份文件**

Run:
```bash
cp index-v2.html index-v2-before-sales-overview.html
```

Expected: 创建 `index-v2-before-sales-overview.html` 备份文件

- [ ] **Step 2: 验证备份文件存在**

Run:
```bash
ls -la index-v2-before-sales-overview.html
```

Expected: 显示备份文件信息

- [ ] **Step 3: 提交备份**

```bash
git add index-v2-before-sales-overview.html
git commit -m "chore: backup index-v2.html before sales overview redesign"
```

---

## Task 2: 修改侧边栏logo和副标题

**Files:**
- Modify: `index-v2.html:59-62`

- [ ] **Step 1: 修改logo区域HTML**

找到 `<div class="logo">` 区域，将副标题改为中文：

```html
<div class="logo">
    <h1>空调热销区域雷达</h1>
    <p>基于天气数据判断空调区域销售机会</p>
</div>
```

- [ ] **Step 2: 修改导航第一项文本**

将导航项从"今日热销"改为"销售总览"：

```html
<div class="nav-item active" data-page="dashboard">
    <span class="nav-icon">🎯</span>
    <span class="nav-text">销售总览</span>
</div>
```

- [ ] **Step 3: 在浏览器中验证更改**

Run: 打开 `index-v2.html` 并检查侧边栏显示

Expected: logo副标题显示"基于天气数据判断空调区域销售机会"，导航显示"销售总览"

---

## Task 3: 修改顶部状态栏 - 增加销售机会强度

**Files:**
- Modify: `index-v2.html:104-125`
- Modify: `js/ui.js:125-134`

- [ ] **Step 1: 在HTML中增加销售机会强度字段**

在 `header-stats` 区域的第一个位置添加：

```html
<div class="header-stats">
    <div class="header-stat">
        <div class="header-stat-label">销售机会强度</div>
        <div class="header-stat-value" id="salesIntensity">--</div>
    </div>
    <div class="header-stat">
        <div class="header-stat-label">监控城市</div>
        <div class="header-stat-value" id="cityCount">--</div>
    </div>
    <!-- 其他统计项保持不变 -->
</div>
```

- [ ] **Step 2: 在core.js中添加销售机会强度计算函数**

在 `js/core.js` 的公开API部分之前添加：

```javascript
// ==================== 销售机会强度判断 ====================

function calculateSalesIntensity(cityDataList) {
    const stats = getLevelStats(cityDataList);
    const explosiveCount = stats.outbreak;
    const actionCount = stats.action;

    // 统计有大区级城市的区域数
    const regionMap = {};
    cityDataList.forEach(c => {
        if (c.level === 'outbreak' || c.level === 'action') {
            regionMap[c.region] = (regionMap[c.region] || 0) + 1;
        }
    });

    const activeRegionCount = Object.keys(regionMap).length;
    const explosiveRegionCount = Object.entries(regionMap).filter(([_, count]) => {
        const cities = cityDataList.filter(c => c.region === _ && c.level === 'outbreak');
        return cities.length > 0;
    }).length;

    // 单个大区最大爆发级城市数
    const regionExplosiveCounts = {};
    cityDataList.forEach(c => {
        if (c.level === 'outbreak') {
            regionExplosiveCounts[c.region] = (regionExplosiveCounts[c.region] || 0) + 1;
        }
    });
    const maxExplosiveInOneRegion = Math.max(0, ...Object.values(regionExplosiveCounts));

    // 单个大区最大行动级及以上城市数
    const maxActiveInOneRegion = Math.max(0, ...Object.values(regionMap));

    // 至少2个大区分别有≥3个爆发级城市
    const regionsWith3PlusExplosive = Object.entries(regionExplosiveCounts).filter(([_, count]) => count >= 3).length;

    // 判断强度（从高到低匹配）
    if (explosiveCount >= 8 && explosiveRegionCount >= 3) return '强';
    if (explosiveCount >= 10) return '强';
    if (maxExplosiveInOneRegion >= 7) return '强';
    if (regionsWith3PlusExplosive >= 2) return '强';

    if (explosiveCount >= 4 && explosiveCount <= 7) return '偏强';
    if (actionCount >= 9) return '偏强';
    if (activeRegionCount >= 2) return '偏强';
    if (maxExplosiveInOneRegion >= 5) return '偏强';
    if (maxActiveInOneRegion >= 8) return '偏强';

    if (explosiveCount >= 1 && explosiveCount <= 3) return '中';
    if (actionCount >= 3 && actionCount <= 8) return '中';
    if (activeRegionCount === 1) return '中';

    return '低';
}
```

- [ ] **Step 3: 在core.js的公开API中导出新函数**

在 `return` 语句中添加：

```javascript
return {
    ADI_CONFIG,
    LEVELS,
    LEVEL_ORDER,
    CITIES_CONFIG,

    calculateADI,
    determineLevel,
    calculateNightMuggyScore,
    isHotNight,
    generateCityData,
    generateAllCityData,
    generateShortReason,
    calculateLevelTrend,
    calculateSalesIntensity,  // 新增

    getLevelStats,
    getHotNightCities,
    getLongestHotNight,
    getTopByADI,
    getTopNightMuggy,
    getTopHeatRise,
    getCitiesByLevel,

    getLevelInfo,
    getLevelOrder
};
```

- [ ] **Step 4: 修改ui.js的updateHeaderStats函数**

替换 `updateHeaderStats` 函数：

```javascript
function updateHeaderStats() {
    const stats = Core.getLevelStats(state.cityData);
    const hotNightCities = Core.getHotNightCities(state.cityData);
    const intensity = Core.calculateSalesIntensity(state.cityData);
    const el = (id) => document.getElementById(id);

    // 销售机会强度
    if (el('salesIntensity')) {
        const intensityEl = el('salesIntensity');
        intensityEl.textContent = intensity;
        intensityEl.className = 'header-stat-value intensity-' + intensity;
    }

    if (el('cityCount')) el('cityCount').textContent = state.cityData.length;
    if (el('outbreakCount')) el('outbreakCount').textContent = stats.outbreak;
    if (el('actionCount')) el('actionCount').textContent = stats.action;
    if (el('hotNightCount')) el('hotNightCount').textContent = hotNightCities.length;
    if (el('updateTime')) el('updateTime').textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
```

- [ ] **Step 5: 在CSS中添加强度颜色样式**

在 `css/styles-v2.css` 中添加：

```css
/* 销售机会强度颜色 */
.header-stat-value.intensity-low { color: #4A90E2; }
.header-stat-value.intensity-medium { color: #F5A623; }
.header-stat-value.intensity-high { color: #F57C00; }
.header-stat-value.intensity-strong { color: #D0021B; }
```

- [ ] **Step 6: 在浏览器中测试**

Run: 刷新页面，检查顶部状态栏

Expected: "销售机会强度"显示在第一位，根据数据显示不同的颜色和强度值

---

## Task 4: 重构左侧面板 - 今日判断结论

**Files:**
- Modify: `index-v2.html:134-136`
- Modify: `js/core.js`
- Modify: `js/ui.js`

- [ ] **Step 1: 在core.js中添加大区统计函数**

在 `calculateSalesIntensity` 函数后添加：

```javascript
function calculateRegionStats(cityDataList) {
    const regions = ['华东', '华南', '华中', '华北', '西南', '西北', '东北'];
    const regionStats = {};

    regions.forEach(region => {
        const regionCities = cityDataList.filter(c => c.region === region);
        const stats = getLevelStats(regionCities);
        const explosiveCount = stats.outbreak;
        const actionCount = stats.action;
        const opportunityCount = stats.opportunity;
        const observeCount = stats.observe;

        // 计算大区等级
        let level = '低';
        if (explosiveCount >= 5) level = '强';
        else if (explosiveCount >= 3) level = '偏强';
        else if (explosiveCount >= 1 || actionCount >= 4) level = '中高';
        else if (actionCount >= 2 || opportunityCount >= 3) level = '中';
        else if (opportunityCount >= 1 || observeCount >= 2) level = '低';

        // 获取代表城市（按ADI排序）
        const topCities = regionCities
            .sort((a, b) => b.adiScore - a.adiScore)
            .slice(0, 3)
            .map(c => c.cityName);

        // 热夜城市数
        const hotNightCount = regionCities.filter(c => isHotNight(c)).length;

        // 生成原因
        let reason = '';
        if (explosiveCount >= 3) reason = '多城市爆发级需求';
        else if (explosiveCount >= 1) reason = '部分城市爆发级需求';
        else if (actionCount >= 3) reason = '多城市行动级需求';
        else if (hotNightCount >= 5) reason = '夜间温度持续偏高';
        else if (opportunityCount >= 3) reason = '机会级城市较多';
        else reason = '有升温迹象';

        regionStats[region] = {
            level,
            explosiveCount,
            actionCount,
            opportunityCount,
            observeCount,
            hotNightCount,
            totalCities: regionCities.length,
            representativeCities: topCities,
            reason
        };
    });

    return regionStats;
}
```

- [ ] **Step 2: 在core.js公开API中导出新函数**

```javascript
return {
    // ... 其他导出
    calculateSalesIntensity,
    calculateRegionStats,  // 新增
    // ... 其他导出
};
```

- [ ] **Step 3: 在ui.js中添加renderTodayConclusion函数**

```javascript
function renderTodayConclusion() {
    const container = document.getElementById('todayConclusion');
    if (!container) return;

    const intensity = Core.calculateSalesIntensity(state.cityData);
    const regionStats = Core.calculateRegionStats(state.cityData);

    // 获取重点大区（前3个有行动级及以上的大区）
    const activeRegions = Object.entries(regionStats)
        .filter(([_, stats]) => stats.explosiveCount > 0 || stats.actionCount > 0)
        .sort((a, b) => (b[1].explosiveCount * 2 + b[1].actionCount) - (a[1].explosiveCount * 2 + a[1].actionCount))
        .slice(0, 3)
        .map(([name, _]) => name)
        .join('、') || '暂无';

    // 核心原因
    const stats = Core.getLevelStats(state.cityData);
    const hotNightCities = Core.getHotNightCities(state.cityData);
    let reason = '';
    if (stats.outbreak >= 5) reason = '多城市达到爆发级，短期需求强烈';
    else if (stats.actionCount >= 8) reason = '多城市达到行动级，需求明显增强';
    else if (hotNightCities.length >= 20) reason = '夜间温度持续偏高，部分城市连续闷热夜';
    else if (stats.opportunityCount >= 10) reason = '机会级城市较多，有升温趋势';
    else reason = '部分地区有升温迹象';

    container.innerHTML = `
        <div class="conclusion-intensity">
            今日销售机会：<span class="intensity-value intensity-${intensity}">${intensity}</span>
        </div>
        <div class="conclusion-regions">
            重点区域：<span class="regions-value">${activeRegions}</span>
        </div>
        <div class="conclusion-reason">
            核心原因：<span class="reason-value">${reason}</span>
        </div>
    `;
}
```

- [ ] **Step 4: 修改HTML中左侧面板结构**

将 `<aside class="left-sidebar" id="todaySummary"></aside>` 替换为：

```html
<aside class="left-sidebar">
    <!-- 今日判断结论 -->
    <div class="sidebar-card" id="todayConclusion">
        <div class="card-header">今日判断结论</div>
        <div class="card-body">
            <!-- 动态渲染 -->
        </div>
    </div>

    <!-- 大区机会排行 -->
    <div class="sidebar-card" id="regionRanking">
        <div class="card-header">大区机会排行</div>
        <div class="card-body">
            <!-- 动态渲染 -->
        </div>
    </div>

    <!-- 最长连续闷热夜 -->
    <div class="sidebar-card" id="longestHotNight">
        <div class="card-header">最长连续闷热夜</div>
        <div class="card-body">
            <!-- 动态渲染 -->
        </div>
    </div>
</aside>
```

- [ ] **Step 5: 添加CSS样式**

在 `css/styles-v2.css` 中添加：

```css
/* 左侧面板卡片 */
.sidebar-card {
    background: #141b3d;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
}

.card-header {
    font-size: 14px;
    font-weight: 600;
    color: #8b9dc3;
    margin-bottom: 12px;
}

.card-body {
    color: #e0e6ed;
}

/* 今日判断结论 */
.conclusion-intensity {
    margin-bottom: 10px;
    font-size: 14px;
}

.intensity-value {
    font-size: 24px;
    font-weight: 700;
    margin-left: 4px;
}

.intensity-value.intensity-low { color: #4A90E2; }
.intensity-value.intensity-medium { color: #F5A623; }
.intensity-value.intensity-high { color: #F57C00; }
.intensity-value.intensity-strong { color: #D0021B; }

.conclusion-regions {
    margin-bottom: 10px;
    font-size: 13px;
}

.regions-value {
    color: #F5A623;
    font-weight: 500;
}

.conclusion-reason {
    font-size: 13px;
    color: #a0aec0;
}

.reason-value {
    color: #e0e6ed;
}
```

- [ ] **Step 6: 在浏览器中测试**

Run: 刷新页面

Expected: 左侧面板显示"今日判断结论"卡片

---

## Task 5: 重构左侧面板 - 大区机会排行

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: 添加renderRegionRanking函数**

```javascript
function renderRegionRanking() {
    const container = document.getElementById('regionRanking');
    if (!container) return;

    const regionStats = Core.calculateRegionStats(state.cityData);

    // 按机会等级排序
    const levelOrder = { '强': 4, '偏强': 3, '中高': 2, '中': 1, '低': 0 };
    const sortedRegions = Object.entries(regionStats)
        .sort((a, b) => levelOrder[b[1].level] - levelOrder[a[1].level] ||
                      (b[1].explosiveCount * 2 + b[1].actionCount) - (a[1].explosiveCount * 2 + a[1].actionCount));

    const levelColors = {
        '强': '#D0021B',
        '偏强': '#F57C00',
        '中高': '#F5A623',
        '中': '#4A90E2',
        '低': '#666666'
    };

    container.innerHTML = sortedRegions.map(([regionName, stats]) => `
        <div class="region-ranking-item">
            <div class="region-info">
                <span class="region-name">${regionName}</span>
                <span class="region-badge" style="background: ${levelColors[stats.level]}">${stats.level}</span>
            </div>
            <div class="region-stats">
                <span class="region-stat">爆发级${stats.explosiveCount}</span>
                <span class="region-stat">行动级${stats.actionCount}</span>
                <span class="region-stat">热夜${stats.hotNightCount}</span>
            </div>
            <div class="region-cities">
                代表：${stats.representativeCities.slice(0, 3).join('、')}
            </div>
        </div>
    `).join('');
}
```

- [ ] **Step 2: 添加CSS样式**

```css
/* 大区机会排行 */
.region-ranking-item {
    padding: 10px 0;
    border-bottom: 1px solid #2a3558;
}

.region-ranking-item:last-child {
    border-bottom: none;
}

.region-info {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
}

.region-name {
    font-weight: 600;
    font-size: 14px;
}

.region-badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    color: white;
}

.region-stats {
    display: flex;
    gap: 12px;
    margin-bottom: 6px;
}

.region-stat {
    font-size: 12px;
    color: #a0aec0;
}

.region-cities {
    font-size: 12px;
    color: #718096;
}
```

- [ ] **Step 3: 在浏览器中测试**

Run: 刷新页面

Expected: 左侧面板显示"大区机会排行"卡片

---

## Task 6: 重构左侧面板 - 最长连续闷热夜

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: 添加renderLongestHotNight函数**

```javascript
function renderLongestHotNight() {
    const container = document.getElementById('longestHotNight');
    if (!container) return;

    const hotNight = Core.getLongestHotNight(state.cityData);
    const hotNightCities = Core.getHotNightCities(state.cityData);

    const forecastStr = hotNight.future3Nights.length > 0
        ? hotNight.future3Nights.map(t => t + '℃').join(' / ')
        : '--';

    container.innerHTML = `
        <div class="hotnight-stats">
            <div class="hotnight-days">${hotNight.maxDays}<span class="hotnight-unit">天</span></div>
            <div class="hotnight-city">城市：${hotNight.cityName}</div>
        </div>
        <div class="hotnight-forecast">
            未来3晚：${forecastStr}
        </div>
        <div class="hotnight-total">
            热夜城市：<span class="hotnight-count">${hotNight.totalCities}</span>个
        </div>
    `;
}
```

- [ ] **Step 2: 添加CSS样式**

```css
/* 最长连续闷热夜 */
.hotnight-stats {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 10px;
}

.hotnight-days {
    font-size: 32px;
    font-weight: 700;
    color: #e84393;
}

.hotnight-unit {
    font-size: 14px;
    color: #a0aec0;
}

.hotnight-city {
    font-size: 14px;
    color: #e0e6ed;
}

.hotnight-forecast {
    font-size: 13px;
    color: #a0aec0;
    margin-bottom: 8px;
}

.hotnight-total {
    font-size: 13px;
    color: #718096;
}

.hotnight-count {
    color: #e84393;
    font-weight: 600;
}
```

- [ ] **Step 3: 在浏览器中测试**

Run: 刷新页面

Expected: 左侧面板显示"最长连续闷热夜"卡片

---

## Task 7: 修改renderDashboard调用新函数

**Files:**
- Modify: `js/ui.js:117-123`

- [ ] **Step 1: 修改renderDashboard函数**

替换现有的 `renderDashboard` 函数：

```javascript
function renderDashboard(cityData) {
    state.cityData = cityData;
    updateHeaderStats();
    renderTodayConclusion();
    renderRegionRanking();
    renderLongestHotNight();
    renderMap();
    renderTopCities();
}
```

- [ ] **Step 2: 删除或注释掉旧的renderTodaySummary函数**

由于我们已经用三个新函数替代了它，可以删除 `renderTodaySummary` 函数

- [ ] **Step 3: 在浏览器中测试**

Run: 刷新页面

Expected: 左侧面板显示三个新卡片，内容正确渲染

---

## Task 8: 修改地图标题和图例

**Files:**
- Modify: `index-v2.html:140-150`

- [ ] **Step 1: 修改地图标题**

将 `全国空调需求热力图` 改为 `全国空调销售机会热力图`：

```html
<div class="section-header">
    <span class="section-title">全国空调销售机会热力图</span>
    <div class="view-mode-toggle">
        <!-- 保持不变 -->
    </div>
</div>
```

- [ ] **Step 2: 添加地图图例**

在 `section-header` 后添加图例：

```html
<div class="section-header">
    <span class="section-title">全国空调销售机会热力图</span>
    <div class="view-mode-toggle">
        <button class="view-mode-btn active" data-mode="adi">ADI指数</button>
        <button class="view-mode-btn" data-mode="nightTemp">夜间温度</button>
        <button class="view-mode-btn" data-mode="feelsLike">体感温度</button>
        <button class="view-mode-btn" data-mode="dayMax">白天最高温</button>
    </div>
</div>
<div class="map-legend">
    <span class="legend-item"><span class="legend-dot outbreak"></span>爆发级</span>
    <span class="legend-item"><span class="legend-dot action"></span>行动级</span>
    <span class="legend-item"><span class="legend-dot opportunity"></span>机会级</span>
    <span class="legend-item"><span class="legend-dot observe"></span>观察级</span>
    <span class="legend-item"><span class="legend-dot normal"></span>普通</span>
</div>
<div class="map-view-desc" id="mapViewDesc">
    颜色越红，空调销售机会越高
</div>
```

- [ ] **Step 3: 添加CSS样式**

```css
/* 地图图例 */
.map-legend {
    display: flex;
    gap: 16px;
    padding: 8px 16px;
    justify-content: center;
    background: rgba(20, 27, 61, 0.5);
    border-radius: 6px;
    margin-bottom: 12px;
}

.legend-item {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: #a0aec0;
}

.legend-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 6px;
}

.legend-dot.outbreak { background: #D0021B; }
.legend-dot.action { background: #F57C00; }
.legend-dot.opportunity { background: #F5A623; }
.legend-dot.observe { background: #4A90E2; }
.legend-dot.normal { background: #555555; }

.map-view-desc {
    text-align: center;
    font-size: 12px;
    color: #718096;
    padding: 4px 0;
    margin-bottom: 8px;
}
```

- [ ] **Step 4: 修改map.js添加视图说明切换**

在 `js/map.js` 的视图切换事件中添加：

```javascript
// 更新视图说明
const viewDescs = {
    adi: '颜色越红，空调销售机会越高',
    nightTemp: '颜色越红，夜间闷热程度越高',
    feelsLike: '颜色越红，人体感知温度越高',
    dayMax: '颜色越红，白天温度越高'
};

document.querySelectorAll('.view-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        const descEl = document.getElementById('mapViewDesc');
        if (descEl) {
            descEl.textContent = viewDescs[mode] || '';
        }
    });
});
```

- [ ] **Step 5: 在浏览器中测试**

Run: 刷新页面，点击不同视图模式按钮

Expected: 地图标题更新，图例显示，切换视图时说明文字变化

---

## Task 9: 简化右侧榜单Tab

**Files:**
- Modify: `index-v2.html:157-161`

- [ ] **Step 1: 修改Tab名称**

将原来的三个tab改为新名称：

```html
<div class="top-tabs" id="topTabs">
    <button class="top-tab active" data-tab="hotSales">重点城市</button>
    <button class="top-tab" data-tab="nightMuggy">闷热城市</button>
    <button class="top-tab" data-tab="heatRise">升温城市</button>
</div>
```

- [ ] **Step 2: 添加生成简报按钮**

在榜单容器后添加按钮：

```html
<div class="top-cities-list" id="topCitiesContainer"></div>
<button class="btn-generate-brief" id="generateBriefBtn">
    📄 生成今日简报
</button>
```

- [ ] **Step 3: 添加CSS样式**

```css
/* 生成简报按钮 */
.btn-generate-brief {
    width: 100%;
    padding: 12px;
    background: linear-gradient(135deg, #4A90E2, #357ABD);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 16px;
    transition: all 0.3s ease;
}

.btn-generate-brief:hover {
    background: linear-gradient(135deg, #357ABD, #2a5f8f);
    transform: translateY(-1px);
}
```

- [ ] **Step 4: 修改右侧榜单渲染函数**

更新 `renderHotSalesTab` 函数的显示字段：

```javascript
function renderHotSalesTab(container) {
    const cities = Core.getTopByADI(state.cityData, 10);
    container.innerHTML = cities.map((city, i) => {
        const info = Core.getLevelInfo(city.level);
        const rankClass = i < 3 ? `rank-${i + 1}` : '';
        return `
            <div class="top-city-item" data-city="${city.cityName}">
                <span class="top-city-rank ${rankClass}">${i + 1}</span>
                <div class="top-city-info-main">
                    <div class="top-city-name">${city.cityName} <span class="top-city-level" style="background: ${info.color}">${info.name}</span></div>
                    <div class="top-city-meta">ADI ${city.adiScore} ｜ 白天${city.maxTemp}℃ / 夜${city.nightMinTemp}℃${city.continuousHotNightDays > 0 ? ' / 热夜' + city.continuousHotNightDays + '天' : ''}</div>
                </div>
                <span class="top-city-adi-badge" style="color: ${info.color}">${city.adiScore}</span>
            </div>
        `;
    }).join('');
}
```

- [ ] **Step 5: 在浏览器中测试**

Run: 刷新页面

Expected: 右侧Tab名称更新，显示"生成今日简报"按钮

---

## Task 10: 添加今日简报模态框HTML

**Files:**
- Modify: `index-v2.html`

- [ ] **Step 1: 在城市详情模态框后添加简报模态框**

在 `</div>` 之前（City Detail Modal之后）添加：

```html
<!-- Daily Brief Modal -->
<div class="daily-brief-modal" id="dailyBriefModal">
    <div class="modal-overlay" onclick="UI.closeDailyBriefModal()"></div>
    <div class="modal-content">
        <div class="modal-header">
            <h3>今日销售机会简报</h3>
            <button class="modal-close" onclick="UI.closeDailyBriefModal()">×</button>
        </div>
        <div class="modal-tabs">
            <button class="modal-tab active" data-version="management">管理层短版</button>
            <button class="modal-tab" data-version="operational">运营详细版</button>
        </div>
        <div class="modal-body" id="briefContent">
            <!-- 动态渲染简报内容 -->
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="UI.copyDailyBrief()">复制简报</button>
            <button class="btn btn-primary" onclick="UI.closeDailyBriefModal()">关闭</button>
        </div>
    </div>
</div>
```

- [ ] **Step 2: 添加简报模态框CSS样式**

```css
/* 简报模态框 */
.daily-brief-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    align-items: center;
    justify-content: center;
}

.daily-brief-modal.active {
    display: flex;
}

.modal-content {
    background: #1a2342;
    border-radius: 12px;
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #2a3558;
}

.modal-header h3 {
    margin: 0;
    font-size: 18px;
    color: #e0e6ed;
}

.modal-close {
    background: none;
    border: none;
    color: #718096;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
}

.modal-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #e0e6ed;
}

.modal-tabs {
    display: flex;
    gap: 8px;
    padding: 12px 20px;
    border-bottom: 1px solid #2a3558;
}

.modal-tab {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid #4A90E2;
    border-radius: 6px;
    color: #4A90E2;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s ease;
}

.modal-tab.active,
.modal-tab:hover {
    background: #4A90E2;
    color: white;
}

.modal-body {
    padding: 20px;
}

.modal-footer {
    display: flex;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid #2a3558;
    justify-content: flex-end;
}

.btn {
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.2s ease;
}

.btn-secondary {
    background: #4A90E2;
    color: white;
}

.btn-secondary:hover {
    background: #357ABD;
}

.btn-primary {
    background: #D0021B;
    color: white;
}

.btn-primary:hover {
    background: #b30118;
}

/* 简报内容样式 */
.brief-section {
    margin-bottom: 16px;
}

.brief-section-title {
    font-weight: 600;
    color: #8b9dc3;
    margin-bottom: 8px;
    font-size: 14px;
}

.brief-section-content {
    color: #e0e6ed;
    font-size: 14px;
    line-height: 1.6;
}

.brief-update-time {
    font-size: 12px;
    color: #718096;
    margin-bottom: 16px;
}
```

- [ ] **Step 3: 在浏览器中测试HTML结构**

Run: 刷新页面

Expected: 模态框已添加到DOM中（默认不显示）

---

## Task 11: 实现简报生成和显示逻辑

**Files:**
- Modify: `js/core.js`
- Modify: `js/ui.js`

- [ ] **Step 1: 在core.js中添加简报生成函数**

```javascript
function generateDailyBrief(cityDataList, version = 'management') {
    const intensity = calculateSalesIntensity(cityDataList);
    const stats = getLevelStats(cityDataList);
    const regionStats = calculateRegionStats(cityDataList);
    const hotNightCities = getHotNightCities(cityDataList);

    // 获取重点大区
    const activeRegions = Object.entries(regionStats)
        .filter(([_, s]) => s.explosiveCount > 0 || s.actionCount > 0)
        .sort((a, b) => (b[1].explosiveCount * 2 + b[1].actionCount) - (a[1].explosiveCount * 2 + a[1].actionCount))
        .slice(0, 3);

    // 获取重点城市
    const topCities = getTopByADI(cityDataList, 5).map(c => c.cityName);

    // 获取升温城市
    const risingCities = getTopHeatRise(cityDataList, 3).map(c => c.cityName);

    // 核心原因
    let coreReason = '';
    if (stats.outbreak >= 5) coreReason = '多城市达到爆发级，短期需求强烈';
    else if (stats.actionCount >= 8) coreReason = '多城市达到行动级，需求明显增强';
    else if (hotNightCities.length >= 20) coreReason = '夜间温度持续偏高，部分城市连续闷热夜';
    else coreReason = '部分地区有升温迹象';

    const now = new Date();
    const updateTime = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    if (version === 'management') {
        // 管理层短版
        return {
            updateTime,
            intensity,
            content: `
                <div class="brief-update-time">更新时间: ${updateTime}</div>

                <div class="brief-section">
                    <div class="brief-section-title">【整体判断】</div>
                    <div class="brief-section-content">今日空调销售机会${intensity}。</div>
                </div>

                <div class="brief-section">
                    <div class="brief-section-title">【重点大区】</div>
                    <div class="brief-section-content">${activeRegions.map(([name, stats]) => `${name}（${stats.level}）`).join('、') || '暂无明显机会区域'}</div>
                </div>

                <div class="brief-section">
                    <div class="brief-section-title">【重点城市】</div>
                    <div class="brief-section-content">${topCities.join('、') || '暂无'}</div>
                </div>

                <div class="brief-section">
                    <div class="brief-section-title">【未来升温城市】</div>
                    <div class="brief-section-content">${risingCities.join('、') || '暂无明显升温趋势'}</div>
                </div>

                <div class="brief-section">
                    <div class="brief-section-title">【判断依据】</div>
                    <div class="brief-section-content">${coreReason}。未来3天${risingCities.length > 0 ? risingCities.join('、') + '等城市' : ''}ADI${risingCities.length > 0 ? '上升明显' : ''}。</div>
                </div>
            `
        };
    } else {
        // 运营详细版
        return {
            updateTime,
            intensity,
            content: `
                <div class="brief-update-time">更新时间: ${updateTime}</div>

                <div class="brief-section">
                    <div class="brief-section-title">【今日销售机会强度】</div>
                    <div class="brief-section-content">${intensity}（爆发级${stats.outbreak}个，行动级${stats.actionCount}个，机会级${stats.opportunityCount}个）</div>
                </div>

                <div class="brief-section">
                    <div class="brief-section-title">【大区详情】</div>
                    <div class="brief-section-content">
                        ${activeRegions.map(([name, stats]) => {
                            return `${name}（${stats.level}）：爆发级${stats.explosiveCount}个，行动级${stats.actionCount}个，代表城市：${stats.representativeCities.slice(0, 2).join('、')}`;
                        }).join('<br>') || '暂无明显机会区域'}
                    </div>
                </div>

                <div class="brief-section">
                    <div class="brief-section-title">【重点城市TOP5】</div>
                    <div class="brief-section-content">
                        ${topCities.map((cityName, i) => {
                            const city = cityDataList.find(c => c.cityName === cityName);
                            const info = getLevelInfo(city.level);
                            return `${i + 1}. ${cityName}（${info.name}，ADI ${city.adiScore}）`;
                        }).join('<br>')}
                    </div>
                </div>

                <div class="brief-section">
                    <div class="brief-section-title">【升温趋势城市】</div>
                    <div class="brief-section-content">
                        ${risingCities.map((cityName, i) => {
                            const city = cityDataList.find(c => c.cityName === cityName);
                            const futureAdi = city.future7AdiScores[2] || city.adiScore;
                            return `${i + 1}. ${cityName}：今日ADI ${city.adiScore} → 未来3天 ${futureAdi}`;
                        }).join('<br>') || '暂无明显升温趋势'}
                    </div>
                </div>

                <div class="brief-section">
                    <div class="brief-section-title">【夜间闷热情况】</div>
                    <div class="brief-section-content">热夜城市${hotNightCities.length}个，${coreReason}</div>
                </div>
            `
        };
    }
}
```

- [ ] **Step 2: 在core.js公开API中导出函数**

```javascript
return {
    // ...
    calculateSalesIntensity,
    calculateRegionStats,
    generateDailyBrief,  // 新增
    // ...
};
```

- [ ] **Step 3: 在ui.js中添加简报模态框相关函数**

```javascript
// 简报相关
function openDailyBriefModal() {
    const modal = document.getElementById('dailyBriefModal');
    if (!modal) return;

    modal.classList.add('active');
    renderBriefContent('management');
}

function closeDailyBriefModal() {
    const modal = document.getElementById('dailyBriefModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function renderBriefContent(version) {
    const container = document.getElementById('briefContent');
    if (!container) return;

    const brief = Core.generateDailyBrief(state.cityData, version);
    container.innerHTML = brief.content;

    // 更新tab状态
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.version === version);
    });
}

function copyDailyBrief() {
    const container = document.getElementById('briefContent');
    if (!container) return;

    const text = container.innerText;
    navigator.clipboard.writeText(text).then(() => {
        showToast('简报已复制到剪贴板');
    }).catch(() => {
        showToast('复制失败，请手动复制');
    });
}
```

- [ ] **Step 4: 在ui.js的initEventListeners中添加按钮事件**

```javascript
function initEventListeners() {
    // ... 现有代码

    // 生成简报按钮
    const briefBtn = document.getElementById('generateBriefBtn');
    if (briefBtn) {
        briefBtn.addEventListener('click', openDailyBriefModal);
    }

    // 简报模态框tab切换
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            renderBriefContent(tab.dataset.version);
        });
    });

    // ... 其他代码
}
```

- [ ] **Step 5: 在ui.js的return中导出新函数**

```javascript
return {
    init,
    renderDashboard,
    renderAnalysis,
    renderReport,
    renderHistory,
    renderRules,
    selectCity,
    closeCityDetail,
    showCityDetail,
    saveRules,
    resetRules,
    updateWeightTotal,
    openDailyBriefModal,
    closeDailyBriefModal,
    copyDailyBrief,
    showToast,
    state
};
```

- [ ] **Step 6: 在浏览器中测试**

Run: 刷新页面，点击"生成今日简报"按钮

Expected: 简报模态框打开，显示管理层短版，切换tab显示运营详细版，复制功能正常

---

## Task 12: 修改城市详情弹窗 - 增加管理层摘要

**Files:**
- Modify: `js/ui.js:654-730`

- [ ] **Step 1: 修改showCityDetail函数**

在modal-header之后、detail-grid之前添加管理层摘要：

```javascript
content.innerHTML = `
    <button class="modal-close" onclick="UI.closeCityDetail()">✕</button>
    <div class="modal-header" style="border-left: 4px solid ${info.color}">
        <h2>${city.cityName}</h2>
        <div class="modal-meta">
            <span class="modal-level-badge" style="background: ${info.color}">${info.name}</span>
            <span class="modal-adi-score" style="color: ${info.color}">ADI ${city.adiScore}</span>
            <span class="modal-region">${city.region} · ${city.province}</span>
        </div>
    </div>
    <div class="modal-body">
        <!-- 新增：管理层摘要 -->
        <div class="management-summary" style="background: ${info.color}15; border-left: 3px solid ${info.color}; padding: 12px; margin-bottom: 16px; border-radius: 4px;">
            <strong style="color: ${info.color}">💡 管理层摘要</strong><br>
            <span style="color: #e0e6ed; font-size: 14px;">该城市当前处于${info.name}，主要原因是${city.shortReason}，预计短期空调需求${info.order >= 3 ? '较强' : info.order >= 2 ? '中等' : '一般'}。</span>
        </div>

        <div class="detail-grid">
            <!-- 现有内容保持不变 -->
        </div>

        <!-- 其他内容保持不变 -->
    </div>
`;
```

- [ ] **Step 2: 在浏览器中测试**

Run: 点击任意城市，查看详情弹窗

Expected: 弹窗顶部显示管理层摘要

---

## Task 13: 综合测试和验证

**Files:**
- Test: `index-v2.html`

- [ ] **Step 1: 验证页面加载正常**

Run: 在浏览器中打开 `index-v2.html`

Expected: 页面正常加载，无控制台错误

- [ ] **Step 2: 验证销售机会强度显示**

Check: 顶部状态栏第一位显示"销售机会强度"

Expected: 显示强度值（低/中/偏强/强），颜色正确

- [ ] **Step 3: 验证左侧面板三块内容**

Check: 左侧面板显示三个卡片

Expected:
- 今日判断结论：显示强度、重点区域、核心原因
- 大区机会排行：显示各区域统计和代表城市
- 最长连续闷热夜：显示天数、城市、未来3晚温度

- [ ] **Step 4: 验证地图图例和视图说明**

Check: 地图下方显示图例和说明

Expected:
- 图例显示5个等级（爆发级、行动级、机会级、观察级、普通）
- 视图说明根据当前模式显示
- 切换视图模式时说明文字变化

- [ ] **Step 5: 验证右侧榜单切换**

Check: 右侧榜单Tab切换

Expected:
- Tab名称：重点城市、闷热城市、升温城市
- 切换时内容正确更新

- [ ] **Step 6: 验证简报模态框**

Check: 点击"生成今日简报"按钮

Expected:
- 模态框打开
- 默认显示管理层短版
- 切换到运营详细版
- 复制功能正常
- 关闭功能正常

- [ ] **Step 7: 验证城市详情弹窗**

Check: 点击任意城市

Expected:
- 弹窗显示
- 顶部显示管理层摘要
- 其他信息正常显示

- [ ] **Step 8: 验证响应式布局**

Check: 调整浏览器窗口大小

Expected: 布局自适应，无严重错位

- [ ] **Step 9: 检查控制台错误**

Check: 打开浏览器开发者工具

Expected: 无JavaScript错误，无CSS警告

---

## Task 14: 代码审查和清理

**Files:**
- Review: `js/core.js`, `js/ui.js`, `index-v2.html`, `css/styles-v2.css`

- [ ] **Step 1: 检查代码一致性**

Review: 检查函数名、变量名一致性

Expected: 命名规范统一，无拼写错误

- [ ] **Step 2: 检查未使用的代码**

Review: 检查是否有废弃代码

Expected: 删除或注释掉不再使用的 `renderTodaySummary` 函数

- [ ] **Step 3: 检查CSS重复定义**

Review: 检查CSS文件

Expected: 无重复样式定义

- [ ] **Step 4: 验证所有函数都被调用**

Review: 检查新增的函数是否都被正确调用

Expected: 所有新增函数都有调用点

---

## Task 15: 最终提交

**Files:**
- Commit: 所有修改的文件

- [ ] **Step 1: 查看所有修改**

Run:
```bash
git status
git diff
```

Expected: 看到所有预期的修改

- [ ] **Step 2: 提交所有更改**

Run:
```bash
git add index-v2.html js/core.js js/ui.js js/map.js css/styles-v2.css
git commit -m "feat: redesign sales opportunity dashboard homepage

- 修改页面标题和副标题为销售相关文案
- 新增销售机会强度判断逻辑和显示
- 重构左侧面板：今日判断结论、大区机会排行、最长连续闷热夜
- 修改地图标题为'全国空调销售机会热力图'
- 新增地图图例和视图说明
- 简化右侧榜单Tab名称
- 新增今日简报模态框功能
- 城市详情弹窗增加管理层摘要

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 3: 验证提交成功**

Run:
```bash
git log -1 --stat
```

Expected: 显示最新的提交信息和修改的文件列表

---

## 实施完成检查清单

### 功能完整性
- [ ] 侧边栏logo副标题已更新
- [ ] 导航"今日热销"改为"销售总览"
- [ ] 顶部状态栏显示销售机会强度
- [ ] 左侧面板显示今日判断结论
- [ ] 左侧面板显示大区机会排行
- [ ] 左侧面板显示最长连续闷热夜
- [ ] 地图标题已更新
- [ ] 地图下方显示图例
- [ ] 地图显示视图说明
- [ ] 右侧Tab名称已简化
- [ ] 生成简报按钮存在且可点击
- [ ] 简报模态框功能正常
- [ ] 城市详情弹窗显示管理层摘要

### 数据逻辑正确性
- [ ] 销售机会强度计算符合规则
- [ ] 大区统计数据正确
- [ ] 简报生成逻辑正确
- [ ] 各榜单数据正确

### UI/UX质量
- [ ] 颜色方案保持深色科技风
- [ ] 布局响应式正常
- [ ] 文案统一使用销售相关术语
- [ ] 无控制台错误
- [ ] 交互流畅无卡顿

### 代码质量
- [ ] 无未使用的代码
- [ ] 函数命名统一
- [ ] CSS无重复定义
- [ ] 代码格式规范
