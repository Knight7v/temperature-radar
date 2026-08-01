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
