# 未来7天降水监控设计

日期: 2026-05-26
范围: 在现有空调热销区域雷达中增加未来7天降水监控能力

## 背景

现有系统已经通过和风天气7天预报计算温度、湿度、体感温度和ADI销售机会。新功能需要在同一批7天预报数据上识别两类业务信号:

1. 供应链配送: 下雨不停止送货，而是提醒购买送货保险，覆盖包装被雨水淋湿造成损失的风险。
2. 销售机会: 降雨后湿度较大，如果紧接着升温，可能形成湿热天气，从而带来空调销售机会。

## 目标

- 降水监控作为独立TAB页面，位于7天预测下方，提供城市和日期维度的明细。
- 使用现有和风天气7天预报接口，不新增API。
- 降水逻辑独立成业务评分模型，避免混入现有ADI计算。

## 非目标

- 不做物流排班日历。
- 不判断停止配送、延期配送或禁止送货。
- 不配置仓库、车辆、客户地址或真实保险购买流程。
- 不改变现有ADI等级体系，只把雨后湿热作为销售机会补充信号。

## 数据来源

继续使用和风天气每日预报接口 `/v7/weather/7d`。现有接口响应中的 `daily` 字段已包含本功能所需数据:

- `fxDate`: 预报日期
- `textDay`: 白天天气文字
- `textNight`: 夜间天气文字
- `precip`: 当日总降水量，单位毫米
- `humidity`: 相对湿度
- `tempMax`: 当日最高温
- `tempMin`: 当日最低温

如果 `precip` 缺失或不可用，优先用 `textDay` 和 `textNight` 判断降水。

## 数据模型

在每个 `future7Days` 日对象中扩展以下字段:

```js
{
  weatherTextDay: string,
  weatherTextNight: string,
  weatherText: string,
  precip: number,

  rainInsuranceLevel: 'none' | 'remind' | 'strong',
  rainInsuranceLabel: '无提醒' | '提醒投保' | '强提醒',
  rainInsuranceReason: string,

  postRainMuggyScore: number,
  postRainMuggyLevel: 'none' | 'watch' | 'medium' | 'high',
  postRainMuggyLabel: '无明显机会' | '观察' | '中机会' | '高机会',
  postRainMuggyReason: string
}
```

城市对象保留现有字段，并可增加汇总字段:

```js
{
  maxRainInsuranceLevel: 'none' | 'remind' | 'strong',
  maxPostRainMuggyScore: number,
  maxPostRainMuggyLevel: 'none' | 'watch' | 'medium' | 'high'
}
```

## 投保提醒规则

配送照常进行。降雨只触发投保提醒，不触发避雨、延期或禁止送货。

等级:

| 等级 | 文案 | 规则 |
| --- | --- | --- |
| `none` | 无提醒 | 无降水信号，且 `precip <= 0` |
| `remind` | 提醒投保 | 弱降水，或 `precip > 0` 但未达到强提醒 |
| `strong` | 强提醒 | 中雨及以上，或降水量达到强提醒阈值 |

文本识别:

- 强提醒关键词: 中雨、小到中雨、中到大雨、大雨、暴雨、大暴雨、特大暴雨、强阵雨、强雷阵雨
- 提醒投保关键词: 小雨、阵雨、雷阵雨、毛毛雨、零星小雨

判定优先级:

1. 如果 `textDay` 或 `textNight` 命中强提醒关键词，返回 `strong`。
2. 如果 `precip >= 10`，返回 `strong`。
3. 如果 `textDay` 或 `textNight` 命中提醒投保关键词，返回 `remind`。
4. 如果 `precip > 0`，返回 `remind`。
5. 否则返回 `none`。

说明: 凡天气文字包含“中雨”及以上强度，均按强提醒处理，包括 `小到中雨` 和 `中到大雨`。

## 雨后湿热机会评分

雨后湿热机会只在“当前日之前1-2天内有降水”时计算。无雨背景下的普通升温仍由现有ADI和升温榜处理，不计入雨后湿热机会。

评分维度:

| 维度 | 分数 |
| --- | --- |
| 前1-2天有降水 | 20 |
| 最高温较最近雨日或前日上升 >= 3℃ | 20 |
| 最高温较最近雨日或前日上升 >= 5℃ | 30 |
| 湿度 >= 70% | 15 |
| 湿度 >= 80% | 25 |
| 白天体感温度 >= 34℃ | 15 |
| 白天体感温度较最近雨日上升 >= 3℃ | 15 |
| ADI较最近雨日或当前基线上升 >= 8 | 15 |
| 夜间最低温 >= 26℃ 或夜间体感 >= 30℃ | 10 |

