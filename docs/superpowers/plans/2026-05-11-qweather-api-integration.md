# 和风天气API集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 集成和风天气7天预报API，替换模拟天气数据，实现每6小时自动刷新

**Architecture:** 在 core.js 中添加 API 调用函数，修改数据生成逻辑从 API 获取真实数据；在 app.js 中添加定时刷新和加载状态处理；前端添加加载提示和错误处理UI。

**Tech Stack:** 和风天气免费版API (devapi.qweather.com), Fetch API, LocalStorage (缓存)

---

## 文件结构

**创建文件:**
- 无

**修改文件:**
- `js/core.js` - 添加 QWeather API 配置、fetchWeatherData() 函数、修改 generateCityData() 和 generateAllCityData() 为异步
- `js/app.js` - 修改 init() 支持异步、添加6小时定时刷新、添加加载状态管理
- `index-v2.html` - 添加加载状态提示容器和错误提示容器
- `css/styles-v2.css` - 添加加载动画和错误提示样式

---

### Task 1: 在 core.js 中添加 QWeather API 配置常量

**Files:**
- Modify: `js/core.js:63-67` (在 CITIES_CONFIG 定义之前插入)

- [ ] **Step 1: 添加 QWeather API 配置常量**

在 `// ==================== 城市配置 ====================` 注释之前添加以下代码：

```javascript
    // ==================== 和风天气API配置 ====================

    const QWEATHER_CONFIG = {
        apiKey: 'c7d384b2fa484e558b11e316ca4bb161',
        baseUrl: 'https://devapi.qweather.com/v7/weather/7d',
        requestTimeout: 10000,  // 10秒超时
        cacheDuration: 6 * 60 * 60 * 1000  // 6小时缓存（毫秒）
    };
```

保存文件，确保语法正确。

---

### Task 2: 在 core.js 中添加 fetchWeatherData() 函数

**Files:**
- Modify: `js/core.js:199` (在 LEVEL_ORDER 定义之后，城市配置之前)

- [ ] **Step 1: 实现 fetchWeatherData() 函数**

在 `LEVEL_ORDER` 定义之后添加以下函数：

```javascript
    // ==================== 和风天气API调用 ====================

    /**
     * 从和风天气API获取7天天气预报数据
     * @param {Object} city - 城市对象，包含 lat 和 lng 属性
     * @returns {Promise<Object|null>} 返回API数据，失败返回null
     */
    async function fetchWeatherData(city) {
        const cacheKey = `weather_cache_${city.name}`;
        const now = Date.now();

        // 检查缓存
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (now - timestamp < QWEATHER_CONFIG.cacheDuration) {
                    console.log(`使用缓存数据: ${city.name}`);
                    return data;
                }
            }
        } catch (e) {
            console.warn('缓存读取失败:', e);
        }

        // 调用API
        const location = `${city.lng.toFixed(2)},${city.lat.toFixed(2)}`;
        const url = `${QWEATHER_CONFIG.baseUrl}?location=${encodeURIComponent(location)}&key=${QWEATHER_CONFIG.apiKey}`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), QWEATHER_CONFIG.requestTimeout);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.code !== '200') {
                throw new Error(`API错误: ${result.code}`);
            }

            // 保存到缓存
            try {
                localStorage.setItem(cacheKey, JSON.stringify({
                    data: result,
                    timestamp: now
                }));
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

保存文件。

---

### Task 3: 在 core.js 中添加 parseWeatherData() 函数

**Files:**
- Modify: `js/core.js` (在 fetchWeatherData() 函数之后)

- [ ] **Step 1: 实现 parseWeatherData() 函数**

在 fetchWeatherData() 函数之后添加以下函数：

```javascript
    /**
     * 将和风天气API数据转换为现有数据结构
     * @param {Object} apiData - 和风API返回的数据
     * @param {Object} city - 城市对象
     * @returns {Object} 转换后的城市数据
     */
    function parseWeatherData(apiData, city) {
        if (!apiData || !apiData.daily || apiData.daily.length === 0) {
            return null;
        }

        const today = apiData.daily[0];

        // 今天的数据
        const maxTemp = parseInt(today.tempMax, 10);
        const nightMinTemp = parseInt(today.tempMin, 10);
        const humidity = parseInt(today.humidity, 10);

        // 体感温度：最高温 + 湿度影响
        const feelsLike = Math.round(maxTemp + Math.max(0, (humidity - 55) * 0.06));

        // 计算连续高温夜天数
        let continuousHotNightDays = 0;
        for (let i = 0; i < Math.min(7, apiData.daily.length); i++) {
            const dayMin = parseInt(apiData.daily[i].tempMin, 10);
            if (dayMin >= 28) {
                continuousHotNightDays++;
            } else if (dayMin >= 26 && continuousHotNightDays > 0) {
                // 26度以上连续天数可以累加，但28度以上是强信号
                continuousHotNightDays++;
            } else {
                break;
            }
        }

        // 未来3天温度
        const future3DayMaxTemps = [];
        const future3NightMinTemps = [];
        for (let i = 1; i < Math.min(4, apiData.daily.length); i++) {
            future3DayMaxTemps.push(parseInt(apiData.daily[i].tempMax, 10));
            future3NightMinTemps.push(parseInt(apiData.daily[i].tempMin, 10));
        }

        // 未来7天ADI趋势
        const future7AdiScores = [];
        for (let i = 0; i < Math.min(7, apiData.daily.length); i++) {
            const day = apiData.daily[i];
            const dayMax = parseInt(day.tempMax, 10);
            const dayNight = parseInt(day.tempMin, 10);
            const dayHumidity = parseInt(day.humidity, 10);
            const dayFeels = Math.round(dayMax + Math.max(0, (dayHumidity - 55) * 0.08));

            const dayCont = (dayNight >= 28) ? continuousHotNightDays : 0;

            const dayData = {
                maxTemp: dayMax,
                nightMinTemp: dayNight,
                feelsLike: dayFeels,
                humidity: dayHumidity,
                continuousHotNightDays: dayCont
            };
            future7AdiScores.push(calculateADI(dayData).adiScore);
        }

        return {
            cityName: city.name,
            region: city.region,
            province: city.province,
            lat: city.lat,
            lng: city.lng,
            maxTemp,
            nightMinTemp,
            feelsLike,
            humidity,
            continuousHotNightDays,
            future3DayMaxTemps,
            future3NightMinTemps,
            future7AdiScores,
            nightMuggyScore: 0,
            updatedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
        };
    }
