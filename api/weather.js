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
