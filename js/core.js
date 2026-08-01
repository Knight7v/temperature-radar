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

    function biasedRandom(power) {
        return Math.pow(Math.random(), power);
    }

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

    // ==================== 和风天气API配置 ====================

    const QWEATHER_CONFIG = {
        apiKey: 'c7d384b2fa484e558b11e316ca4bb161',
        baseUrl: 'https://m96x89njb8.re.qweatherapi.com/v7/weather/7d',
        requestTimeout: 10000,  // 10秒超时
        cacheDuration: 6 * 60 * 60 * 1000  // 6小时缓存（毫秒）
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

    // ==================== 数据生成（优化分布）====================

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

        // 模拟降水天气（确定性随机）
        const rainRoll = Math.random();
        let weatherTextDay = '晴';
        let weatherTextNight = '多云';
        let precip = 0;
        if (rainRoll > 0.86) {
            weatherTextDay = '中雨';
            weatherTextNight = '小雨';
            precip = Math.round((10 + Math.random() * 18) * 10) / 10;
        } else if (rainRoll > 0.68) {
            weatherTextDay = '小雨';
            weatherTextNight = '阴';
            precip = Math.round((0.5 + Math.random() * 5) * 10) / 10;
        }

        return {
            date: date,
            dayMax: dayMax,
            nightMin: dayNight,
            dayFeelsLike: dayFeelsLike,
            nightFeelsLike: Math.round(dayNight + (dayHumidity - 50) * 0.08),
            humidity: dayHumidity,
            adiScore: adiResult.adiScore,
            level: levelResult.level,
            isHotNight: dayNight >= 28,
            weatherTextDay,
            weatherTextNight,
            weatherText: [weatherTextDay, weatherTextNight].filter(Boolean).join(' / '),
            precip
        };
    }

    async function generateCityData(city) {
        // 尝试从和风天气API获取数据
        const apiData = await fetchWeatherData(city);

        if (apiData) {
            const parsedData = parseWeatherData(apiData, city);
            if (parsedData) {
                return assembleCityData(parsedData);
            }
        }

        // API失败时使用模拟数据作为降级方案
        console.warn(`API获取失败，使用模拟数据: ${city.name}`);

        // API失败后继续使用原有的模拟数据生成逻辑
        let maxTemp;
        const cool = biasedRandom(2.5); // Biased for cool regions

        switch (city.region) {
            case '华南':
                maxTemp = Math.round(30 + Math.random() * 8);  // 30-38, uniform
                break;
            case '华东':
                maxTemp = Math.round(28 + Math.random() * 8);  // 28-36, uniform
                break;
            case '华中':
                maxTemp = Math.round(28 + Math.random() * 8);  // 28-36, uniform
                break;
            case '华北':
                maxTemp = Math.round(25 + cool * 8);            // 25-33, biased cool
                break;
            case '西南':
                maxTemp = Math.round(22 + cool * 10);           // 22-32, biased cool
                break;
            default:
                maxTemp = Math.round(18 + cool * 10);           // 18-28, biased cool
        }

        // Night: 4-7 degrees below max (smaller drop → more warm nights → more mid-range ADI)
        const nightDrop = 4 + Math.random() * 3;
        const nightMinTemp = Math.round(maxTemp - nightDrop);
        const humidity = Math.round(40 + Math.random() * 50);
        const feelsLike = Math.round(maxTemp + Math.max(0, (humidity - 55) * 0.06) + Math.random() * 1.5);

        let continuousHotNightDays = 0;
        if (nightMinTemp >= 28) {
            continuousHotNightDays = Math.ceil(biasedRandom(2) * 5);
        } else if (nightMinTemp >= 26) {
            continuousHotNightDays = Math.random() > 0.6 ? Math.ceil(Math.random() * 3) : 0;
        } else if (nightMinTemp >= 24) {
            continuousHotNightDays = Math.random() > 0.85 ? 1 : 0;
        }

        // 未来3天温度
        const future3DayMaxTemps = [];
        const future3NightMinTemps = [];
        for (let i = 0; i < 3; i++) {
            const warmBias = (i + 1) * 0.3;
            const fMax = Math.round(maxTemp + (Math.random() - 0.35) * 5 + warmBias);
            const fNight = Math.round(nightMinTemp + (Math.random() - 0.35) * 4 + warmBias);
            future3DayMaxTemps.push(Math.max(fMax, 15));
            future3NightMinTemps.push(Math.max(fNight, 10));
        }

        // 未来7天ADI趋势
        const future7AdiScores = [];
        for (let i = 0; i < 7; i++) {
            const warmBias = (i + 1) * 0.4;
            const dayMax = Math.max(15, Math.round(maxTemp + (Math.random() - 0.35) * 5 + warmBias));
            const dayNight = Math.max(10, Math.round(nightMinTemp + (Math.random() - 0.35) * 4 + warmBias));
            const dayHumidity = Math.max(30, Math.min(100, Math.round(humidity + (Math.random() - 0.5) * 10)));
            const dayFeels = Math.round(dayMax + Math.max(0, (dayHumidity - 55) * 0.08) + Math.random());
            let dayCont;
            if (i === 0) {
                dayCont = continuousHotNightDays;
            } else {
                dayCont = dayNight >= 28
                    ? Math.min(continuousHotNightDays + Math.ceil(Math.random() * 2), 7)
                    : Math.max(0, continuousHotNightDays - Math.floor(Math.random() * 2));
            }

            const dayData = {
                maxTemp: dayMax, nightMinTemp: dayNight,
                feelsLike: dayFeels, humidity: dayHumidity,
                continuousHotNightDays: dayCont
            };
            future7AdiScores.push(calculateADI(dayData).adiScore);
        }

        const data = {
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

        data.nightMuggyScore = calculateNightMuggyScore(data);

        // 计算 ADI
        const adiResult = calculateADI(data);
        const levelResult = determineLevel(adiResult.adiScore, data);
        const reason = generateReason(data, adiResult.adiScore, levelResult.level, levelResult.triggeredRules);
        const shortReason = generateShortReason(data, levelResult.level, levelResult.triggeredRules);
        const levelTrend = calculateLevelTrend(levelResult.level, future7AdiScores);

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

        // 使用RainMonitor丰富降水数据
        const enrichedFuture7Days = window.RainMonitor
            ? window.RainMonitor.enrichFuture7Days(future7Days)
            : future7Days;
        const maxRainInsuranceLevel = window.RainMonitor
            ? window.RainMonitor.getMaxRainInsuranceLevel(enrichedFuture7Days)
            : 'none';
        const maxPostRainMuggyLevel = window.RainMonitor
            ? window.RainMonitor.getMaxPostRainMuggyLevel(enrichedFuture7Days)
            : 'none';
        const maxPostRainMuggyScore = enrichedFuture7Days.reduce((max, day) => Math.max(max, day.postRainMuggyScore || 0), 0);

        // 返回模拟数据（API失败后的降级方案）
        return {
            ...data,
            adiScore: adiResult.adiScore,
            adiBreakdown: adiResult.breakdown,
            level: levelResult.level,
            triggeredRules: levelResult.triggeredRules,
            reason,
            shortReason,
            levelTrend,
            future7Days: enrichedFuture7Days,
            maxRainInsuranceLevel,
            maxPostRainMuggyLevel,
            maxPostRainMuggyScore
        };
    }

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