```

保存文件。

---

### Task 4: 修改 core.js 中的 generateCityData() 为异步函数

**Files:**
- Modify: `js/core.js:673-770` (generateCityData 函数)

- [ ] **Step 1: 修改 generateCityData() 函数签名为异步**

将函数定义从：
```javascript
    function generateCityData(city) {
```
改为：
```javascript
    async function generateCityData(city) {
```

- [ ] **Step 2: 修改 generateCityData() 函数体使用API数据**

替换整个函数体（从函数开头到 `return nightMuggyScore;` 之前）为：

```javascript
        // 尝试从和风天气API获取数据
        const apiData = await fetchWeatherData(city);

        if (apiData) {
            const parsedData = parseWeatherData(apiData, city);
            if (parsedData) {
                parsedData.nightMuggyScore = calculateNightMuggyScore(parsedData);
                const adiResult = calculateADI(parsedData);
                parsedData.adiScore = adiResult.adiScore;
                parsedData.level = adiResult.level;
                return parsedData;
            }
        }

        // API失败时使用模拟数据作为降级方案
        console.warn(`API获取失败，使用模拟数据: ${city.name}`);
```

然后在函数末尾的 `return nightMuggyScore;` 之前添加：

```javascript
        // API失败后继续使用原有的模拟数据生成逻辑
```

保持原有的模拟数据生成代码不变。

- [ ] **Step 3: 验证修改**

搜索 `Core.generateCityData`，确认此函数在 core.js 末尾的 return 语句中已导出。

---

### Task 5: 修改 core.js 中的 generateAllCityData() 为异步函数

**Files:**
- Modify: `js/core.js` (generateAllCityData 函数)

- [ ] **Step 1: 查找 generateAllCityData() 函数**

搜索 `function generateAllCityData()` 确认其位置（大约在 generateCityData 之后）。

- [ ] **Step 2: 修改函数签名和调用逻辑**

将函数从：
```javascript
    function generateAllCityData() {
        return CITIES_CONFIG.map(city => generateCityData(city));
    }
```
改为：
```javascript
    async function generateAllCityData() {
        const results = [];
        const batchSize = 10;  // 每批处理10个城市，避免过多并发请求

        for (let i = 0; i < CITIES_CONFIG.length; i += batchSize) {
            const batch = CITIES_CONFIG.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(city => generateCityData(city))
            );
            results.push(...batchResults);
        }

        return results;
    }
```

- [ ] **Step 3: 验证修改**

搜索 `Core.generateAllCityData`，确认此函数在 core.js 末尾的 return 语句中已导出。

---

### Task 6: 修改 app.js 的 init() 支持异步数据加载

**Files:**
- Modify: `js/app.js:31-52` (init 函数)

- [ ] **Step 1: 修改 init() 函数为异步**

将：
```javascript
    async function init() {
```
保持不变（已经是 async），但修改函数体中的 refreshData() 调用。

- [ ] **Step 2: 修改 refreshData() 调用为 await**

将：
```javascript
            refreshData();
```
改为：
```javascript
            await refreshData();
```

---

### Task 7: 修改 app.js 的 refreshData() 为异步函数

**Files:**
- Modify: `js/app.js:54-65` (refreshData 函数)

- [ ] **Step 1: 修改 refreshData() 为异步函数**

将：
```javascript
    function refreshData() {
        const cityData = Core.generateAllCityData();
```
改为：
```javascript
    async function refreshData() {
        const cityData = await Core.generateAllCityData();
```

- [ ] **Step 2: 添加加载状态管理**

在函数开头添加加载状态设置：

```javascript
    async function refreshData() {
        // 设置加载状态
        const loadingEl = document.getElementById('apiLoadingStatus');
        const errorEl = document.getElementById('apiErrorMessage');
        if (loadingEl) loadingEl.style.display = 'flex';
        if (errorEl) errorEl.style.display = 'none';

        try {
            const cityData = await Core.generateAllCityData();
            AppState.cityData = cityData;
            AppState.lastUpdateTime = new Date();
            UI.renderDashboard(cityData);

            // 手动触发地图渲染事件
            if (typeof CustomEvent !== 'undefined') {
                const event = new CustomEvent('cityDataLoaded', { detail: { cityData: cityData } });
                window.dispatchEvent(event);
            }

            // 更新加载成功提示
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }

        } catch (error) {
            console.error('数据加载失败:', error);
            // 显示错误提示
            if (errorEl) {
                errorEl.textContent = `数据加载失败: ${error.message}`;
                errorEl.style.display = 'block';
            }
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        }
```

---

### Task 8: 在 app.js 中添加6小时定时刷新机制

**Files:**
- Modify: `js/app.js:45` (setInterval 行)

- [ ] **Step 1: 修改刷新间隔从1分钟改为6小时**

将：
```javascript
            setInterval(refreshData, 60000);
```
改为：
```javascript
            setInterval(refreshData, 6 * 60 * 60 * 1000);  // 6小时刷新
```

- [ ] **Step 2: 添加刷新定时器引用到 AppState**

在 AppState 对象中添加 refreshTimer 属性：

将：
```javascript
    const AppState = {
        initialized: false,
        cityData: [],
        lastUpdateTime: null
    };
```
改为：
```javascript
    const AppState = {
        initialized: false,
        cityData: [],
        lastUpdateTime: null,
        refreshTimer: null
    };
```

- [ ] **Step 3: 保存定时器引用**

将 setInterval 调用修改为：
```javascript
            AppState.refreshTimer = setInterval(refreshData, 6 * 60 * 60 * 1000);  // 6小时刷新
```

---

### Task 9: 在 index-v2.html 中添加加载状态提示容器

**Files:**
- Modify: `index-v2.html` (在 loadingScreen 之后添加)

- [ ] **Step 1: 在 body 标签内、loadingScreen 之后添加加载状态容器**

搜索 `<div id="loadingScreen"`，在其结束的 `</div>` 之后添加：

```html
    <!-- API加载状态提示 -->
    <div id="apiLoadingStatus" style="display: none;">
        <div class="api-loading-backdrop"></div>
        <div class="api-loading-container">
            <div class="api-loading-spinner"></div>
            <div class="api-loading-text">正在获取天气数据...</div>
            <div class="api-loading-subtext">首次加载可能需要较长时间</div>
        </div>
    </div>

    <!-- API错误提示 -->
    <div id="apiErrorMessage" style="display: none;"></div>
```

---

### Task 10: 在 styles-v2.css 中添加加载动画样式

**Files:**
- Modify: `css/styles-v2.css` (在文件末尾添加)

- [ ] **Step 1: 添加 API 加载状态样式**

在文件末尾添加：

```css
/* ==================== API加载状态样式 ==================== */

.api-loading-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.3);
    z-index: 9998;
}

.api-loading-container {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    border-radius: 12px;
    padding: 40px 60px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
    z-index: 9999;
    text-align: center;
    min-width: 300px;
}

.api-loading-spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 20px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #3498db;
    border-radius: 50%;
    animation: api-spin 1s linear infinite;
}

@keyframes api-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.api-loading-text {
    font-size: 18px;
    font-weight: 600;
    color: #2c3e50;
    margin-bottom: 8px;
}

.api-loading-subtext {
    font-size: 14px;
    color: #7f8c8d;
}

/* ==================== API错误提示样式 ==================== */

#apiErrorMessage {
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #e74c3c;
    color: white;
    padding: 16px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    font-size: 14px;
    max-width: 400px;
    text-align: center;
}
```

---

### Task 11: 测试API集成功能

**Files:**
- Test: 打开浏览器访问 `index-v2.html`

- [ ] **Step 1: 在浏览器中打开页面**

打开 `index-v2.html` 文件，观察：
1. 初始加载时是否显示"正在获取天气数据..."提示
2. 控制台是否有API调用日志
3. 页面是否正常渲染天气数据

- [ ] **Step 2: 检查浏览器控制台**

打开浏览器开发者工具(F12)，检查：
1. Console 标签页是否有API请求日志
2. Network 标签页是否有对 `devapi.qweather.com` 的请求
3. 是否有任何错误信息

- [ ] **Step 3: 验证缓存机制**

1. 刷新页面，观察控制台是否有"使用缓存数据"日志
2. 检查 LocalStorage 中是否有 `weather_cache_` 开头的键值对

- [ ] **Step 4: 测试错误处理**

1. 临时修改 API key 为无效值，观察错误提示是否显示
2. 恢复正确 API key，确认数据恢复正常

- [ ] **Step 5: 验证6小时刷新**

1. 修改 `js/app.js` 中的刷新间隔为较短时间（如10秒）进行测试
2. 观察定时刷新是否正常工作
3. 测试完成后恢复为6小时

---

### Task 12: 添加最后更新时间显示

**Files:**
- Modify: `index-v2.html` (在 header-stats 区域添加)

- [ ] **Step 1: 查找 header-stats 区域**

搜索 `<div class="header-stats">`，确认其位置和结构。

- [ ] **Step 2: 在最后一个 stat-item 之后添加更新时间**

在 header-stats 的最后一个 stat-item 之后添加：

```html
                    <div class="stat-item">
                        <div class="stat-label">数据更新</div>
                        <div class="stat-value" id="lastUpdateTime">--:--</div>
                    </div>
