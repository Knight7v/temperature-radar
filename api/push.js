// 企业微信群机器人推送 API
// 前端 POST 一个紧凑简报摘要 → 服务端格式化为 markdown → 转发到企业微信 webhook。
// webhook 地址通过环境变量 WECOM_BOT_WEBHOOK 注入,不暴露到前端。

const { buildForType } = require('./utils/wecom-message.js');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhook = process.env.WECOM_BOT_WEBHOOK;
  if (!webhook) {
    return res.status(503).json({ error: '未配置企业微信机器人(WECOM_BOT_WEBHOOK)' });
  }

  const summary = req.body;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return res.status(400).json({ error: '缺少简报数据' });
  }

  let content;
  try {
    // type:brief(完整简报)/ heatFocus(高温重点关注)/ heatRise(升温预报)
    content = buildForType(summary.type || 'brief', summary);
  } catch (e) {
    console.error('简报格式化失败:', e);
    return res.status(400).json({ error: '简报数据格式错误' });
  }

  try {
    const resp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } })
    });

    // 企业微信返回 { errcode: 0, errmsg: 'ok' } 表示成功
    let data = {};
    try { data = await resp.json(); } catch (_) { /* 非 JSON 响应 */ }

    if (!resp.ok || data.errcode !== 0) {
      console.error('企业微信推送失败:', resp.status, data);
      return res.status(502).json({
        error: '企业微信推送失败',
        detail: data.errmsg || ('HTTP ' + resp.status)
      });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('调用企业微信 webhook 异常:', e);
    return res.status(502).json({ error: '调用企业微信异常', detail: String((e && e.message) || e) });
  }
}
