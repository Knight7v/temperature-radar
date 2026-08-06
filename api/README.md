# API 文档

本服务目前仅保留核心管线相关接口:天气数据代理、企微推送(手动 + 定时)。
登录 / 支付 / 订阅 / 权限 / 广告等商业化端点已下线(代码见 git 历史)。

---

## 天气数据代理

### 获取 7 天预报
**GET** `/api/weather?location={city}`

和风天气数据代理。API key 仅存服务端环境变量,前端匿名调用。

查询参数:
```
?location=北京        # 城市名(中文)或 LocationID
```

响应:和风天气原始 JSON(约 1 小时刷新,带 `Cache-Control: public, max-age=3600`)。

错误:
- `400` 缺少 `location`
- `503` 未配置 `QWEATHER_API_KEY`
- `502` 上游获取失败

---

## 企微推送

### 手动推送(前端按钮触发)
**POST** `/api/push`

前端 `Push.pushBrief()` 用 `ADICore.buildSummary()` 预构建摘要后提交;服务端用 `lib/wecom-message.js` 格式化为 markdown 并转发到企业微信机器人 webhook。

请求体(已构建的摘要对象):
```json
{
  "type": "heatFocus | heatRise | brief",
  "...": "buildSummary 产出的字段"
}
```

响应:
```json
{ "success": true }
```

---

### 定时推送(Vercel Cron)
**GET** `/api/cron-push`

`vercel.json` 中注册,每日 **01:30 UTC(北京 09:30)** 由 Vercel Cron 以 GET 触发。抓取全部城市 → 装配数据 → 构建「高温重点关注」与「升温预报」摘要 → 达标才推(无爆热/行动级或无显著升温则跳过)。

鉴权:
- 若配置了 `CRON_SECRET`:需带查询参 `?token={CRON_SECRET}`。
- 否则退化为检查 `x-vercel-cron: 1` 头(**生产环境务必配置 `CRON_SECRET`**,否则该头可被伪造)。

响应:
```json
{ "cities": 12, "failed": [], "pushed": { "heatFocus": true, "heatRise": false }, "errors": [] }
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | 未授权(cron token 缺失/不符) |
| 502 | 上游(和风)获取失败 |
| 503 | 缺少必要环境变量 |
| 500 | 服务器内部错误 |

---

## 环境变量

在 Vercel 用 `vercel env add <NAME>` 配置(Production / Preview):

```
QWEATHER_API_KEY=你的和风天气key          # 必需:weather + cron-push
WECOM_BOT_WEBHOOK=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx   # 必需:push + cron-push
CRON_SECRET=自定义cron鉴权token            # 强烈建议:cron-push 额外鉴权
```

---

**最后更新:** 2026-08-06
