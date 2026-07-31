# 服务端 cron 自动推送 + 去等级封顶 + API Key 入环境变量

- 日期: 2026-07-31
- 分支: `feat/server-cron-push`
- 状态: 待评审

## 1. 背景与目标

「空调热销区域雷达」目前的全部决策逻辑(ADI 计算、等级判断、排行榜)都在浏览器端 `js/core.js` 里运行,企业微信推送(`/api/push`)只能由人手动打开网页点按钮触发。这折断了「雷达 → 提醒 → 跟进」的闭环。

本次实现三件事:

1. **服务端 cron 自动推送** —— 把 ADI 计算搬到服务端,每天定时跑全量城市,达标即自动推送企业微信。
2. **去掉人为的等级封顶** —— 删除 `generateAllCityData` 里硬编码的 `MAX_OUTBREAK=12` / `MAX_ACTION_TOP=35` 封顶逻辑,停止对真实信号的扭曲。
3. **API Key 入环境变量** —— 把硬编码在前端的和风天气 key 迁到服务端环境变量,前端改为通过 `/api/weather` 代理获取数据。

成功标准:部署后,每天北京时间 09:30 自动产出并推送「高温重点关注」与「升温预报」(达标才推);前端不再含明文 key;前端展示的等级与推送的等级来自同一份逻辑。

## 2. 范围

**包含**
- 抽取纯决策逻辑到共享 UMD 模块 `js/adi-core.js`(前端、手动推送、定时推送共用)。
- 新增 `/api/weather` 代理 + 服务端抓取模块 `api/utils/qweather.js`。
- 新增 `/api/cron-push` 定时入口。
- 改造 `js/core.js`(去 key、走代理、删封顶、改用共享模块)。
- `vercel.json` 增加 cron 配置。
- 新增/所需环境变量:`QWEATHER_API_KEY`、`WECOM_BOT_WEBHOOK`(已存在)。

**排除(本轮不动)**
- mock 静默降级的显式告警(评估第 4 条)。
- ADI 对照真实销量的校准(评估第 5 条)。
- 收敛/下线「降水监控」功能。
- 历史记录持久化:cron 本轮只「算 + 推」,不落库。
- 登录/支付体系。

## 3. 关键决策

### 3.1 共享逻辑:抽取而非复制(方案 A)
cron 需要与前端同一份 ADI 逻辑。**抽取纯逻辑到单一 UMD 模块**,而非服务端复制一份。理由:复制会造成两个事实源,ADI 权重/阈值改动后,前端展示与推送可能不一致(「页面显示热,推送说爆热」),对决策工具是可信度事故。

### 3.2 共享模块放在 `js/adi-core.js`,不放 `/api/`
Vercel 把 `/api/*` 当作 Serverless Functions,浏览器无法以 `<script>` 静态加载 `/api/` 下的文件。因此浏览器需要的共享模块必须放在静态目录 `js/`(参照已有的 `js/rain-monitor.js`,其测试以 `require('../js/rain-monitor.js')` 引用)。仅服务端文件放在 `api/`。

### 3.3 core.js 用「别名法」消费共享模块
在 `core.js` IIFE 顶部 `const { calculateADI, determineLevel, … } = window.ADICore;`,然后删除已搬走的本地定义。内部调用点(如 `calculateADI(...)` )与对外 `Core.*` API 均不变,因此 `ui.js`/`map.js`/`push.js` 无需改动。

### 3.4 推送策略
- 每天北京时间 09:30 = 01:30 UTC,cron 表达式 `30 1 * * *`。
- 推送 `heatFocus`(有爆热/行动级才推)+ `heatRise`(未来 3 天 ADI 上升 ≥ 10 才推)。两者均复用既有 `hasContent` 门控,无内容则不推、不刷屏。
- 不自动推 `brief`(避免每日噪音)。手动推送保留不变。

### 3.5 API Key:走 `/api/weather` 代理(方案 A)
key 只存服务端 env。前端 `fetchWeatherData` 改调 `/api/weather`;cron 与代理共用 `api/utils/qweather.js` 的 `fetch7d`。

## 4. 架构与文件计划

