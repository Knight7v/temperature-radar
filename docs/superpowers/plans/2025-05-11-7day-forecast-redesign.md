# 7天预测页面重新设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the 7-day forecast page to show a detailed 7-day trend matrix with three view modes (temperature, feels-like temperature, ADI index) for 86 cities.

**Architecture:** Extend existing data model to include `future7Days` array with daily forecast data. Create dimension-based rendering functions that generate a table with 9 fixed left columns and 7 scrollable date columns. Reuse existing UI patterns and Core module utilities.

**Tech Stack:** Vanilla JavaScript (module pattern), CSS Grid Layout with sticky positioning, ECharts (for chart elements if needed)

---

## Task 1: Extend Core.generateCityData() to include future7Days array

**Files:**
- Modify: `js/core.js:627-739`

- [ ] **Step 1: Add generate7DayDailyData() helper function**

Add this new function before `generateCityData()` (around line 626):

```javascript
function generate7DayDailyData(baseCityData, dayIndex) {
    // 渐进式变化：温度每天变化 -2°C 到 +3°C
    const tempChange = (dayIndex + 1) * 0.4;
    const dayMax = Math.max(15, Math.round(baseCityData.maxTemp + (Math.random() - 0.35) * 5 + tempChange));
    const dayNight = Math.max(10, Math.round(baseCityData.nightMinTemp + (Math.random() - 0.35) * 4 + tempChange));
    const dayHumidity = Math.max(30, Math.min(100, Math.round(baseCityData.humidity + (Math.random() - 0.5) * 10)));
    const dayFeelsLike = Math.round(dayMax + Math.max(0, (dayHumidity - 55) * 0.08) + Math.random());

    // 连续热夜天数计算
    let dayCont;
    if (dayIndex === 0) {
        dayCont = baseCityData.continuousHotNightDays;
    } else {
        dayCont = dayNight >= 28
            ? Math.min(baseCityData.continuousHotNightDays + Math.ceil(Math.random() * 2), 7)
            : Math.max(0, baseCityData.continuousHotNightDays - Math.floor(Math.random() * 2));
    }

    // 计算当日ADI
    const dayData = {
        maxTemp: dayMax,
        nightMinTemp: dayNight,
        feelsLike: dayFeelsLike,
        humidity: dayHumidity,
        continuousHotNightDays: dayCont
    };
    const adiResult = calculateADI(dayData);
    const levelResult = determineLevel(adiResult.adiScore, dayData);

    // 创建日期对象
    const date = new Date();
    date.setDate(date.getDate() + dayIndex);

    return {
        date: date,
        dayMax: dayMax,
        nightMin: dayNight,
        dayFeelsLike: dayFeelsLike,
        nightFeelsLike: Math.round(dayNight + (dayHumidity - 50) * 0.08),
        humidity: dayHumidity,
        adiScore: adiResult.adiScore,
        level: levelResult.level,
        isHotNight: dayNight >= 28
    };
}
```

- [ ] **Step 2: Modify generateCityData() to generate future7Days array**

Modify the `generateCityData()` function to add the `future7Days` array. Find the return statement (around line 729) and modify it:

```javascript
// Generate future7Days array
const future7Days = [];
for (let i = 0; i < 7; i++) {
    future7Days.push(generate7DayDailyData({
        maxTemp,
        nightMinTemp,
        humidity,
        continuousHotNightDays
    }, i));
}

return {
    ...data,
    adiScore: adiResult.adiScore,
    adiBreakdown: adiResult.breakdown,
    level: levelResult.level,
    triggeredRules: levelResult.triggeredRules,
    reason,
    shortReason,
    levelTrend,
    future7Days  // Add this new field
};
```

- [ ] **Step 3: Verify data structure in browser console**

Open `index-v2.html` in browser, open DevTools console, run:

```javascript
// After page loads, get a city's data
const cityData = Core.generateAllCityData()[0];
console.log('future7Days:', cityData.future7Days);
console.assert(cityData.future7Days.length === 7, 'Should have 7 days');
console.assert(cityData.future7Days[0].date instanceof Date, 'Day 0 should have Date object');
console.assert(typeof cityData.future7Days[0].adiScore === 'number', 'Day 0 should have ADI score');
```

Expected: No assertion errors, future7Days array logged with 7 elements.

- [ ] **Step 4: Commit**

```bash
git add js/core.js
git commit -m "feat(core): add future7Days array to city data model"
```

---

## Task 2: Add UI state fields for dimension and search

**Files:**
- Modify: `js/ui.js:8-16`

- [ ] **Step 1: Add new state fields**

Add two new fields to the state object:

```javascript
let state = {
    currentPage: 'dashboard',
    cityData: [],
    selectedCity: null,
    mapViewMode: 'adi',
    activeTopTab: 'hotSales',
    reportFilter: 'all',
    historyFilter: 'today',
    reportDimension: 'temperature',  // NEW: 'temperature' | 'feelsLike' | 'adi'
    reportSearch: ''                 // NEW: search keyword for city name
};
```

- [ ] **Step 2: Verify state initialization**

In browser console, run:

```javascript
console.log('reportDimension:', UI.state.reportDimension);
console.log('reportSearch:', UI.state.reportSearch);
```

Expected: `reportDimension: 'temperature'`, `reportSearch: ''`

- [ ] **Step 3: Commit**

```bash
git add js/ui.js
git commit -m "feat(ui): add reportDimension and reportSearch state fields"
```

---

## Task 3: Update HTML structure for 7-day forecast page

**Files:**
- Modify: `index-v2.html:263-309`

- [ ] **Step 1: Replace report page HTML with new structure**

Replace the entire `<div class="page" id="report">...</div>` section with:

```html
<!-- 7天预测 Page -->
<div class="page" id="report">
    <div class="report-page">
        <div class="page-header">
            <h2>7天热销预测</h2>
            <p class="page-desc">基于ADI指数的未来7天热销趋势预测</p>
            <div class="search-box">
                <span class="search-icon">🔍</span>
                <input type="text" id="reportSearchInput" placeholder="搜索城市名称..." />
            </div>
        </div>
        <div class="dimension-toggle">
            <button class="dimension-btn active" data-dimension="temperature">高低温度</button>
            <button class="dimension-btn" data-dimension="feelsLike">高低体感温度</button>
            <button class="dimension-btn" data-dimension="adi">ADI指数</button>
        </div>
        <div class="filter-bar" id="reportFilters">
            <button class="filter-btn active" data-filter="all">全部</button>
            <button class="filter-btn" data-filter="outbreak">爆发级</button>
            <button class="filter-btn" data-filter="action">行动级</button>
            <button class="filter-btn" data-filter="opportunity">机会级</button>
            <button class="filter-btn" data-filter="observe">观察级</button>
            <button class="filter-btn" data-filter="nightMuggy">夜间闷热</button>
            <button class="filter-btn" data-filter="heatRise">未来升温</button>
            <span class="filter-sep">|</span>
            <button class="filter-btn" data-filter="华东">华东</button>
            <button class="filter-btn" data-filter="华南">华南</button>
            <button class="filter-btn" data-filter="华中">华中</button>
            <button class="filter-btn" data-filter="西南">西南</button>
            <button class="filter-btn" data-filter="华北">华北</button>
            <button class="filter-btn" data-filter="西北">西北</button>
            <button class="filter-btn" data-filter="东北">东北</button>
        </div>
        <div class="forecast-table-wrapper">
            <table class="forecast-table" id="forecastTable">
                <thead>
                    <tr id="forecastTableHead"></tr>
                </thead>
                <tbody id="forecastTableBody"></tbody>
            </table>
        </div>
    </div>
</div>
```

- [ ] **Step 2: Verify HTML structure in browser**

Open page, navigate to "7天预测", check DevTools Elements panel.

Expected: New HTML structure visible with search box, dimension toggle buttons, and empty forecast table.

- [ ] **Step 3: Commit**

```bash
git add index-v2.html
git commit -m "feat(html): update 7-day forecast page structure"
```

---

## Task 4: Add CSS styles for forecast table

**Files:**
- Modify: `css/styles-v2.css`

- [ ] **Step 1: Add forecast table styles**

Add these styles at the end of the CSS file:

```css
/* ==================== 7-Day Forecast Table ==================== */

.search-box {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 8px 16px;
    margin-left: auto;
    width: 200px;
}

.search-icon {
    margin-right: 8px;
    opacity: 0.6;
}

.search-box input {
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 0.85rem;
    width: 100%;
    outline: none;
}

.search-box input::placeholder {
    color: var(--text-secondary);
}

.dimension-toggle {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
}

.dimension-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: var(--text-secondary);
    padding: 8px 16px;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s ease;
}

.dimension-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
}

.dimension-btn.active {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-color: transparent;
    color: #fff;
}

.forecast-table-wrapper {
    background: rgba(20, 27, 61, 0.8);
    border-radius: 12px;
    overflow-x: auto;
    overflow-y: auto;
    max-height: calc(100vh - 320px);
    border: 1px solid rgba(255, 255, 255, 0.05);
}

.forecast-table {
    width: auto;
    min-width: 100%;
    border-collapse: separate;
    border-spacing: 0;
}

.forecast-table thead th {
    position: sticky;
    top: 0;
    background: #1a2347;
    color: var(--text-primary);
    font-weight: 600;
    font-size: 0.8rem;
    padding: 12px 16px;
    text-align: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    z-index: 10;
    white-space: nowrap;
}

.forecast-table thead th.fixed-left {
    position: sticky;
    left: 0;
    z-index: 20;
    background: #1a2347;
}

.forecast-table thead th.fixed-left:nth-child(1) { left: 0; }
.forecast-table thead th.fixed-left:nth-child(2) { left: 80px; }
.forecast-table thead th.fixed-left:nth-child(3) { left: 160px; }
.forecast-table thead th.fixed-left:nth-child(4) { left: 240px; }
.forecast-table thead th.fixed-left:nth-child(5) { left: 300px; }
.forecast-table thead th.fixed-left:nth-child(6) { left: 380px; }
.forecast-table thead th.fixed-left:nth-child(7) { left: 460px; }
.forecast-table thead th.fixed-left:nth-child(8) { left: 550px; }
.forecast-table thead th.fixed-left:nth-child(9) { left: 630px; }

.forecast-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.03);
}

.forecast-table tbody td {
    padding: 10px 14px;
    font-size: 0.8rem;
    color: var(--text-primary);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    border-right: 1px solid rgba(255, 255, 255, 0.03);
    white-space: nowrap;
}

.forecast-table tbody td.fixed-left {
    position: sticky;
    left: 0;
    background: rgba(20, 27, 61, 0.95);
    z-index: 5;
}

.forecast-table tbody td.fixed-left:nth-child(1) { left: 0; }
.forecast-table tbody td.fixed-left:nth-child(2) { left: 80px; }
.forecast-table tbody td.fixed-left:nth-child(3) { left: 160px; }
.forecast-table tbody td.fixed-left:nth-child(4) { left: 240px; }
.forecast-table tbody td.fixed-left:nth-child(5) { left: 300px; }
.forecast-table tbody td.fixed-left:nth-child(6) { left: 380px; }
.forecast-table tbody td.fixed-left:nth-child(7) { left: 460px; }
.forecast-table tbody td.fixed-left:nth-child(8) { left: 550px; }
.forecast-table tbody td.fixed-left:nth-child(9) { left: 630px;}

.forecast-table tbody tr:hover td.fixed-left {
    background: rgba(40, 47, 80, 0.95);
}

/* Temperature cell styles */
.temp-cell-high { color: #D0021B; font-weight: 600; }
.temp-cell-medium { color: #F5A623; font-weight: 500; }
.temp-cell-low { color: #00D4FF; font-weight: 500; }

/* ADI cell background colors */
.adi-cell-outbreak { background: rgba(208, 2, 27, 0.3); }
.adi-cell-action { background: rgba(245, 124, 0, 0.25); }
.adi-cell-opportunity { background: rgba(245, 166, 35, 0.2); }
.adi-cell-observe { background: rgba(74, 144, 226, 0.15); }
.adi-cell-normal { background: rgba(102, 102, 102, 0.1); }

/* Hot night indicator */
.hot-night-indicator {
    position: absolute;
    top: 2px;
    right: 2px;
    font-size: 0.65rem;
}

/* Tooltip for forecast cells */
.forecast-tooltip {
    position: fixed;
    background: rgba(20, 27, 61, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 12px;
    max-width: 250px;
    z-index: 1000;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.forecast-tooltip.show {
    opacity: 1;
}

.forecast-tooltip-header {
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--text-primary);
}

.forecast-tooltip-body {
    font-size: 0.8rem;
    color: var(--text-secondary);
    line-height: 1.5;
}

.forecast-tooltip-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
}

/* Date column header */
.date-header {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.date-header-day {
    font-size: 0.75rem;
    color: var(--text-secondary);
}

.date-header-date {
    font-size: 0.85rem;
    font-weight: 600;
}

/* Empty state */
.forecast-empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-secondary);
}

.forecast-empty-icon {
    font-size: 3rem;
    margin-bottom: 16px;
    opacity: 0.5;
}
```