等级:

| 等级 | 文案 | 分数 |
| --- | --- | --- |
| `high` | 高机会 | >= 70 |
| `medium` | 中机会 | 45-69 |
| `watch` | 观察 | 25-44 |
| `none` | 无明显机会 | < 25 |

原因文案由命中的主要维度拼接，例如:

- “雨后升温4℃，湿度82%，ADI上升10分”
- “前日有雨，今日体感34℃，夜间体感31℃”

## 页面设计

### 独立降水监控页

新增独立TAB页面，位置在"7天预测"下方，页面标识为 `rain-monitor`。

页面布局与7天预测页一致，采用相同的表格和维度切换模式。

### 首页右侧榜单（可选）

为保持与现有UI一致，首页右侧榜单tab中可增加:
- 投保提醒
- 雨后湿热

投保提醒榜排序:

1. `strong` 优先于 `remind`
2. 日期越近越靠前
3. 降水量越大越靠前

雨后湿热榜排序:

1. `postRainMuggyScore` 高者优先
2. 日期越近越靠前
3. ADI较当前提升更高者优先

### 独立降水监控页

维度切换与7天预测页一致，包含以下两个维度:
- 投保提醒
- 雨后湿热

投保提醒维度:

- 固定列显示城市、区域、省份、7天最高投保提醒。
- 日期列显示天气文字、投保等级、降水量。
- Tooltip 显示 `textDay/textNight`、`precip`、投保原因和建议动作。

雨后湿热维度:

- 固定列显示城市、区域、省份、7天最高湿热机会。
- 日期列显示机会等级、机会分、关键原因。
- Tooltip 显示雨日、升温幅度、湿度、体感、ADI变化。

## 代码结构

新增 `js/rain-monitor.js`，以独立对象暴露业务函数:

```js
const RainMonitor = {
  calculateInsuranceReminder(day),
  calculatePostRainMuggy(days, dayIndex),
  enrichFuture7Days(days),
  summarizeRainInsurance(cityData),
  summarizePostRainMuggy(cityData),
  getTopInsuranceCities(cityData, limit),
  getTopPostRainMuggyCities(cityData, limit)
};
```

集成方式:

1. `Core.parseWeatherData()` 解析和风字段到 `future7Days`。
2. `RainMonitor.enrichFuture7Days()` 为每日数据补充投保和湿热机会字段。
3. `Core.generateCityData()` 将城市级汇总字段挂到城市对象。
4. `UI` 读取这些字段渲染独立降水监控页和首页榜单（如启用）。

脚本加载顺序中，`rain-monitor.js` 应在 `core.js` 之前或由 `core.js` 内部检查后调用。如果采用全局对象方式，推荐在 `index-v2.html` 中按 `rain-monitor.js`、`core.js`、`map.js`、`ui.js`、`app.js` 顺序加载。

## 降级和错误处理

- API失败走现有模拟数据时，也生成天气文字、降水量、投保提醒和雨后湿热机会字段。
- `textDay/textNight` 缺失时使用空字符串。
- `precip` 缺失、空字符串或无法解析时按0处理。
- 没有足够前序日期时，雨后湿热机会返回 `none`。
- 页面渲染时如果字段缺失，默认显示“无提醒”或“无明显机会”，不抛错。

## 测试范围

单元级规则测试:

- 小雨、阵雨、雷阵雨触发 `remind`。
- 中雨、大雨、暴雨触发 `strong`。
- `precip > 0` 且无天气文字触发 `remind`。
- `precip >= 10` 触发 `strong`。
- 无雨但升温不触发雨后湿热机会。
- 雨后1-2天升温、高湿、体感升高、ADI上升时触发对应机会等级。

页面验证:

- 首页双卡统计与城市数据一致。
- 首页新增榜单tab可切换且排序正确。
- 7天预测页“投保提醒”和“雨后湿热”两个维度可切换。
- Tooltip 显示降水量、投保原因和湿热原因。
- API失败模拟数据下页面无空字段或控制台错误。

## 验收标准

- 用户能在独立降水监控页按城市和日期查看投保提醒与雨后湿热机会。
- 用户能在首页右侧榜单（如启用）查看降水监控相关的top排行。
- 下雨相关文案只表达”提醒投保”或”强提醒”，不表达”避雨””禁止送货”。
- 现有ADI、地图、热销榜和7天预测原有维度不回归。
