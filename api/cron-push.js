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