| 文件 | 类型 | 说明 |
|---|---|---|
| `js/adi-core.js` | 新建 / UMD | **单一事实源**。纯逻辑 + 配置 + 城市清单 + 摘要构造。详见 §5。 |
| `js/core.js` | 改 | ① 删硬编码 key;② `fetchWeatherData` 改走 `/api/weather`;③ 删等级封顶块(core.js:1168-1196);④ 顶部别名 `window.ADICore`,删已搬走的本地定义。`Core.*` 对外 API 不变。 |
| `api/weather.js` | 新建 | `GET /api/weather?location=lng,lat` → 用 `process.env.QWEATHER_API_KEY` 调 `fetch7d` → 返回和风原始 JSON(前端期望同结构)。带短时服务端缓存。 |
| `api/utils/qweather.js` | 新建 | 服务端共享抓取:`fetch7d(location, apiKey)`,带超时 + QPM 友好的并发批处理。代理与 cron 共用。 |
| `api/cron-push.js` | 新建 | cron 入口。详见 §6。 |
| `vercel.json` | 改 | 增加 `"crons": [{ "path": "/api/cron-push", "schedule": "30 1 * * *" }]`。 |
| `index-v2.html` | 改 | 在 `js/core.js` 之前加载 `<script src="js/adi-core.js"></script>`(参照 `js/rain-monitor.js` 的加载位置)。 |
| `api/push.js` / `js/push.js` | 不变 | 手动推送链路保留,无回归。 |

## 5. `js/adi-core.js` 模块内容

UMD:`window.ADICore = mod` / `module.exports = mod`。

**搬入(从 core.js 原样移动,不重写)**
- 配置:`ADI_CONFIG`(weights/thresholds/forceUpgrade/nightMuggyBonus/hotNight)、`LEVELS`、`LEVEL_ORDER`。
- 数据:`CITIES_CONFIG`(130 城)、`CITY_GROUPS`。
- 评分:`scoreNightMinTemp`、`scoreDayMaxTemp`、`scoreFeelsLike`、`scoreContinuousHeat`、`scoreHumidityMuggy`。
- 核心:`calculateADI`、`determineLevel`、`calculateNightMuggyScore`、`isHotNight`、`generateShortReason`、`generateReason`、`calculateLevelTrend`、`calculateSalesIntensity`、`calculateRegionStats`。
- 统计/排行:`getLevelStats`、`getHotNightCities`、`getLongestHotNight`、`getTopByADI`、`getTopNightMuggy`、`getTopHeatRise`、`getCitiesByLevel`、`getLevelInfo`、`getLevelOrder`。
- 解析/装配:`parseWeatherData(apiData, city)`、`assembleCityData(parsedData)`。

> 别名集合:`core.js` 顶部需把上述所有会被其内部仍引用的符号(含 `LEVELS`、`ADI_CONFIG`、`CITIES_CONFIG`、各 `score*`、`calculateADI`、`determineLevel`、`generateShortReason`、`calculateSalesIntensity`、`calculateRegionStats`、`getTopHeatRise`、`getCitiesByLevel`、`getLevelStats` 等)一并从 `window.ADICore` 解构别名,确保 `generateCityData`、`generateDailyBrief` 等留存函数的内部调用点不变。`escapeHtml` 是纯前端 HTML 工具,仅 `generateDailyBrief` 使用,**保留在 core.js**,不搬入。
- 摘要构造(改为接收 `cityData` 的纯函数,返回纯数据对象,不含 HTML):`buildHeatFocusSummary(cityData)`、`buildHeatRiseSummary(cityData)`、`buildSummary(type, cityData)`、`regionList(cityData)`、`RULES = { heatRise: { minAdiChange: 10 } }`。

**服务端安全处理**
- `parseWeatherData` 中对 `window.RainMonitor` 的调用改为守卫:`typeof window !== 'undefined' && window.RainMonitor ? … : future7Days`。服务端跳过降水富化(推送类型不需要)。浏览器端行为不变。
- `assembleCityData(parsedData)`:封装现有 generateCityData 中「parse → 计算 adiScore/level/reason/shortReason/levelTrend → 组装」的重复块,返回完整 cityData。前端 API 路径、mock 路径、cron 三处复用。