```

---

### Task 13: 在 ui.js 中添加更新时间显示逻辑

**Files:**
- Modify: `js/ui.js` (在 updateHeaderStats 函数中添加)

- [ ] **Step 1: 查找 updateHeaderStats() 函数**

搜索 `function updateHeaderStats`，确认其位置。

- [ ] **Step 2: 在函数末尾添加更新时间显示**

在 updateHeaderStats() 函数的末尾添加：

```javascript
        // 更新数据更新时间
        const lastUpdateEl = document.getElementById('lastUpdateTime');
        if (lastUpdateEl && App.state.lastUpdateTime) {
            const time = App.state.lastUpdateTime;
            const hours = String(time.getHours()).padStart(2, '0');
            const minutes = String(time.getMinutes()).padStart(2, '0');
            lastUpdateEl.textContent = `${hours}:${minutes}`;
        }
```

---

## 验证清单

完成所有任务后，验证以下功能：

- [ ] 页面加载时显示加载提示
- [ ] 数据正常从和风天气API获取
- [ ] 缓存机制正常工作（第二次打开页面使用缓存）
- [ ] API失败时显示错误提示
- [ ] 页面正常显示所有131个城市的数据
- [ ] ADI计算和等级判断功能正常
- [ ] 地图可视化正常工作
- [ ] 每6小时自动刷新数据（测试时改为短时间验证）
- [ ] 显示最后更新时间

---

## 注意事项

1. **API配额**: 免费版每天1000次调用，当前设计使用524次/天，有充足余量
2. **缓存策略**: 6小时缓存减少不必要的API调用
3. **降级方案**: API失败时自动使用模拟数据
4. **批量请求**: 每批10个城市，避免过多并发请求
5. **超时处理**: 10秒超时防止长时间等待
