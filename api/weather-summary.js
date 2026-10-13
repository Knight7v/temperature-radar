// 天气销售机会摘要:首页驾驶舱调用,返回高温重点城市数、升温预警数等轻量汇总。
// 复用 cron-push 的「抓全量城市 → ADI 计算」链路;数据为平台共享的和风天气,登录用户即可看。
// 鉴权:requireUser(仅校验 JWT,不查库,因天气不涉及租户私有数据)。
// 缓存:进程内 30 分钟,避免首页每次打开都抓全量 56 城;qweather 另有 3h 上游缓存。
const { apiHandler } = require('../lib/http');
const { requireUser } = require('../lib/auth');
const QWeather = require('../lib/qweather');
const ADICore = require('../js/adi-core');

const CACHE_TTL = 30 * 60 * 1000; // 30 分钟
let _cache = { ts: 0, data: null };
let _pending = null; // 并发去重:同时多个请求只抓一次

async function computeSummary() {
  const apiKey = process.env.QWEATHER_API_KEY;
  if (!apiKey) throw Object.assign(new Error('未配置 QWEATHER_API_KEY'), { status: 503 });

  const { results, failed } = await QWeather.fetch7dBatch(ADICore.CITIES_CONFIG, apiKey, { concurrency: 6, timeoutMs: 10000 });

  const cityData = [];
  for (const { city, data } of results) {
    const parsed = ADICore.parseWeatherData(data, city);
    if (parsed) cityData.push(ADICore.assembleCityData(parsed));
  }

  const heatFocus = ADICore.buildHeatFocusSummary(cityData);
  const heatRise = ADICore.buildHeatRiseSummary(cityData);

  return {
    updatedAt: new Date().toISOString(),
    totalCities: cityData.length,
    heatFocusCount: (heatFocus.stats.outbreak || 0) + (heatFocus.stats.action || 0),
    outbreak: heatFocus.stats.outbreak || 0,
    action: heatFocus.stats.action || 0,
    topCities: (heatFocus.outbreakCities || []).map((c) => c.name).concat(heatFocus.actionCities || []).slice(0, 6),
    risingCount: (heatRise.risingCities || []).length,
    risingCities: (heatRise.risingCities || []).slice(0, 6).map((c) => c.name),
    failed,
  };
}

module.exports = apiHandler(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  await requireUser(req); // 登录即可看(平台共享天气数据)

  const now = Date.now();
  if (_cache.data && now - _cache.ts < CACHE_TTL) return res.json({ data: _cache.data });
  if (_pending) return res.json({ data: await _pending });

  _pending = computeSummary()
    .then((data) => { _cache = { ts: Date.now(), data }; return data; })
    .finally(() => { _pending = null; });

  return res.json({ data: await _pending });
});