**不搬入(留在 core.js,浏览器专属)**
- `fetchWeatherData`(改为走 `/api/weather`,含 localStorage 缓存)。
- `generate7DayDailyData`、`generateCityData`(含 mock 降级)、`generateAllCityData`(分批调度,封顶块删除)。
- `generateDailyBrief`(前端简报模态框 HTML,服务端不需要)。
- `QWEATHER_CONFIG` 中的 `apiKey` 删除;`baseUrl`/`requestTimeout`/`cacheDuration` 保留给前端缓存层使用。

## 6. `/api/cron-push` 行为

1. 鉴权:校验请求头 `x-vercel-cron: 1`,或查询参 `?token=<CRON_SECRET>`(可选 env,命中其一即放行)。否则 401。
2. 读取 `process.env.QWEATHER_API_KEY` 与 `process.env.WECOM_BOT_WEBHOOK`;缺失则 503 并日志。
3. 遍历 `CITIES_CONFIG`,分批(每批并发 5–8)调 `fetch7d(location, apiKey)` → `parseWeatherData` → `assembleCityData`。单城失败跳过、计入 `failed`,不阻塞整体。
4. 组装 `cityData[]`,调用 `buildSummary('heatFocus', cityData)` 与 `buildSummary('heatRise', cityData)`。
5. 对每个类型:若 `summary.hasContent !== false`,调 `wecom-message.js` 的 `buildForType(type, summary)` → POST 企业微信 webhook;否则跳过。
6. 返回 JSON 汇总:`{ cities, failed, pushed: { heatFocus: bool, heatRise: bool } }`,供日志/调试。

**超时**:Vercel 默认 300s。130 城分批并发,单批含超时,总量在限内。

## 7. 数据流

```
手动推送(不变):
  浏览器 UI.state.cityData → js/push.js buildSummary → POST /api/push → 企业微信

定时推送(新增):
  Vercel cron (01:30 UTC) → GET /api/cron-push
    → [130 城 分批] fetch7d(env key) → parseWeatherData → assembleCityData
    → cityData[] → buildSummary('heatFocus'/'heatRise')  (同一份纯函数)
    → 达标? buildForType → POST 企业微信

天气数据(前端, 改造):
  core.js fetchWeatherData → GET /api/weather?location=… → fetch7d(env key) → 和风
```

## 8. 环境变量

| 变量 | 用途 | 本地 | 生产 |
|---|---|---|---|
| `QWEATHER_API_KEY` | 和风天气 key(从 core.js 迁出) | `.env.local` | `vercel env` |
| `WECOM_BOT_WEBHOOK` | 企业微信机器人 webhook(已存在) | `.env.local` | `vercel env` |
| `CRON_SECRET`(可选) | cron 额外鉴权 token | `.env.local` | `vercel env` |

> 注意:`/api/weather` 为公开 GET(前端需匿名调用),其安全性来自 key 在服务端、不在响应中暴露。`/api/cron-push` 靠 cron 头 + 可选 secret 防滥用。

## 9. 风险与兜底

- **改 core.js 的回归风险** → 别名法 + 原样移动(非重写)+ `Core.*` 对外 API 不变;现有 `tests/` 必须保持绿,作为回归门槛。
- **QWeather 配额** → 130 次/天;cron 内并发 5–8、单请求 10s 超时、失败计数;某城失败不阻塞。
- **推送重复/扰民** → `hasContent` 门控 + 每日一次。
- **cron 被随意触发** → `x-vercel-cron` 头 + 可选 `CRON_SECRET`。
- **共享模块被两端加载顺序问题** → `index-v2.html` 中 `adi-core.js` 必须在 `core.js` 之前加载(同 rain-monitor.js)。

## 10. 测试

- 现有 `tests/wecom-message.test.js`、`tests/rain-monitor.test.js` 等保持通过。
- 为 `js/adi-core.js` 的纯函数补最小测试(calculateADI / determineLevel / buildSummary 的 hasContent 门控),确保前端与 cron 用的是同一份可验证逻辑。
- cron 端到端:提供本地 `curl 'http://localhost:3000/api/cron-push?token=…'`(或 `vercel dev`)验证返回结构与推送;真实 webhook 推送以测试机器人验证一次。
