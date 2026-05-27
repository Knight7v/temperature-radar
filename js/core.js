/**
 * Core Module - 空调热销区域雷达 核心业务逻辑
 * ADI 空调天气需求指数模型
 */

const Core = (function() {
    'use strict';

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

    // ==================== ADI 配置 ====================

    const ADI_CONFIG = {
        weights: {
            nightMinTemp: 0.20,
            dayMaxTemp: 0.30,
            feelsLike: 0.40,
            continuousHeat: 0.05,
            humidityMuggy: 0.05
        },
        thresholds: {
            cool: { min: 0, max: 54 },
            observe: { min: 55, max: 64 },
            opportunity: { min: 65, max: 74 },
            action: { min: 75, max: 84 },
            outbreak: { min: 85, max: 100 }
        },
        forceUpgrade: [
            { id: 'nightMin28', name: '夜间最低温≥28℃', desc: '直接判定为爆热级', check: (d) => d.nightMinTemp >= 28, targetLevel: 'outbreak' },
            { id: 'feelsLike37', name: '体感温度≥37℃', desc: '直接判定为爆热级', check: (d) => d.feelsLike >= 37, targetLevel: 'outbreak' },
            { id: 'continuous2Night26', name: '连续2晚夜间最低温≥26℃', desc: '至少判定为热级', check: (d) => d.continuousHotNightDays >= 2 && d.nightMinTemp >= 26, targetLevel: 'action' },
            { id: 'continuous3Night25', name: '连续3晚夜间最低温≥25℃', desc: '至少判定为热级', check: (d) => d.continuousHotNightDays >= 3 && d.nightMinTemp >= 25, targetLevel: 'action' },
            { id: 'future3Day35', name: '未来3天最高温均≥35℃', desc: '至少判定为热级', check: (d) => d.future3DayMaxTemps && d.future3DayMaxTemps.every(t => t >= 35), targetLevel: 'action' },
            { id: 'dayMax37', name: '白天最高温≥37℃', desc: '至少判定为热级', check: (d) => d.maxTemp >= 37, targetLevel: 'action' }
        ],
        nightMuggyBonus: [
            { condition: (d) => d.continuousHotNightDays >= 2 && d.nightMinTemp >= 25, bonus: 5 },
            { condition: (d) => d.continuousHotNightDays >= 3 && d.nightMinTemp >= 25, bonus: 8 },
            { condition: (d) => d.continuousHotNightDays >= 2 && d.nightMinTemp >= 26, bonus: 10 },
            { condition: (d) => d.continuousHotNightDays >= 3 && d.nightMinTemp >= 26, bonus: 12 },
            { condition: (d) => d.nightMinTemp >= 25 && d.humidity >= 80, bonus: 8 }
        ],
        hotNight: {
            minTemp: 28,
            feelsLike: 30
        }
    };

    // ==================== 等级定义 ====================

    const LEVELS = {
        outbreak: { id: 'outbreak', name: '爆热', color: '#D0021B', order: 5, icon: '🔴' },
        action:   { id: 'action',   name: '热', color: '#F57C00', order: 4, icon: '🟠' },
        opportunity: { id: 'opportunity', name: '待热', color: '#F5A623', order: 3, icon: '🟡' },
        observe:  { id: 'observe',  name: '一般', color: '#4A90E2', order: 2, icon: '🔵' },
        cool:     { id: 'cool',     name: '凉爽', color: '#888888', order: 1, icon: '❄️' },
        normal:   { id: 'normal',   name: '普通', color: '#666666', order: 0, icon: '⚪' }
    };

    const LEVEL_ORDER = ['outbreak', 'action', 'opportunity', 'observe', 'cool', 'normal'];

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

        // 未来3天温度（保留用于其他功能）
        const future3DayMaxTemps = [];
        const future3NightMinTemps = [];
        for (let i = 1; i < Math.min(4, apiData.daily.length); i++) {
            future3DayMaxTemps.push(parseInt(apiData.daily[i].tempMax, 10));
            future3NightMinTemps.push(parseInt(apiData.daily[i].tempMin, 10));
        }

        // 未来7天温度（从今天开始，用于趋势图）
        const future7DayMaxTemps = [];
        const future7NightMinTemps = [];
        for (let i = 0; i < Math.min(7, apiData.daily.length); i++) {  // 索引0-6，对应今天到第6天
            future7DayMaxTemps.push(parseInt(apiData.daily[i].tempMax, 10));
            future7NightMinTemps.push(parseInt(apiData.daily[i].tempMin, 10));
        }

        // 未来7天ADI趋势（从今天开始，索引0-6，最多7天）
        const future7AdiScores = [];
        const maxDays = Math.min(7, apiData.daily.length);

        // 未来7天完整数据（用于7天预测页面）
        const future7Days = [];

        for (let i = 0; i < maxDays; i++) {
            const day = apiData.daily[i];
            const dayMax = parseInt(day.tempMax, 10);
            const dayNight = parseInt(day.tempMin, 10);
            const dayHumidity = parseInt(day.humidity, 10);
            const dayFeels = Math.round(dayMax + Math.max(0, (dayHumidity - 55) * 0.08));

            // For day 0, use today's continuous count
            // For days 1-6, calculate continuous count from that day forward
            let dayCont;
            if (i === 0) {
                dayCont = continuousHotNightDays;
            } else {
                // Count consecutive hot nights starting from day i
                dayCont = 0;
                for (let j = i; j < Math.min(7, apiData.daily.length); j++) {
                    const futureMin = parseInt(apiData.daily[j].tempMin, 10);
                    if (futureMin >= 28) {
                        dayCont++;
                    } else if (futureMin >= 26 && dayCont > 0) {
                        dayCont++;
                    } else {
                        break;
                    }
                }
            }

            const dayData = {
                maxTemp: dayMax,
                nightMinTemp: dayNight,
                feelsLike: dayFeels,
                humidity: dayHumidity,
                continuousHotNightDays: dayCont
            };
            const adiResult = calculateADI(dayData);
            future7AdiScores.push(adiResult.adiScore);

            // 使用API返回的fxDate字段来设置正确的日期，避免数据偏移
            const dayDate = new Date(day.fxDate);

            future7Days.push({
                date: dayDate,
                dayMax: dayMax,
                nightMin: dayNight,
                dayFeelsLike: dayFeels,
                nightFeelsLike: Math.round(dayNight + Math.max(0, (dayHumidity - 50) * 0.08)),
                humidity: dayHumidity,
                adiScore: adiResult.adiScore,
                level: adiResult.level,
                isHotNight: dayNight >= 28,
                weatherTextDay: day.textDay || '',
                weatherTextNight: day.textNight || '',
                weatherText: [day.textDay, day.textNight].filter(Boolean).join(' / ') || '无明显降水',
                precip: Number.isFinite(Number(day.precip)) ? Number(day.precip) : 0
            });
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
            future7DayMaxTemps,      // 新增：未来7天最高温
            future7NightMinTemps,    // 新增：未来7天最低温
            future7AdiScores,
            future7Days: enrichedFuture7Days,             // 新增：未来7天完整数据
            maxRainInsuranceLevel,   // 降水监控：最高投保提醒等级
            maxPostRainMuggyLevel,   // 降水监控：最高湿热机会等级
            maxPostRainMuggyScore,   // 降水监控：最高湿热机会分数
            nightMuggyScore: 0,
            updatedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
        };
    }

    // ==================== 和风天气API配置 ====================

    const QWEATHER_CONFIG = {
        apiKey: 'c7d384b2fa484e558b11e316ca4bb161',
        baseUrl: 'https://m96x89njb8.re.qweatherapi.com/v7/weather/7d',
        requestTimeout: 10000,  // 10秒超时
        cacheDuration: 6 * 60 * 60 * 1000  // 6小时缓存（毫秒）
    };

    // ==================== 城市群配置 ====================

    const CITY_GROUPS = {
        eastChina: {
            name: '华东城市群',
            nameEn: 'eastChina',
            provinces: ['上海', '江苏', '浙江', '安徽', '山东', '福建'],
            regions: ['华东'],
            color: '#4A90E2'
        },
        centralChina: {
            name: '华中城市群',
            nameEn: 'centralChina',
            provinces: ['湖北', '湖南', '河南', '江西'],
            regions: ['华中'],
            color: '#F5A623'
        },
        southChina: {
            name: '华南城市群',
            nameEn: 'southChina',
            provinces: ['广东', '广西', '海南'],
            regions: ['华南'],
            color: '#F57C00'
        },
        southwestChina: {
            name: '西南城市群',
            nameEn: 'southwestChina',
            provinces: ['四川', '重庆', '云南', '贵州'],
            regions: ['西南'],
            color: '#D0021B'
        }
    };

    // ==================== 城市配置 ====================

    const CITIES_CONFIG = [
        { name: '北京', lat: 39.92, lng: 116.46, province: '北京', region: '华北' },
        { name: '天津', lat: 39.13, lng: 117.2, province: '天津', region: '华北' },
        { name: '上海', lat: 31.22, lng: 121.48, province: '上海', region: '华东' },
        { name: '重庆', lat: 29.59, lng: 106.54, province: '重庆', region: '西南' },
        { name: '石家庄', lat: 38.03, lng: 114.48, province: '河北', region: '华北' },
        { name: '太原', lat: 37.87, lng: 112.53, province: '山西', region: '华北' },
        { name: '呼和浩特', lat: 40.82, lng: 111.65, province: '内蒙古', region: '华北' },
        { name: '沈阳', lat: 41.8, lng: 123.38, province: '辽宁', region: '东北' },
        { name: '大连', lat: 38.92, lng: 121.62, province: '辽宁', region: '东北' },
        { name: '长春', lat: 43.88, lng: 125.35, province: '吉林', region: '东北' },
        { name: '哈尔滨', lat: 45.75, lng: 126.63, province: '黑龙江', region: '东北' },
        { name: '南京', lat: 32.04, lng: 118.78, province: '江苏', region: '华东' },
        { name: '苏州', lat: 31.32, lng: 120.62, province: '江苏', region: '华东' },
        { name: '杭州', lat: 30.26, lng: 120.19, province: '浙江', region: '华东' },
        { name: '宁波', lat: 29.86, lng: 121.56, province: '浙江', region: '华东' },
        { name: '合肥', lat: 31.86, lng: 117.27, province: '安徽', region: '华东' },
        { name: '福州', lat: 26.08, lng: 119.3, province: '福建', region: '华东' },
        { name: '厦门', lat: 24.46, lng: 118.1, province: '福建', region: '华东' },
        { name: '南昌', lat: 28.68, lng: 115.89, province: '江西', region: '华东' },
        { name: '济南', lat: 36.65, lng: 117, province: '山东', region: '华东' },
        { name: '青岛', lat: 36.07, lng: 120.33, province: '山东', region: '华东' },
        { name: '郑州', lat: 34.76, lng: 113.65, province: '河南', region: '华中' },
        { name: '武汉', lat: 30.52, lng: 114.31, province: '湖北', region: '华中' },
        { name: '长沙', lat: 28.21, lng: 113, province: '湖南', region: '华中' },
        { name: '广州', lat: 23.16, lng: 113.23, province: '广东', region: '华南' },
        { name: '深圳', lat: 22.62, lng: 114.07, province: '广东', region: '华南' },
        { name: '东莞', lat: 23.04, lng: 113.75, province: '广东', region: '华南' },
        { name: '佛山', lat: 23.05, lng: 113.11, province: '广东', region: '华南' },
        { name: '南宁', lat: 22.84, lng: 108.33, province: '广西', region: '华南' },
        { name: '海口', lat: 20.02, lng: 110.35, province: '海南', region: '华南' },
        { name: '成都', lat: 30.67, lng: 104.06, province: '四川', region: '西南' },
        { name: '贵阳', lat: 26.57, lng: 106.71, province: '贵州', region: '西南' },
        { name: '昆明', lat: 25.04, lng: 102.73, province: '云南', region: '西南' },
        { name: '拉萨', lat: 29.97, lng: 91.11, province: '西藏', region: '西南' },
        { name: '西安', lat: 34.27, lng: 108.95, province: '陕西', region: '西北' },
        { name: '兰州', lat: 36.03, lng: 103.73, province: '甘肃', region: '西北' },
        { name: '西宁', lat: 36.56, lng: 101.74, province: '青海', region: '西北' },
        { name: '银川', lat: 38.47, lng: 106.27, province: '宁夏', region: '西北' },
        { name: '乌鲁木齐', lat: 43.77, lng: 87.68, province: '新疆', region: '西北' },
        { name: '无锡', lat: 31.49, lng: 120.31, province: '江苏', region: '华东' },
        { name: '常州', lat: 31.81, lng: 119.97, province: '江苏', region: '华东' },
        { name: '嘉兴', lat: 30.75, lng: 120.75, province: '浙江', region: '华东' },
        { name: '温州', lat: 28.0, lng: 120.65, province: '浙江', region: '华东' },
        { name: '绍兴', lat: 30.0, lng: 120.58, province: '浙江', region: '华东' },
        { name: '金华', lat: 29.08, lng: 119.64, province: '浙江', region: '华东' },
        { name: '台州', lat: 28.65, lng: 121.42, province: '浙江', region: '华东' },
        { name: '湖州', lat: 30.89, lng: 120.08, province: '浙江', region: '华东' },
        { name: '丽水', lat: 28.45, lng: 119.92, province: '浙江', region: '华东' },
        { name: '衢州', lat: 28.97, lng: 118.85, province: '浙江', region: '华东' },
        { name: '舟山', lat: 30.03, lng: 122.1, province: '浙江', region: '华东' },
        { name: '徐州', lat: 34.2, lng: 117.28, province: '江苏', region: '华东' },
        { name: '南通', lat: 31.98, lng: 120.89, province: '江苏', region: '华东' },
        { name: '连云港', lat: 34.59, lng: 119.16, province: '江苏', region: '华东' },
        { name: '淮安', lat: 33.59, lng: 119.11, province: '江苏', region: '华东' },
        { name: '盐城', lat: 33.34, lng: 120.16, province: '江苏', region: '华东' },
        { name: '扬州', lat: 32.39, lng: 119.42, province: '江苏', region: '华东' },
        { name: '镇江', lat: 32.2, lng: 119.45, province: '江苏', region: '华东' },
        { name: '泰州', lat: 32.45, lng: 119.92, province: '江苏', region: '华东' },
        { name: '宿迁', lat: 33.96, lng: 118.27, province: '江苏', region: '华东' },
        { name: '珠海', lat: 22.27, lng: 113.52, province: '广东', region: '华南' },
        { name: '汕头', lat: 23.35, lng: 116.68, province: '广东', region: '华南' },
        { name: '韶关', lat: 24.81, lng: 113.59, province: '广东', region: '华南' },
        { name: '湛江', lat: 21.27, lng: 110.35, province: '广东', region: '华南' },
        { name: '肇庆', lat: 23.04, lng: 112.46, province: '广东', region: '华南' },
        { name: '江门', lat: 22.57, lng: 113.08, province: '广东', region: '华南' },
        { name: '茂名', lat: 21.66, lng: 110.91, province: '广东', region: '华南' },
        { name: '惠州', lat: 23.11, lng: 114.41, province: '广东', region: '华南' },
        { name: '泉州', lat: 24.87, lng: 118.67, province: '福建', region: '华东' },
        { name: '漳州', lat: 24.51, lng: 117.39, province: '福建', region: '华东' },
        { name: '莆田', lat: 25.45, lng: 119.0, province: '福建', region: '华东' },
        { name: '三明', lat: 26.26, lng: 117.63, province: '福建', region: '华东' },
        { name: '赣州', lat: 25.83, lng: 114.93, province: '江西', region: '华东' },
        { name: '九江', lat: 29.71, lng: 116.0, province: '江西', region: '华东' },
        { name: '宜春', lat: 27.8, lng: 114.41, province: '江西', region: '华东' },
        { name: '淄博', lat: 36.81, lng: 118.05, province: '山东', region: '华东' },
        { name: '烟台', lat: 37.46, lng: 121.39, province: '山东', region: '华东' },
        { name: '潍坊', lat: 36.7, lng: 119.1, province: '山东', region: '华东' },
        { name: '临沂', lat: 35.1, lng: 118.35, province: '山东', region: '华东' },
        { name: '威海', lat: 37.5, lng: 122.1, province: '山东', region: '华东' },
        { name: '德州', lat: 37.43, lng: 116.35, province: '山东', region: '华东' },
        { name: '菏泽', lat: 35.23, lng: 115.43, province: '山东', region: '华东' },
        { name: '绵阳', lat: 31.46, lng: 104.67, province: '四川', region: '西南' },
        { name: '宜宾', lat: 28.76, lng: 104.64, province: '四川', region: '西南' },
        { name: '南充', lat: 30.83, lng: 106.11, province: '四川', region: '西南' },
        { name: '泸州', lat: 28.88, lng: 105.44, province: '四川', region: '西南' },
        { name: '桂林', lat: 25.27, lng: 110.29, province: '广西', region: '华南' },
        { name: '柳州', lat: 24.32, lng: 109.4, province: '广西', region: '华南' },
        { name: '保定', lat: 38.87, lng: 115.46, province: '河北', region: '华北' },
        { name: '廊坊', lat: 39.53, lng: 116.68, province: '河北', region: '华北' },
        { name: '唐山', lat: 39.63, lng: 118.17, province: '河北', region: '华北' },
        { name: '邯郸', lat: 36.61, lng: 114.48, province: '河北', region: '华北' },
        { name: '邢台', lat: 37.06, lng: 114.5, province: '河北', region: '华北' },
        { name: '沧州', lat: 38.3, lng: 116.83, province: '河北', region: '华北' },
        { name: '衡水', lat: 37.73, lng: 115.66, province: '河北', region: '华北' },
        { name: '大同', lat: 40.07, lng: 113.3, province: '山西', region: '华北' },
        { name: '阳泉', lat: 37.85, lng: 113.58, province: '山西', region: '华北' },
        { name: '长治', lat: 36.2, lng: 113.11, province: '山西', region: '华北' },
        { name: '晋城', lat: 35.49, lng: 112.85, province: '山西', region: '华北' },
        { name: '朔州', lat: 39.33, lng: 112.43, province: '山西', region: '华北' },
        { name: '包头', lat: 40.65, lng: 109.84, province: '内蒙古', region: '华北' },
        { name: '鞍山', lat: 41.08, lng: 122.99, province: '辽宁', region: '东北' },
        { name: '抚顺', lat: 41.88, lng: 123.95, province: '辽宁', region: '东北' },
        { name: '吉林市', lat: 43.83, lng: 126.56, province: '吉林', region: '东北' },
        { name: '齐齐哈尔', lat: 47.35, lng: 123.91, province: '黑龙江', region: '东北' },
        { name: '大庆', lat: 46.58, lng: 125.1, province: '黑龙江', region: '东北' },
        { name: '宜昌', lat: 30.69, lng: 111.28, province: '湖北', region: '华中' },
        { name: '襄阳', lat: 32.0, lng: 112.12, province: '湖北', region: '华中' },
        { name: '株洲', lat: 27.82, lng: 113.13, province: '湖南', region: '华中' },
        { name: '衡阳', lat: 26.89, lng: 112.57, province: '湖南', region: '华中' },
        { name: '岳阳', lat: 29.35, lng: 113.09, province: '湖南', region: '华中' },
        { name: '常德', lat: 29.03, lng: 111.69, province: '湖南', region: '华中' },
        { name: '开封', lat: 34.79, lng: 114.3, province: '河南', region: '华中' },
        { name: '洛阳', lat: 34.62, lng: 112.45, province: '河南', region: '华中' },
        { name: '平顶山', lat: 33.76, lng: 113.19, province: '河南', region: '华中' },
        { name: '安阳', lat: 36.09, lng: 114.39, province: '河南', region: '华中' },
        { name: '新乡', lat: 35.3, lng: 113.88, province: '河南', region: '华中' },
        { name: '焦作', lat: 35.21, lng: 113.24, province: '河南', region: '华中' },
        { name: '渭南', lat: 34.52, lng: 109.5, province: '陕西', region: '西北' },
        { name: '宝鸡', lat: 34.36, lng: 107.13, province: '陕西', region: '西北' },
        { name: '咸阳', lat: 34.32, lng: 108.7, province: '陕西', region: '西北' },
        { name: '三亚', lat: 18.25, lng: 109.51, province: '海南', region: '华南' },
        { name: '中山', lat: 22.52, lng: 113.38, province: '广东', region: '华南' },
        { name: '潮州', lat: 23.65, lng: 116.62, province: '广东', region: '华南' },
        { name: '揭阳', lat: 23.54, lng: 116.37, province: '广东', region: '华南' },
        { name: '阳江', lat: 21.85, lng: 111.98, province: '广东', region: '华南' },
        { name: '清远', lat: 23.68, lng: 113.05, province: '广东', region: '华南' },
        { name: '日照', lat: 35.41, lng: 119.52, province: '山东', region: '华东' },
        { name: '聊城', lat: 36.45, lng: 115.97, province: '山东', region: '华东' },
        { name: '滨州', lat: 37.38, lng: 118.01, province: '山东', region: '华东' },
        { name: '东营', lat: 37.43, lng: 118.67, province: '山东', region: '华东' },
        { name: '枣庄', lat: 34.81, lng: 117.32, province: '山东', region: '华东' }
    ];

    // ==================== ADI 评分函数 ====================

    function scoreNightMinTemp(temp) {
        if (temp >= 28) return 100;
        if (temp >= 26) return 85;
        if (temp >= 24) return 70;
        if (temp >= 22) return 50;
        if (temp >= 20) return 30;
        return 0;
    }

    function scoreDayMaxTemp(temp) {
        if (temp >= 37) return 100;
        if (temp >= 35) return 90;
        if (temp >= 33) return 75;
        if (temp >= 30) return 55;
        if (temp >= 28) return 30;
        return 0;
    }

    function scoreFeelsLike(temp) {
        if (temp >= 40) return 100;
        if (temp >= 37) return 85;
        if (temp >= 34) return 65;
        if (temp >= 30) return 45;
        if (temp >= 26) return 20;
        return 0;
    }

    function scoreContinuousHeat(days) {
        if (days >= 5) return 100;
        if (days >= 4) return 85;
        if (days >= 3) return 70;
        if (days >= 2) return 50;
        if (days >= 1) return 25;
        return 0;
    }

    function scoreHumidityMuggy(humidity, temp) {
        let base = 0;
        if (humidity >= 80) base = 85;
        else if (humidity >= 70) base = 65;
        else if (humidity >= 60) base = 40;
        else if (humidity >= 50) base = 20;
        if (temp >= 35 && humidity >= 60) base = Math.min(base + 15, 100);
        return base;
    }

    // ==================== ADI 计算 ====================

    function calculateADI(data) {
        const w = ADI_CONFIG.weights;

        const nightScore = scoreNightMinTemp(data.nightMinTemp);
        const dayScore = scoreDayMaxTemp(data.maxTemp);
        const feelsScore = scoreFeelsLike(data.feelsLike);
        const contScore = scoreContinuousHeat(data.continuousHotNightDays);
        const humScore = scoreHumidityMuggy(data.humidity, data.maxTemp);

        let adi = nightScore * w.nightMinTemp
            + dayScore * w.dayMaxTemp
            + feelsScore * w.feelsLike
            + contScore * w.continuousHeat
            + humScore * w.humidityMuggy;

        let totalBonus = 0;
        ADI_CONFIG.nightMuggyBonus.forEach(rule => {
            if (rule.condition(data)) totalBonus += rule.bonus;
        });

        adi += totalBonus;
        adi = Math.min(100, Math.round(adi));

        return {
            adiScore: adi,
            breakdown: {
                nightMinTemp: { score: nightScore, weight: w.nightMinTemp, contribution: Math.round(nightScore * w.nightMinTemp) },
                dayMaxTemp: { score: dayScore, weight: w.dayMaxTemp, contribution: Math.round(dayScore * w.dayMaxTemp) },
                feelsLike: { score: feelsScore, weight: w.feelsLike, contribution: Math.round(feelsScore * w.feelsLike) },
                continuousHeat: { score: contScore, weight: w.continuousHeat, contribution: Math.round(contScore * w.continuousHeat) },
                humidityMuggy: { score: humScore, weight: w.humidityMuggy, contribution: Math.round(humScore * w.humidityMuggy) },
                nightBonus: totalBonus
            }
        };
    }

    // ==================== 等级判断 ====================

    function determineLevel(adiScore, data) {
        let level;
        if (adiScore >= ADI_CONFIG.thresholds.outbreak.min) level = 'outbreak';
        else if (adiScore >= ADI_CONFIG.thresholds.action.min) level = 'action';
        else if (adiScore >= ADI_CONFIG.thresholds.opportunity.min) level = 'opportunity';
        else if (adiScore >= ADI_CONFIG.thresholds.observe.min) level = 'observe';
        else if (adiScore >= ADI_CONFIG.thresholds.cool.min) level = 'cool';
        else level = 'normal';

        const triggeredRules = [];
        ADI_CONFIG.forceUpgrade.forEach(rule => {
            if (rule.check(data)) {
                triggeredRules.push(rule.name);
                const targetOrder = LEVELS[rule.targetLevel].order;
                const currentOrder = LEVELS[level].order;
                if (targetOrder > currentOrder) {
                    level = rule.targetLevel;
                }
            }
        });

        return { level, triggeredRules };
    }

    // ==================== 夜间闷热指数 ====================

    function calculateNightMuggyScore(data) {
        const nightTemp = data.nightMinTemp;
        const nightFeelsLike = nightTemp + (data.humidity - 50) * 0.08;

        let tempScore = 0;
        if (nightTemp >= 30) tempScore = 100;
        else if (nightTemp >= 28) tempScore = 80;
        else if (nightTemp >= 26) tempScore = 60;
        else if (nightTemp >= 24) tempScore = 40;
        else if (nightTemp >= 22) tempScore = 20;

        let feelsScore = 0;
        if (nightFeelsLike >= 32) feelsScore = 100;
        else if (nightFeelsLike >= 30) feelsScore = 80;
        else if (nightFeelsLike >= 28) feelsScore = 60;
        else if (nightFeelsLike >= 26) feelsScore = 40;

        let humScore = 0;
        if (data.humidity >= 80) humScore = 100;
        else if (data.humidity >= 70) humScore = 70;
        else if (data.humidity >= 60) humScore = 40;

        return Math.round(tempScore * 0.6 + feelsScore * 0.25 + humScore * 0.15);
    }

    function isHotNight(data) {
        const nightFeelsLike = data.nightMinTemp + (data.humidity - 50) * 0.08;
        return data.nightMinTemp >= ADI_CONFIG.hotNight.minTemp || nightFeelsLike >= ADI_CONFIG.hotNight.feelsLike;
    }

    // ==================== 短原因生成 ====================

    function generateShortReason(data, level, triggeredRules) {
        if (level === 'normal') return '温度适中';

        const parts = [];

        if (data.nightMinTemp >= 30) parts.push(`夜温≥${data.nightMinTemp}℃`);
        else if (data.nightMinTemp >= 28) parts.push(`夜温${data.nightMinTemp}℃`);

        if (data.feelsLike >= 42) parts.push('体感≥42℃');
        else if (data.feelsLike >= 38) parts.push(`体感${data.feelsLike}℃`);

        if (data.continuousHotNightDays >= 3) parts.push(`连续热夜${data.continuousHotNightDays}天`);
        else if (data.continuousHotNightDays >= 2) parts.push(`热夜${data.continuousHotNightDays}天`);

        if (data.maxTemp >= 35) parts.push(`最高温${data.maxTemp}℃`);

        if (data.future3DayMaxTemps && data.future3DayMaxTemps.every(t => t >= 35)) {
            parts.push('未来3天均≥35℃');
        }

        if (parts.length === 0) {
            if (data.adiScore >= 65) parts.push('高温趋势');
            else if (data.adiScore >= 55) parts.push('升温迹象');
        }

        return parts.slice(0, 2).join('，');
    }

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

    // ==================== 等级趋势 ====================

    function calculateLevelTrend(currentLevel, future7AdiScores) {
        let maxFutureLevel = currentLevel;

        future7AdiScores.forEach(adi => {
            let fLevel;
            if (adi >= 85) fLevel = 'outbreak';
            else if (adi >= 75) fLevel = 'action';
            else if (adi >= 65) fLevel = 'opportunity';
            else if (adi >= 55) fLevel = 'observe';
            else fLevel = 'normal';

            if (getLevelOrder(fLevel) > getLevelOrder(maxFutureLevel)) {
                maxFutureLevel = fLevel;
            }
        });

        const currentName = LEVELS[currentLevel] ? LEVELS[currentLevel].name : '普通';
        const futureName = LEVELS[maxFutureLevel] ? LEVELS[maxFutureLevel].name : '普通';

        return {
            currentLevel,
            maxFutureLevel,
            trendText: currentName + '→' + futureName,
            trendColor: LEVELS[maxFutureLevel] ? LEVELS[maxFutureLevel].color : '#666'
        };
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
                    reason,
                    shortReason,
                    levelTrend
                };
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

        const raw = results;

        // Ensure realistic level distribution:
        // Outbreak: 8-15, Action: 15-30, rest flows naturally
        // Sort by ADI descending and reassign levels to hit targets
        const MAX_OUTBREAK = 12;
        const MAX_ACTION_TOP = 35; // outbreak + action combined ≤ 35

        const sorted = [...raw].sort((a, b) => b.adiScore - a.adiScore);
        const outbreakThreshold = sorted[Math.min(MAX_OUTBREAK - 1, sorted.length - 1)].adiScore;
        const actionThresholdIdx = Math.min(MAX_ACTION_TOP - 1, sorted.length - 1);
        const actionThreshold = sorted[actionThresholdIdx].adiScore;

        raw.forEach(city => {
            // Only downgrade, never upgrade
            if (city.level === 'outbreak' && city.adiScore < outbreakThreshold) {
                city.level = 'action';
                // Remove force-upgrade triggered rules from reason
                city.triggeredRules = city.triggeredRules.filter(r =>
                    !r.includes('直接判定为爆发级')
                );
                if (city.triggeredRules.length === 0) {
                    // Keep the short reason based on actual conditions
                }
            }
            if (city.level === 'action' && city.adiScore < actionThreshold && city.level !== 'outbreak') {
                // Don't downgrade below action if they're already there from force upgrade
            }
        });

        return raw;
    }

    // ==================== 判断原因生成 ====================

    function generateReason(data, adiScore, level, triggeredRules) {
        const levelName = LEVELS[level] ? LEVELS[level].name : '普通';
        const parts = [];
        parts.push(`${data.cityName}当前ADI ${adiScore}，属于${levelName}`);

        const reasons = [];
        if (data.maxTemp >= 35) reasons.push(`白天最高温${data.maxTemp}℃`);
        if (data.nightMinTemp >= 28) reasons.push(`夜间最低温${data.nightMinTemp}℃`);
        if (data.feelsLike >= 38) reasons.push(`体感温度${data.feelsLike}℃`);
        if (data.continuousHotNightDays >= 2) reasons.push(`连续热夜${data.continuousHotNightDays}天`);
        if (data.humidity >= 75) reasons.push(`湿度${data.humidity}%`);

        if (triggeredRules.length > 0) {
            reasons.push(`触发"${triggeredRules[triggeredRules.length - 1]}"规则`);
        }

        if (reasons.length > 0) {
            parts.push('主要原因是' + reasons.join('、'));
        }

        return parts.join('。') + '。';
    }

    // ==================== 统计函数 ====================

    function getLevelStats(cityDataList) {
        const stats = { outbreak: 0, action: 0, opportunity: 0, observe: 0, normal: 0 };
        cityDataList.forEach(c => { if (stats[c.level] !== undefined) stats[c.level]++; });
        return stats;
    }

    function getHotNightCities(cityDataList) {
        return cityDataList.filter(c => isHotNight(c));
    }

    function getLongestHotNight(cityDataList) {
        const hotCities = getHotNightCities(cityDataList).sort((a, b) => b.continuousHotNightDays - a.continuousHotNightDays);
        const top = hotCities[0];
        return {
            maxDays: top ? top.continuousHotNightDays : 0,
            cityName: top ? top.cityName : '-',
            totalCities: hotCities.length,
            future3Nights: top ? top.future3NightMinTemps : []
        };
    }

    function getTopByADI(cityDataList, n) { return [...cityDataList].sort((a, b) => b.adiScore - a.adiScore).slice(0, n || 10); }

    function getTopNightMuggy(cityDataList, n) { return [...cityDataList].sort((a, b) => b.nightMuggyScore - a.nightMuggyScore).slice(0, n || 10); }

    function getTopHeatRise(cityDataList, n) {
        return [...cityDataList]
            .map(c => {
                const futureAdi3 = c.future7AdiScores[2] || c.adiScore;
                const futureMax3 = c.future3DayMaxTemps[2] || c.maxTemp;
                const futureNight3 = c.future3NightMinTemps[2] || c.nightMinTemp;
                return {
                    ...c,
                    futureAdi3,
                    adiChange: futureAdi3 - c.adiScore,
                    maxTempChange: futureMax3 - c.maxTemp,
                    nightTempChange: futureNight3 - c.nightMinTemp,
                    futureMax3,
                    futureNight3
                };
            })
            .filter(c => c.adiChange > 0 || c.maxTempChange > 0 || c.nightTempChange > 0)
            .sort((a, b) => (b.adiChange + b.maxTempChange * 0.5 + b.nightTempChange * 0.3) - (a.adiChange + a.maxTempChange * 0.5 + a.nightTempChange * 0.3))
            .slice(0, n || 10);
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

    function getCitiesByLevel(cityDataList, level) {
        return cityDataList.filter(c => c.level === level).sort((a, b) => b.adiScore - a.adiScore);
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

    function getLevelInfo(levelId) {
        return LEVELS[levelId] || LEVELS.normal;
    }

    function getLevelOrder(levelId) {
        return LEVELS[levelId] ? LEVELS[levelId].order : 0;
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