- [ ] **Step 2: Verify styles apply correctly**

Open browser, navigate to "7天预测", check DevTools Styles panel on forecast elements.

Expected: Styles are applied, table has sticky headers and columns.

- [ ] **Step 3: Commit**

```bash
git add css/styles-v2.css
git commit -m "feat(css): add forecast table styles"
```

---

## Task 5: Implement dimension switching event handlers

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: Add dimension toggle initialization in initFilters()**

Find the `initFilters()` function (around line 127) and add dimension button handlers:

```javascript
function initFilters() {
    // Dimension toggle buttons
    document.querySelectorAll('.dimension-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.dimension-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.reportDimension = btn.dataset.dimension;
            renderReport();
        });
    });

    // Search input
    const searchInput = document.getElementById('reportSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.reportSearch = e.target.value.toLowerCase().trim();
            renderReport();
        });
    }

    // ... existing filter handlers remain unchanged
}
```

- [ ] **Step 2: Test dimension switching**

Open browser, navigate to "7天预测", click dimension buttons, check console:

```javascript
// In browser console
document.querySelector('.dimension-btn[data-dimension="feelsLike"]').click();
console.log('Dimension:', UI.state.reportDimension);
```

Expected: `reportDimension` changes, buttons highlight correctly.

- [ ] **Step 3: Test search functionality**

Type in search box, check console:

```javascript
// In browser console
document.getElementById('reportSearchInput').value = '北京';
document.getElementById('reportSearchInput').dispatchEvent(new Event('input'));
console.log('Search:', UI.state.reportSearch);
```

Expected: `reportSearch` equals '北京' (lowercased).

- [ ] **Step 4: Commit**

```bash
git add js/ui.js
git commit -m "feat(ui): add dimension toggle and search event handlers"
```

---

## Task 6: Refactor renderReport() to use dimension routing

**Files:**
- Modify: `js/ui.js:458-508`

- [ ] **Step 1: Replace renderReport() with dimension router**

Replace the entire `renderReport()` function with:

```javascript
function renderReport() {
    const thead = document.getElementById('forecastTableHead');
    const tbody = document.getElementById('forecastTableBody');
    if (!thead || !tbody || state.cityData.length === 0) return;

    // Filter cities based on reportFilter and reportSearch
    let cities = [...state.cityData];
    const filter = state.reportFilter;

    // Apply level/region filters
    if (['outbreak', 'action', 'opportunity', 'observe'].includes(filter)) {
        cities = cities.filter(c => c.level === filter);
    } else if (filter === 'nightMuggy') {
        cities = cities.filter(c => {
            const hotNightCount = c.future7Days.filter(d => d.isHotNight).length;
            return hotNightCount >= 2;
        });
    } else if (filter === 'heatRise') {
        cities = cities.filter(c => {
            if (!c.future7Days || c.future7Days.length < 7) return false;
            const day7Adi = c.future7Days[6].adiScore;
            return day7Adi - c.adiScore >= 10;
        });
    } else if (['华东', '华南', '华中', '西南', '华北', '西北', '东北'].includes(filter)) {
        cities = cities.filter(c => c.region === filter);
    }

    // Apply search filter
    if (state.reportSearch) {
        cities = cities.filter(c => c.cityName.toLowerCase().includes(state.reportSearch));
    }

    // Sort by future 3-day ADI average, then today's ADI
    cities.sort((a, b) => {
        const avgA = a.future7Days.slice(0, 3).reduce((sum, d) => sum + d.adiScore, 0) / 3;
        const avgB = b.future7Days.slice(0, 3).reduce((sum, d) => sum + d.adiScore, 0) / 3;
        if (avgB !== avgA) return avgB - avgA;
        return b.adiScore - a.adiScore;
    });

    // Route to dimension-specific renderer
    switch (state.reportDimension) {
        case 'temperature':
            renderReportTemperature(cities, thead, tbody);
            break;
        case 'feelsLike':
            renderReportFeelsLike(cities, thead, tbody);
            break;
        case 'adi':
            renderReportADI(cities, thead, tbody);
            break;
        default:
            renderReportTemperature(cities, thead, tbody);
    }
}
```

- [ ] **Step 2: Verify function routes correctly**

Test in browser console:

```javascript
UI.state.reportDimension = 'temperature';
UI.renderReport();
console.log('Should call renderReportTemperature');

UI.state.reportDimension = 'adi';
UI.renderReport();
console.log('Should call renderReportADI');
```

