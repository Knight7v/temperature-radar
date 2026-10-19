/**
 * Core Module - 空调热销区域雷达 核心业务逻辑
 * ADI 空调天气需求指数模型
 */

const Core = (function() {
    'use strict';

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

    // 立即清理旧版本缓存
    const CACHE_VERSION = 'v2'; // 缓存版本号，数据结构变化时更新

    // ==================== 工具函数 ====================

    // 清理旧版本的天气缓存
    function clearOldWeatherCache() {
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('weather_cache_') && !key.includes(`_${CACHE_VERSION}_`)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            if (keysToRemove.length > 0) {
                console.log(`清理了 ${keysToRemove.length} 个旧版本缓存`);
            }
        } catch (e) {
            console.warn('清理旧缓存失败:', e);
        }
    }

    // 立即执行清理
    clearOldWeatherCache();

    // ==================== 和风天气API调用 ====================

    /**
     * 从和风天气API获取7天天气预报数据
     * @param {Object} city - 城市对象，包含 lat 和 lng 属性
     * @returns {Promise<Object|null>} 返回API数据，失败返回null
     */
    async function fetchWeatherData(city) {
        const cacheKey = `weather_cache_${CACHE_VERSION}_${city.name}`;
        const now = Date.now();
        const today = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

        // 检查缓存
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (now - timestamp < QWEATHER_CONFIG.cacheDuration && data.daily?.[0]?.fxDate === today) {
                    return data;
                }
            }
        } catch (e) {
            console.warn('缓存读取失败:', e);
        }

        // 调用 /api/weather 代理(key 在服务端 env)
        const location = `${city.lng.toFixed(2)},${city.lat.toFixed(2)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), QWEATHER_CONFIG.requestTimeout);
        try {
            const response = await fetch(`/api/weather?location=${encodeURIComponent(location)}`, {
                signal: controller.signal,
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            if (result.code !== '200') throw new Error(`API错误: ${result.code}`);
            if (result.daily?.[0]?.fxDate !== today) throw new Error('预报日期不是今天');

            // 保存到缓存
            try {
                localStorage.setItem(cacheKey, JSON.stringify({ data: result, timestamp: now }));
            } catch (e) {
                console.warn('缓存保存失败:', e);
            }

            return result;
        } catch (error) {
            console.error(`获取 ${city.name} 天气数据失败:`, error);
            return null;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // ==================== 和风天气API配置 ====================
    // key 已迁服务端 env (QWEATHER_API_KEY);baseUrl 已在 api/utils/qweather.js。
    // 前端只保留请求超时与 localStorage 缓存时长。
    const QWEATHER_CONFIG = {
        requestTimeout: 10000,              // /api/weather 请求超时
        cacheDuration: 6 * 60 * 60 * 1000   // 6 小时 localStorage 缓存
    };

    // ==================== 每日简报 ====================

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
        else if (stats.action >= 8) coreReason = '多城市达到行动级，需求明显增强';
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
                <div class="brief-update-time">更新时间: ${escapeHtml(updateTime)}</div>
                <div class="brief-section">
                    <div class="brief-section-title">【整体判断】</div>
                    <div class="brief-section-content">今日空调销售机会${escapeHtml(intensity)}。</div>
                </div>
                <div class="brief-section">
                    <div class="brief-section-title">【重点大区】</div>
                    <div class="brief-section-content">${activeRegions.map(([name, stats]) => escapeHtml(name) + '（' + escapeHtml(stats.level) + '）').join('、') || '暂无明显机会区域'}</div>
                </div>
                <div class="brief-section">
                    <div class="brief-section-title">【重点城市】</div>
                    <div class="brief-section-content">${topCities.map(escapeHtml).join('、') || '暂无'}</div>
                </div>
                <div class="brief-section">
                    <div class="brief-section-title">【未来升温城市】</div>
                    <div class="brief-section-content">${risingCities.map(escapeHtml).join('、') || '暂无明显升温趋势'}</div>
                </div>
                <div class="brief-section">
                    <div class="brief-section-title">【判断依据】</div>
                    <div class="brief-section-content">${escapeHtml(coreReason)}。未来3天${risingCities.length > 0 ? risingCities.map(escapeHtml).join('、') + '等城市' : ''}ADI${risingCities.length > 0 ? '上升明显' : ''}。</div>
                </div>
            `
            };
        } else {
            // 运营详细版
            return {
                updateTime,
                intensity,
                content: `
                <div class="brief-update-time">更新时间: ${escapeHtml(updateTime)}</div>
                <div class="brief-section">
                    <div class="brief-section-title">【今日销售机会强度】</div>
                    <div class="brief-section-content">${escapeHtml(intensity)}（爆发级${escapeHtml(String(stats.outbreak))}个，行动级${escapeHtml(String(stats.action))}个，机会级${escapeHtml(String(stats.opportunity))}个）</div>
                </div>
                <div class="brief-section">
                    <div class="brief-section-title">【大区详情】</div>
                    <div class="brief-section-content">
                        ${activeRegions.map(([name, stats]) => {
                            return escapeHtml(name) + '（' + escapeHtml(stats.level) + '）：爆发级' + escapeHtml(String(stats.explosiveCount)) + '个，行动级' + escapeHtml(String(stats.actionCount)) + '个，代表城市：' + stats.representativeCities.slice(0, 2).map(escapeHtml).join('、');
                        }).join('<br>') || '暂无明显机会区域'}
                    </div>
                </div>
                <div class="brief-section">
                    <div class="brief-section-title">【重点城市TOP5】</div>
                    <div class="brief-section-content">
                        ${topCities.map((cityName, i) => {
                            const city = cityDataList.find(c => c.cityName === cityName);
                            const info = getLevelInfo(city.level);
                            return (i + 1) + '. ' + escapeHtml(cityName) + '（' + escapeHtml(info.name) + '，ADI ' + escapeHtml(String(city.adiScore)) + '）';
                        }).join('<br>')}
                    </div>
                </div>
                <div class="brief-section">
                    <div class="brief-section-title">【升温趋势城市】</div>
                    <div class="brief-section-content">
                        ${risingCities.map((cityName, i) => {
                            const city = cityDataList.find(c => c.cityName === cityName);
                            const futureAdi = city.future7AdiScores[2] || city.adiScore;
                            return (i + 1) + '. ' + escapeHtml(cityName) + '：今日ADI ' + escapeHtml(String(city.adiScore)) + ' → 未来3天 ' + escapeHtml(String(futureAdi));
                        }).join('<br>') || '暂无明显升温趋势'}
                    </div>
                </div>
                <div class="brief-section">
                    <div class="brief-section-title">【夜间闷热情况】</div>
                    <div class="brief-section-content">热夜城市${escapeHtml(String(hotNightCities.length))}个，${escapeHtml(coreReason)}</div>
                </div>
            `
            };
        }
    }

    // 仅使用天气接口返回的预报。失败城市由调用方单独提示，不参与统计。
    async function generateCityData(city) {
        const apiData = await fetchWeatherData(city);
        const parsedData = apiData && parseWeatherData(apiData, city);
        return parsedData ? assembleCityData(parsedData) : null;
    }

    async function generateAllCityData() {
        const cityData = [];
        const failedCities = [];
        const batchSize = 10;

        for (let i = 0; i < CITIES_CONFIG.length; i += batchSize) {
            const batch = CITIES_CONFIG.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(city => generateCityData(city)));
            batchResults.forEach((data, index) => {
                if (data) cityData.push(data);
                else failedCities.push(batch[index].name);
            });
        }

        return { cityData, failedCities };
    }

    // 降水监控辅助函数
    function getTopRainInsurance(cityDataList, n) {
        return window.RainMonitor ? window.RainMonitor.getTopInsuranceCities(cityDataList, n || 10) : [];
    }

    function getTopPostRainMuggy(cityDataList, n) {
        return window.RainMonitor ? window.RainMonitor.getTopPostRainMuggyCities(cityDataList, n || 10) : [];
    }

    function summarizeRainInsurance(cityDataList) {
        return window.RainMonitor ? window.RainMonitor.summarizeRainInsurance(cityDataList) : { strongCount: 0, remindCount: 0, topRecords: [] };
    }

    function summarizePostRainMuggy(cityDataList) {
        return window.RainMonitor ? window.RainMonitor.summarizePostRainMuggy(cityDataList) : { highCount: 0, mediumCount: 0, watchCount: 0, topRecords: [] };
    }

    // ==================== 工具函数 ====================

    function escapeHtml(str) {
        if (typeof str !== 'string') return str;
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ==================== 公开 API ====================

    return {
        ADI_CONFIG,
        QWEATHER_CONFIG,
        LEVELS,
        LEVEL_ORDER,
        CITIES_CONFIG,
        CITY_GROUPS,

        fetchWeatherData,
        parseWeatherData,
        calculateADI,
        determineLevel,
        calculateNightMuggyScore,
        isHotNight,
        generateCityData,
        generateAllCityData,
        generateShortReason,
        calculateLevelTrend,
        calculateSalesIntensity,
        calculateRegionStats,
        generateDailyBrief,

        getLevelStats,
        getHotNightCities,
        getLongestHotNight,
        getTopByADI,
        getTopNightMuggy,
        getTopHeatRise,
        getTopRainInsurance,
        getTopPostRainMuggy,
        summarizeRainInsurance,
        summarizePostRainMuggy,
        getCitiesByLevel,

        getLevelInfo,
        getLevelOrder
    };

})();