Expected: No errors, functions are called (we'll implement them next).

- [ ] **Step 3: Commit**

```bash
git add js/ui.js
git commit -m "refactor(ui): route renderReport to dimension-specific functions"
```

---

## Task 7: Implement renderReportTemperature() function

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: Add renderReportTemperature() function**

Add this function after `renderReport()` (around line 508):

```javascript
function renderReportTemperature(cities, thead, tbody) {
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const now = new Date();

    // Generate date headers for 7 days
    let headerHtml = `
        <th class="fixed-left">区域</th>
        <th class="fixed-left">省份</th>
        <th class="fixed-left">城市</th>
        <th class="fixed-left">当前等级</th>
        <th class="fixed-left">今日ADI</th>
        <th class="fixed-left">7天最高ADI</th>
        <th class="fixed-left">7天最高等级</th>
        <th class="fixed-left">热夜天数</th>
        <th class="fixed-left">等级趋势</th>
    `;

    for (let i = 0; i < 7; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() + i);
        headerHtml += `
            <th>
                <div class="date-header">
                    <span class="date-header-day">${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}</span>
                </div>
            </th>
        `;
    }
    thead.innerHTML = headerHtml;

    // Generate table body
    if (cities.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="16" class="forecast-empty-state">
                    <div class="forecast-empty-icon">🔍</div>
                    <div>未找到匹配的城市</div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = cities.map(city => {
        const currentInfo = Core.getLevelInfo(city.level);
        const maxAdi = Math.max(...city.future7Days.map(d => d.adiScore));
        const maxLevelInfo = Core.getLevelInfo(
            city.future7Days.find(d => d.adiScore === maxAdi)?.level || 'normal'
        );
        const hotNightCount = city.future7Days.filter(d => d.isHotNight).length;
        const trendInfo = Core.calculateLevelTrend(city.level, city.future7Days.map(d => d.adiScore));

        // Fixed columns
        let rowHtml = `
            <td class="fixed-left">${city.region}</td>
            <td class="fixed-left">${city.province}</td>
            <td class="fixed-left">${city.cityName}</td>
            <td class="fixed-left">
                <span class="table-level-badge" style="background: ${currentInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                    ${currentInfo.name}
                </span>
            </td>
            <td class="fixed-left">${city.adiScore}</td>
            <td class="fixed-left">${maxAdi}</td>
            <td class="fixed-left">
                <span class="table-level-badge" style="background: ${maxLevelInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                    ${maxLevelInfo.name}
                </span>
            </td>
            <td class="fixed-left">${hotNightCount > 0 ? hotNightCount + '天' : '-'}</td>
            <td class="fixed-left" style="color: ${trendInfo.trendColor}; font-size: 0.75rem;">${trendInfo.trendText}</td>
        `;

        // 7-day data columns
        city.future7Days.forEach((day, idx) => {
            const tempHigh = day.dayMax;
            const tempLow = day.nightMin;
            const highColor = tempHigh >= 35 ? '#D0021B' : tempHigh >= 33 ? '#F57C00' : tempHigh >= 30 ? '#F5A623' : '#4A90E2';
            const lowColor = tempLow >= 28 ? '#D0021B' : tempLow >= 26 ? '#F5A623' : '#00D4FF';
            const hotNightIcon = day.isHotNight ? '<span class="hot-night-indicator">🌙</span>' : '';

            rowHtml += `
                <td style="position: relative;" data-city="${city.cityName}" data-day="${idx}">
                    <div style="position: relative;">
                        <div style="color: ${highColor}; font-weight: 600;">${tempHigh}°</div>
                        <div style="color: ${lowColor}; font-size: 0.75rem;">${tempLow}°</div>
                        ${hotNightIcon}
                    </div>
                </td>
            `;
        });

        return `<tr>${rowHtml}</tr>`;
    }).join('');
}
```

- [ ] **Step 2: Test temperature mode rendering**

Open browser, navigate to "7天预测", verify table displays correctly.

```javascript
// In browser console
// Check table rows
const rows = document.querySelectorAll('#forecastTableBody tr');
console.log('Table rows:', rows.length);
// Check first row cells
console.log('First row cells:', rows[0]?.querySelectorAll('td').length);
```

Expected: 86 rows (or filtered count), 16 cells per row (9 fixed + 7 days).

- [ ] **Step 3: Commit**

```bash
git add js/ui.js
git commit -m "feat(ui): implement renderReportTemperature function"
```

---

## Task 8: Implement renderReportFeelsLike() function

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: Add renderReportFeelsLike() function**

Add this function after `renderReportTemperature()`:

```javascript
function renderReportFeelsLike(cities, thead, tbody) {
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const now = new Date();

    // Generate date headers (same as temperature mode)
    let headerHtml = `
        <th class="fixed-left">区域</th>
        <th class="fixed-left">省份</th>
        <th class="fixed-left">城市</th>
        <th class="fixed-left">当前等级</th>
        <th class="fixed-left">今日ADI</th>
        <th class="fixed-left">7天最高ADI</th>
        <th class="fixed-left">7天最高等级</th>
        <th class="fixed-left">热夜天数</th>
        <th class="fixed-left">等级趋势</th>
    `;

    for (let i = 0; i < 7; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() + i);
        headerHtml += `
            <th>
                <div class="date-header">
                    <span class="date-header-day">${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}</span>
                </div>
            </th>
        `;
    }
    thead.innerHTML = headerHtml;

    // Empty state
    if (cities.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="16" class="forecast-empty-state">
                    <div class="forecast-empty-icon">🔍</div>
                    <div>未找到匹配的城市</div>
                </td>
            </tr>
        `;
        return;
    }

    // Generate table body with feels-like temperatures
    tbody.innerHTML = cities.map(city => {
        const currentInfo = Core.getLevelInfo(city.level);
        const maxAdi = Math.max(...city.future7Days.map(d => d.adiScore));
        const maxLevelInfo = Core.getLevelInfo(
            city.future7Days.find(d => d.adiScore === maxAdi)?.level || 'normal'
        );
        const hotNightCount = city.future7Days.filter(d => d.nightFeelsLike >= 30).length;
        const trendInfo = Core.calculateLevelTrend(city.level, city.future7Days.map(d => d.adiScore));

        // Fixed columns (same as temperature)
        let rowHtml = `
            <td class="fixed-left">${city.region}</td>
            <td class="fixed-left">${city.province}</td>
            <td class="fixed-left">${city.cityName}</td>
            <td class="fixed-left">
                <span class="table-level-badge" style="background: ${currentInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                    ${currentInfo.name}
                </span>
            </td>
            <td class="fixed-left">${city.adiScore}</td>
            <td class="fixed-left">${maxAdi}</td>
            <td class="fixed-left">
                <span class="table-level-badge" style="background: ${maxLevelInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                    ${maxLevelInfo.name}
                </span>
            </td>
            <td class="fixed-left">${hotNightCount > 0 ? hotNightCount + '天' : '-'}</td>
            <td class="fixed-left" style="color: ${trendInfo.trendColor}; font-size: 0.75rem;">${trendInfo.trendText}</td>
        `;

        // 7-day data columns with feels-like temperatures
        city.future7Days.forEach((day) => {
            const dayFeelsLike = day.dayFeelsLike;
            const nightFeelsLike = day.nightFeelsLike;
            const highColor = dayFeelsLike >= 40 ? '#D0021B' : dayFeelsLike >= 37 ? '#F57C00' : dayFeelsLike >= 34 ? '#F5A623' : '#4A90E2';
            const lowColor = nightFeelsLike >= 32 ? '#D0021B' : nightFeelsLike >= 30 ? '#F5A623' : '#00D4FF';
            const hotNightIcon = nightFeelsLike >= 30 ? '<span class="hot-night-indicator">🌙</span>' : '';

            rowHtml += `
                <td style="position: relative;" data-city="${city.cityName}" data-day="${idx}">
                    <div style="position: relative;">
                        <div style="color: ${highColor}; font-weight: 600;">${dayFeelsLike}°</div>
                        <div style="color: ${lowColor}; font-size: 0.75rem;">${nightFeelsLike}°</div>
                        ${hotNightIcon}
                    </div>
                </td>
            `;
        });

        return `<tr>${rowHtml}</tr>`;
    }).join('');
}
```

- [ ] **Step 2: Test feels-like mode rendering**

```javascript
// In browser console
// Switch to feels-like mode
document.querySelector('.dimension-btn[data-dimension="feelsLike"]').click();
// Check first data cell
const firstDataCell = document.querySelector('#forecastTableBody td[data-city]');
console.log('First data cell:', firstDataCell?.textContent);
```

Expected: Table displays feels-like temperatures, hot night indicator based on nightFeelsLike >= 30.

- [ ] **Step 3: Commit**

```bash
git add js/ui.js
git commit -m "feat(ui): implement renderReportFeelsLike function"
```

---

## Task 9: Implement renderReportADI() function

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: Add renderReportADI() function**

Add this function after `renderReportFeelsLike()`:

```javascript
function renderReportADI(cities, thead, tbody) {
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const now = new Date();

    // Generate date headers
    let headerHtml = `
        <th class="fixed-left">区域</th>
        <th class="fixed-left">省份</th>
        <th class="fixed-left">城市</th>
        <th class="fixed-left">当前等级</th>
        <th class="fixed-left">今日ADI</th>
        <th class="fixed-left">7天最高ADI</th>
        <th class="fixed-left">7天最高等级</th>
        <th class="fixed-left">热夜天数</th>
        <th class="fixed-left">等级趋势</th>
    `;

    for (let i = 0; i < 7; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() + i);
        headerHtml += `
            <th>
                <div class="date-header">
                    <span class="date-header-day">${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}</span>
                </div>
            </th>
        `;
    }
    thead.innerHTML = headerHtml;

    // Empty state
    if (cities.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="16" class="forecast-empty-state">
                    <div class="forecast-empty-icon">🔍</div>
                    <div>未找到匹配的城市</div>
                </td>
            </tr>
        `;
        return;
    }

    // Helper function to get ADI cell color class
    function getAdiColorClass(adi) {
        if (adi >= 90) return 'adi-cell-outbreak';
        if (adi >= 85) return 'adi-cell-action';
        if (adi >= 75) return 'adi-cell-opportunity';
        if (adi >= 65) return 'adi-cell-observe';
        return 'adi-cell-normal';
    }

    // Generate table body with ADI scores
    tbody.innerHTML = cities.map(city => {
        const currentInfo = Core.getLevelInfo(city.level);
        const maxAdi = Math.max(...city.future7Days.map(d => d.adiScore));
        const maxLevelInfo = Core.getLevelInfo(
            city.future7Days.find(d => d.adiScore === maxAdi)?.level || 'normal'
        );
        const hotNightCount = city.future7Days.filter(d => d.isHotNight).length;
        const trendInfo = Core.calculateLevelTrend(city.level, city.future7Days.map(d => d.adiScore));

        // Fixed columns
        let rowHtml = `
            <td class="fixed-left">${city.region}</td>
            <td class="fixed-left">${city.province}</td>
            <td class="fixed-left">${city.cityName}</td>
            <td class="fixed-left">
                <span class="table-level-badge" style="background: ${currentInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                    ${currentInfo.name}
                </span>
            </td>
            <td class="fixed-left">${city.adiScore}</td>
            <td class="fixed-left">${maxAdi}</td>
            <td class="fixed-left">
                <span class="table-level-badge" style="background: ${maxLevelInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                    ${maxLevelInfo.name}
                </span>
            </td>
            <td class="fixed-left">${hotNightCount > 0 ? hotNightCount + '天' : '-'}</td>
            <td class="fixed-left" style="color: ${trendInfo.trendColor}; font-size: 0.75rem;">${trendInfo.trendText}</td>
        `;

        // 7-day data columns with ADI scores
        city.future7Days.forEach((day) => {
            const adi = day.adiScore;
            const colorClass = getAdiColorClass(adi);
            const levelInfo = Core.getLevelInfo(day.level);
            const hotNightIcon = day.isHotNight ? '<span class="hot-night-indicator">🌙</span>' : '';

            rowHtml += `
                <td class="${colorClass}" style="position: relative; text-align: center;" data-city="${city.cityName}" data-day="${idx}">
                    <div style="position: relative;">
                        <div style="font-weight: 700; font-size: 0.9rem;">${adi}</div>
                        <div style="font-size: 0.65rem; opacity: 0.8;">${levelInfo.name}</div>
                        ${hotNightIcon}
                    </div>
                </td>
            `;
        });

        return `<tr>${rowHtml}</tr>`;
    }).join('');
}
```

- [ ] **Step 2: Test ADI mode rendering**

```javascript
// In browser console
// Switch to ADI mode
document.querySelector('.dimension-btn[data-dimension="adi"]').click();
// Check ADI cell backgrounds
const adiCells = document.querySelectorAll('#forecastTableBody td[class*="adi-cell-"]');
console.log('ADI colored cells:', adiCells.length);
```

Expected: Table displays ADI scores with colored backgrounds based on value ranges.

- [ ] **Step 3: Commit**

```bash
git add js/ui.js
git commit -m "feat(ui): implement renderReportADI function"
```

---

## Task 10: Export new functions from UI module

**Files:**
- Modify: `js/ui.js:890-895`

- [ ] **Step 1: Update return statement to include new functions**

Find the return statement at the end of the UI module and update it:

```javascript
return {
    init, renderDashboard, renderAnalysis, renderReport, renderHistory, renderRules,
    renderReportTemperature, renderReportFeelsLike, renderReportADI,  // NEW
    selectCity, closeCityDetail, showCityDetail, saveRules, resetRules, updateWeightTotal,
    showToast, state, renderTodayConclusion, renderRegionRanking, renderLongestHotNight,
    openDailyBriefModal, closeDailyBriefModal, copyDailyBrief
};
```

- [ ] **Step 2: Verify functions are exported**

```javascript
// In browser console
console.log('renderReportTemperature:', typeof UI.renderReportTemperature);
console.log('renderReportFeelsLike:', typeof UI.renderReportFeelsLike);
console.log('renderReportADI:', typeof UI.renderReportADI);
```

Expected: All three return 'function'.

- [ ] **Step 3: Commit**

```bash
git add js/ui.js
git commit -m "feat(ui): export new dimension render functions"
```

---

## Task 11: Implement tooltip functionality

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: Add tooltip HTML creation helper**

Add this helper function after the escapeHtml function (around line 34):

```javascript
function showDayTooltip(city, dayData, dayIndex) {
    let tooltip = document.getElementById('forecastTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'forecastTooltip';
        tooltip.className = 'forecast-tooltip';
        document.body.appendChild(tooltip);
    }

    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const date = dayData.date;
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}`;

    const levelInfo = Core.getLevelInfo(dayData.level);

    tooltip.innerHTML = `
        <div class="forecast-tooltip-header">${city.cityName} - ${dateStr}</div>
        <div class="forecast-tooltip-body">
            <div class="forecast-tooltip-row">
                <span>白天最高温:</span>
                <span style="color: ${dayData.dayMax >= 35 ? '#D0021B' : '#F5A623'}">${dayData.dayMax}℃</span>
            </div>
            <div class="forecast-tooltip-row">
                <span>夜间最低温:</span>
                <span style="color: ${dayData.nightMin >= 28 ? '#D0021B' : '#00D4FF'}">${dayData.nightMin}℃</span>
            </div>
            <div class="forecast-tooltip-row">
                <span>最高体感:</span>
                <span style="color: ${dayData.dayFeelsLike >= 38 ? '#D0021B' : '#F5A623'}">${dayData.dayFeelsLike}℃</span>
            </div>
            <div class="forecast-tooltip-row">
                <span>最低体感:</span>
                <span style="color: ${dayData.nightFeelsLike >= 30 ? '#D0021B' : '#00D4FF'}">${dayData.nightFeelsLike}℃</span>
            </div>
            <div class="forecast-tooltip-row">
                <span>湿度:</span>
                <span>${dayData.humidity}%</span>
            </div>
            <div class="forecast-tooltip-row">
                <span>ADI:</span>
                <span style="color: ${levelInfo.color}; font-weight: 600;">${dayData.adiScore} [${levelInfo.name}]</span>
            </div>
            ${dayData.isHotNight ? '<div class="forecast-tooltip-row" style="color: #D0021B;">🌙 热夜</div>' : ''}
        </div>
    `;

    return tooltip;
}

function hideDayTooltip() {
    const tooltip = document.getElementById('forecastTooltip');
    if (tooltip) {
        tooltip.classList.remove('show');
    }
}
```

- [ ] **Step 2: Add tooltip event listeners in renderReport()**

Modify the `renderReport()` function to add event delegation after the switch statement:

```javascript
function renderReport() {
    // ... existing code ...

    // Route to dimension-specific renderer
    switch (state.reportDimension) {
        case 'temperature':
            renderReportTemperature(cities, thead, tbody);
            break;
        case 'feelsLike':
            renderReportFeelsLike(cities, thead, tbody);
            break;
        case 'adi':
            renderReportADI(cities, thead, tbody);
            break;
        default:
            renderReportTemperature(cities, thead, tbody);
    }

    // Setup tooltip event listeners
    setupTooltipListeners(cities);
}

function setupTooltipListeners(cities) {
    const tbody = document.getElementById('forecastTableBody');
    if (!tbody) return;

    // Remove existing listeners
    tbody.querySelectorAll('td[data-city]').forEach(cell => {
        cell.onmouseenter = null;
        cell.onmouseleave = null;
    });

    // Add new listeners
    tbody.querySelectorAll('td[data-city]').forEach(cell => {
        const cityName = cell.dataset.city;
        const dayIndex = parseInt(cell.dataset.day);
        const city = cities.find(c => c.cityName === cityName);

        if (!city || !city.future7Days || !city.future7Days[dayIndex]) return;

        let tooltipTimer = null;

        cell.addEventListener('mouseenter', (e) => {
            tooltipTimer = setTimeout(() => {
                const tooltip = showDayTooltip(city, city.future7Days[dayIndex], dayIndex);
                const rect = cell.getBoundingClientRect();
                tooltip.style.left = rect.left + rect.width / 2 - 125 + 'px';
                tooltip.style.top = rect.top - 10 + 'px';
                tooltip.classList.add('show');
            }, 200);
        });

        cell.addEventListener('mouseleave', () => {
            if (tooltipTimer) clearTimeout(tooltipTimer);
            hideDayTooltip();
        });
    });
}
```

- [ ] **Step 3: Test tooltip functionality**

Open browser, navigate to "7天预测", hover over date cells.

Expected: Tooltip appears after 200ms delay, shows correct city and day data.

- [ ] **Step 4: Commit**

```bash
git add js/ui.js
git commit -m "feat(ui): add tooltip functionality for forecast cells"
```

---

## Task 12: Implement click interactions

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: Add click handler to setupTooltipListeners()**

Extend the `setupTooltipListeners()` function to include click handling:

```javascript
function setupTooltipListeners(cities) {
    const tbody = document.getElementById('forecastTableBody');
    if (!tbody) return;

    // Tooltip and click handlers
    tbody.querySelectorAll('td[data-city]').forEach(cell => {
        const cityName = cell.dataset.city;
        const dayIndex = parseInt(cell.dataset.day);
        const city = cities.find(c => c.cityName === cityName);

        if (!city || !city.future7Days || !city.future7Days[dayIndex]) return;

        let tooltipTimer = null;

        cell.addEventListener('mouseenter', (e) => {
            tooltipTimer = setTimeout(() => {
                const tooltip = showDayTooltip(city, city.future7Days[dayIndex], dayIndex);
                const rect = cell.getBoundingClientRect();
                tooltip.style.left = rect.left + rect.width / 2 - 125 + 'px';
                tooltip.style.top = rect.top - 10 + 'px';
                tooltip.classList.add('show');
            }, 200);
        });

        cell.addEventListener('mouseleave', () => {
            if (tooltipTimer) clearTimeout(tooltipTimer);
            hideDayTooltip();
        });

        // Click handler for date cells
        cell.addEventListener('click', () => {
            const dayData = city.future7Days[dayIndex];
            const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
            const date = dayData.date;
            const dateStr = `${date.getMonth() + 1}月${date.getDate()}日`;
            const levelInfo = Core.getLevelInfo(dayData.level);

            showToast(`${cityName} ${dateStr}：ADI ${dayData.adiScore} ${levelInfo.name}`, 2000);
        });

        // Style cursor
        cell.style.cursor = 'pointer';
    });

    // City name click handler - open detail modal
    tbody.querySelectorAll('td.fixed-left:nth-child(3)').forEach((cityCell, index) => {
        cityCell.style.cursor = 'pointer';
        cityCell.addEventListener('click', () => {
            const cityName = cityCell.textContent;
            selectCity(cityName);
        });
    });

    // Level badge click handler - also open detail modal
    tbody.querySelectorAll('td.fixed-left:nth-child(4) .table-level-badge').forEach((badge, index) => {
        badge.style.cursor = 'pointer';
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const row = badge.closest('tr');
            const cityName = row.querySelector('td.fixed-left:nth-child(3)').textContent;
            selectCity(cityName);
        });
    });
}
```

- [ ] **Step 2: Test click interactions**

```javascript
// In browser console
// Click on a date cell and check for toast
// Click on city name and verify modal opens
```

Expected: Date cells show toast notification, city names open detail modal.

- [ ] **Step 3: Commit**

```bash
git add js/ui.js
git commit -m "feat(ui): add click interactions for forecast table"
```

---

## Task 13: Add clear search functionality

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: Update search handler to show clear button when filtering**

Modify the search input event handler in `initFilters()`:

```javascript
// Search input
const searchInput = document.getElementById('reportSearchInput');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        state.reportSearch = e.target.value.toLowerCase().trim();
        renderReport();

        // Show/hide clear button
        const clearBtn = document.getElementById('searchClearBtn');
        if (state.reportSearch) {
            if (!clearBtn) {
                const btn = document.createElement('button');
                btn.id = 'searchClearBtn';
                btn.className = 'search-clear-btn';
                btn.innerHTML = '×';
                btn.title = '清空搜索';
                btn.addEventListener('click', () => {
                    searchInput.value = '';
                    state.reportSearch = '';
                    renderReport();
                    btn.remove();
                });
                searchInput.parentElement.appendChild(btn);
            }
        } else if (clearBtn) {
            clearBtn.remove();
        }
    });
}
```

- [ ] **Step 2: Add clear button styles to CSS**

Add to `css/styles-v2.css`:

```css
.search-clear-btn {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    color: var(--text-secondary);
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
}

.search-clear-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: var(--text-primary);
}

.search-box {
    position: relative;
}
```

- [ ] **Step 3: Test clear search functionality**

Type in search box, verify clear button appears. Click clear button.

Expected: Search clears, button disappears, table resets to show all cities.

- [ ] **Step 4: Commit**

```bash
git add js/ui.js css/styles-v2.css
git commit -m "feat(ui): add clear search button functionality"
```

---

## Task 14: Edge case handling and validation

**Files:**
- Modify: `js/ui.js`, `js/core.js`

- [ ] **Step 1: Add safety checks for missing future7Days data**

Update renderReport() to handle cities without future7Days:

```javascript
function renderReport() {
    const thead = document.getElementById('forecastTableHead');
    const tbody = document.getElementById('forecastTableBody');
    if (!thead || !tbody || state.cityData.length === 0) return;

    // Filter out cities without future7Days data
    let cities = state.cityData.filter(c => c.future7Days && c.future7Days.length === 7);

    // ... rest of filtering logic remains same
}
```

- [ ] **Step 2: Add default values for incomplete future7Days arrays**

Update generateCityData() to ensure always returns 7 days:

```javascript
// Ensure we always have exactly 7 days
if (future7Days.length < 7) {
    console.warn(`City ${data.cityName} has incomplete future7Days data, padding with defaults`);
    while (future7Days.length < 7) {
        const lastDay = future7Days[future7Days.length - 1];
        future7Days.push({ ...lastDay, date: new Date(lastDay.date.getTime() + 86400000) });
    }
}
```

- [ ] **Step 3: Test edge cases**

```javascript
// In browser console
// Test with incomplete data
const testCity = Core.generateCityData(Core.CITIES_CONFIG[0]);
testCity.future7Days = testCity.future7Days.slice(0, 3);
console.log('Incomplete city:', testCity.future7Days.length);
```

Expected: Code handles incomplete data gracefully.

- [ ] **Step 4: Commit**

```bash
git add js/core.js js/ui.js
git commit -m "fix: add edge case handling for incomplete forecast data"
```

---

## Task 15: Performance optimization - debounce search input

**Files:**
- Modify: `js/ui.js`

- [ ] **Step 1: Add debounce utility function**

Add after escapeHtml function:

```javascript
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
```

- [ ] **Step 2: Update search handler to use debounce**

Modify the search input event listener:

```javascript
// Search input with debounce
const searchInput = document.getElementById('reportSearchInput');
if (searchInput) {
    const debouncedSearch = debounce((value) => {
        state.reportSearch = value.toLowerCase().trim();
        renderReport();
    }, 300);

    searchInput.addEventListener('input', (e) => {
        debouncedSearch(e.target.value);

        // Show/hide clear button (immediate, not debounced)
        const clearBtn = document.getElementById('searchClearBtn');
        if (e.target.value.toLowerCase().trim()) {
            if (!clearBtn) {
                const btn = document.createElement('button');
                btn.id = 'searchClearBtn';
                btn.className = 'search-clear-btn';
                btn.innerHTML = '×';
                btn.title = '清空搜索';
                btn.addEventListener('click', () => {
                    searchInput.value = '';
                    state.reportSearch = '';
                    renderReport();
                    btn.remove();
                });
                searchInput.parentElement.appendChild(btn);
            }
        } else if (clearBtn) {
            clearBtn.remove();
        }
    });
}
```

- [ ] **Step 3: Test debounce functionality**

Type quickly in search box, verify render only happens after 300ms of silence.

Expected: Render is called once after typing stops, not on every keystroke.

- [ ] **Step 4: Commit**

```bash
git add js/ui.js
git commit -m "perf(ui): add debounce to search input"
```

---

## Task 16: Final verification and testing

**Files:**
- All modified files

- [ ] **Step 1: Manual testing checklist**

Open `index-v2.html` and verify:

1. **Page loads correctly**
   - Navigate to "7天预测"
   - Table displays with 86 cities
   - 9 fixed columns on left
   - 7 date columns on right

2. **Dimension switching**
   - Click "高低温度" - shows high/low temps
   - Click "高低体感温度" - shows feels-like temps
   - Click "ADI指数" - shows ADI with colored backgrounds
   - All dimensions switch smoothly

3. **Filter functionality**
   - Click "爆发级" - shows only outbreak cities
   - Click "华东" - shows only East China cities
   - Click "全部" - shows all cities

4. **Search functionality**
   - Type "北京" - table filters to Beijing
   - Clear search - table resets
   - Clear button appears/disappears correctly

5. **Tooltip**
   - Hover over date cell - tooltip appears
   - Tooltip shows correct data
   - Tooltip hides on mouse leave

6. **Click interactions**
   - Click date cell - toast notification
   - Click city name - detail modal opens
   - Click level badge - detail modal opens

7. **Sticky columns and header**
   - Scroll horizontally - fixed columns stay
   - Scroll vertically - header stays
   - Hover effects work

8. **Responsive behavior**
   - Window resize - table adapts

- [ ] **Step 2: Cross-browser testing**

Test in:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (if on Mac)

- [ ] **Step 3: Console error check**

Open DevTools Console, verify no errors or warnings.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete 7-day forecast page redesign

- Add future7Days array to city data model
- Implement three dimension view modes (temperature, feels-like, ADI)
- Add search and filter functionality
- Implement tooltip and click interactions
- Add sticky table columns and header
- Handle edge cases and optimize performance

Closes spec: docs/superpowers/specs/2025-05-11-7day-forecast-redesign.md
"
```

---

## Verification Summary

After completing all tasks, the following features should be working:

✅ Data model extended with `future7Days` array (7 days of daily forecast data)
✅ Three dimension view modes with different display formats
✅ Dimension switching via toggle buttons
✅ Search functionality with debounced input
✅ Filter buttons (level-based and region-based)
✅ Table with 9 fixed left columns and 7 scrollable date columns
✅ Sticky header and sticky left columns
✅ Tooltip on hover showing detailed daily data
✅ Click interactions (toast for date cells, modal for cities)
✅ Clear search button
✅ Empty state when no results found
✅ Edge case handling for incomplete data
✅ Performance optimizations (debounced search)
✅ Consistent styling with existing design

---

**Plan created:** 2026-05-11
**Design document:** `docs/superpowers/specs/2025-05-11-7day-forecast-redesign.md`
**Estimated completion time:** 3-4 hours for all 16 tasks
