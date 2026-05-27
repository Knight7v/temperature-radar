# 降水监控功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标:** 在现有空调热销区域雷达中增加未来7天降水监控能力，提供降雨投保提醒和雨后湿热销售机会识别。

**架构:** 添加独立的 `RainMonitor` 业务模块，为每个 `future7Days` 条目补充投保提醒和雨后湿热机会字段。保持ADI不变；`Core` 解析和丰富天气数据，`UI` 渲染独立降水监控页（位于7天预测下方）以及降水相关维度和降雨提示内容。

**技术栈:** 原生 HTML/CSS/JavaScript，浏览器全局对象，使用 `node` 进行Node.js规则测试。

**设计文档:** 参考 `/docs/superpowers/specs/2026-05-26-rainfall-monitoring-design.md` 获取完整的数据模型、业务规则和页面设计规范。

---

## File Structure

- Create `js/rain-monitor.js`: pure business rules for rainfall insurance reminders, post-rain humid heat scoring, summaries, and top lists.
- Create `tests/rain-monitor.test.js`: Node-based tests for `RainMonitor` without browser dependencies.
- Modify `index-v2.html`: load `js/rain-monitor.js`, add rain monitor nav item, add report dimension buttons.
- Modify `js/core.js`: parse QWeather rainfall fields, call `RainMonitor.enrichFuture7Days()`, attach city-level rainfall summary fields, and expose top-list helpers.
- Modify `js/ui.js`: render independent rain monitor tab page with dimensions and rainfall tooltip content.
- Modify `css/styles-v2.css`: style rain monitor page, labels, table cells, and responsive layout.

## Task 1: RainMonitor 规则与测试

**数据模型（来自设计规范）:**

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

城市对象增加汇总字段:

```js
{
  maxRainInsuranceLevel: 'none' | 'remind' | 'strong',
  maxPostRainMuggyScore: number,
  maxPostRainMuggyLevel: 'none' | 'watch' | 'medium' | 'high'
}
```

**投保提醒规则（来自设计规范）:**

| 等级 | 文案 | 规则 |
| --- | --- | --- |
| `none` | 无提醒 | 无降水信号，且 `precip <= 0` |
| `remind` | 提醒投保 | 弱降水，或 `precip > 0` 但未达到强提醒 |
| `strong` | 强提醒 | 中雨及以上，或降水量达到强提醒阈值 |

判定优先级:
1. 如果 `textDay` 或 `textNight` 命中强提醒关键词，返回 `strong`
2. 如果 `precip >= 10`，返回 `strong`
3. 如果 `textDay` 或 `textNight` 命中提醒投保关键词，返回 `remind`
4. 如果 `precip > 0`，返回 `remind`
5. 否则返回 `none`

**雨后湿热机会评分（来自设计规范）:**

评分维度（总分100，最低20分起步）:
- 前1-2天有降水: 20分
- 最高温较最近雨日或前日上升 >= 3℃: 20分
- 最高温较最近雨日或前日上升 >= 5℃: 30分
- 湿度 >= 70%: 15分
- 湿度 >= 80%: 25分
- 白天体感温度 >= 34℃: 15分
- 白天体感温度较最近雨日上升 >= 3℃: 15分
- ADI较最近雨日或当前基线上升 >= 8: 15分
- 夜间最低温 >= 26℃ 或夜间体感 >= 30℃: 10分

等级:
| 等级 | 文案 | 分数 |
| --- | --- | --- |
| `high` | 高机会 | >= 70 |
| `medium` | 中机会 | 45-69 |
| `watch` | 观察 | 25-44 |
| `none` | 无明显机会 | < 25 |

**文件:**
- Create: `js/rain-monitor.js`
- Create: `tests/rain-monitor.test.js`

- [ ] **Step 1: Write the failing rule tests**

Create `tests/rain-monitor.test.js`:

```js
const assert = require('node:assert/strict');
const path = require('node:path');

const RainMonitor = require(path.join(__dirname, '..', 'js', 'rain-monitor.js'));

function day(overrides) {
    return {
        date: new Date('2026-05-26'),
        dayMax: 30,
        nightMin: 24,
        dayFeelsLike: 31,
        nightFeelsLike: 25,
        humidity: 60,
        adiScore: 50,
        weatherTextDay: '晴',
        weatherTextNight: '多云',
        precip: 0,
        ...overrides
    };
}

function run(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        throw error;
    }
}

run('small rain reminds insurance purchase', () => {
    const result = RainMonitor.calculateInsuranceReminder(day({ weatherTextDay: '小雨' }));
    assert.equal(result.level, 'remind');
    assert.equal(result.label, '提醒投保');
    assert.match(result.reason, /小雨/);
});

run('moderate rain strongly reminds insurance purchase', () => {
    const result = RainMonitor.calculateInsuranceReminder(day({ weatherTextDay: '中雨' }));
    assert.equal(result.level, 'strong');
    assert.equal(result.label, '强提醒');
    assert.match(result.reason, /中雨/);
});

run('precipitation amount without text reminds insurance purchase', () => {
    const result = RainMonitor.calculateInsuranceReminder(day({ precip: 2.5 }));
    assert.equal(result.level, 'remind');
    assert.equal(result.label, '提醒投保');
    assert.match(result.reason, /2.5mm/);
});

run('precipitation above 10mm strongly reminds insurance purchase', () => {
    const result = RainMonitor.calculateInsuranceReminder(day({ precip: 12 }));
    assert.equal(result.level, 'strong');
    assert.equal(result.label, '强提醒');
    assert.match(result.reason, /12mm/);
});

run('post-rain humid heat requires previous rain', () => {
    const days = [
        day({ weatherTextDay: '晴', dayMax: 29, humidity: 82, adiScore: 50 }),
        day({ weatherTextDay: '晴', dayMax: 35, humidity: 84, dayFeelsLike: 37, nightMin: 27, nightFeelsLike: 31, adiScore: 66 })
    ];
    const result = RainMonitor.calculatePostRainMuggy(days, 1);
    assert.equal(result.level, 'none');
    assert.equal(result.score, 0);
});

run('post-rain humid heat scores high when rain is followed by heat and humidity', () => {
    const days = [
        day({ weatherTextDay: '中雨', dayMax: 29, humidity: 78, dayFeelsLike: 30, adiScore: 50, precip: 11 }),
        day({ weatherTextDay: '晴', dayMax: 35, humidity: 84, dayFeelsLike: 37, nightMin: 27, nightFeelsLike: 31, adiScore: 66 })
    ];
    const enriched = RainMonitor.enrichFuture7Days(days);
    assert.equal(enriched[0].rainInsuranceLevel, 'strong');
    assert.equal(enriched[1].postRainMuggyLevel, 'high');
    assert.ok(enriched[1].postRainMuggyScore >= 70);
    assert.match(enriched[1].postRainMuggyReason, /雨后升温/);
});

run('summaries and top lists include strongest city-day records', () => {
    const cityData = [
        {
            cityName: '广州',
            province: '广东',
            region: '华南',
            adiScore: 80,
            future7Days: RainMonitor.enrichFuture7Days([
                day({ date: new Date('2026-05-26'), weatherTextDay: '大雨', precip: 18 }),
                day({ date: new Date('2026-05-27'), weatherTextDay: '晴', dayMax: 36, humidity: 85, dayFeelsLike: 38, nightMin: 28, nightFeelsLike: 32, adiScore: 72 })
            ])
        },
        {
            cityName: '杭州',
            province: '浙江',
            region: '华东',
            adiScore: 60,
            future7Days: RainMonitor.enrichFuture7Days([
                day({ date: new Date('2026-05-26'), weatherTextDay: '小雨', precip: 2 }),
                day({ date: new Date('2026-05-27'), weatherTextDay: '阴', dayMax: 30, humidity: 65, adiScore: 55 })
            ])
        }
    ];
    const insuranceSummary = RainMonitor.summarizeRainInsurance(cityData);
    const muggySummary = RainMonitor.summarizePostRainMuggy(cityData);
    assert.equal(insuranceSummary.strongCount, 1);
    assert.equal(insuranceSummary.remindCount, 1);
    assert.equal(muggySummary.highCount, 1);
    assert.equal(RainMonitor.getTopInsuranceCities(cityData, 1)[0].cityName, '广州');
    assert.equal(RainMonitor.getTopPostRainMuggyCities(cityData, 1)[0].cityName, '广州');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node tests/rain-monitor.test.js
```

Expected: failure with `Cannot find module '../js/rain-monitor.js'`.

- [ ] **Step 3: Implement `RainMonitor`**

Create `js/rain-monitor.js`:

```js
/**
 * RainMonitor Module - 降雨投保提醒与雨后湿热机会
 */

(function(root, factory) {
    const moduleValue = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = moduleValue;
    }
    root.RainMonitor = moduleValue;
})(typeof window !== 'undefined' ? window : globalThis, function() {
    'use strict';

    const INSURANCE_LEVEL_ORDER = { none: 0, remind: 1, strong: 2 };
    const MUGGY_LEVEL_ORDER = { none: 0, watch: 1, medium: 2, high: 3 };

    const STRONG_RAIN_KEYWORDS = ['中到大雨', '小到中雨', '强雷阵雨', '强阵雨', '特大暴雨', '大暴雨', '暴雨', '大雨', '中雨'];
    const REMIND_RAIN_KEYWORDS = ['零星小雨', '毛毛雨', '雷阵雨', '阵雨', '小雨'];

    const INSURANCE_LABELS = {
        none: '无提醒',
        remind: '提醒投保',
        strong: '强提醒'
    };

    const MUGGY_LABELS = {
        none: '无明显机会',
        watch: '观察',
        medium: '中机会',
        high: '高机会'
    };

    function toNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function combineWeatherText(day) {
        return [day.weatherTextDay, day.weatherTextNight, day.weatherText, day.textDay, day.textNight]
            .filter(Boolean)
            .join(' / ');
    }

    function hasKeyword(text, keywords) {
        return keywords.find(keyword => text.includes(keyword)) || '';
    }

    function formatDate(date) {
        const d = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }

    function calculateInsuranceReminder(day) {
        const text = combineWeatherText(day);
        const precip = toNumber(day.precip, 0);
        const strongKeyword = hasKeyword(text, STRONG_RAIN_KEYWORDS);
        if (strongKeyword) {
            return {
                level: 'strong',
                label: INSURANCE_LABELS.strong,
                reason: `${strongKeyword}，配送照常，强提醒购买送货保险`
            };
        }
        if (precip >= 10) {
            return {
                level: 'strong',
                label: INSURANCE_LABELS.strong,
                reason: `预计降水${precip}mm，配送照常，强提醒购买送货保险`
            };
        }
        const remindKeyword = hasKeyword(text, REMIND_RAIN_KEYWORDS);
        if (remindKeyword) {
            return {
                level: 'remind',
                label: INSURANCE_LABELS.remind,
                reason: `${remindKeyword}，配送照常，提醒购买送货保险`
            };
        }
        if (precip > 0) {
            return {
                level: 'remind',
                label: INSURANCE_LABELS.remind,
                reason: `预计降水${precip}mm，配送照常，提醒购买送货保险`
            };
        }
        return {
            level: 'none',
            label: INSURANCE_LABELS.none,
            reason: '未来该日无明显降水'
        };
    }

    function hadRain(day) {
        return calculateInsuranceReminder(day).level !== 'none';
    }

    function calculatePostRainMuggy(days, dayIndex) {
        const current = days[dayIndex];
        const previousCandidates = [dayIndex - 1, dayIndex - 2]
            .filter(index => index >= 0)
            .map(index => ({ index, day: days[index] }))
            .filter(item => hadRain(item.day));

        if (previousCandidates.length === 0) {
            return {
                score: 0,
                level: 'none',
                label: MUGGY_LABELS.none,
                reason: '前1-2天无降水，未形成雨后湿热信号'
            };
        }

        const rainDay = previousCandidates[0].day;
        const dayMax = toNumber(current.dayMax, toNumber(current.maxTemp, 0));
        const rainDayMax = toNumber(rainDay.dayMax, toNumber(rainDay.maxTemp, dayMax));
        const tempRise = dayMax - rainDayMax;
        const humidity = toNumber(current.humidity, 0);
        const dayFeelsLike = toNumber(current.dayFeelsLike, toNumber(current.feelsLike, dayMax));
        const rainFeelsLike = toNumber(rainDay.dayFeelsLike, toNumber(rainDay.feelsLike, dayFeelsLike));
        const feelsRise = dayFeelsLike - rainFeelsLike;
        const adiScore = toNumber(current.adiScore, 0);
        const rainAdiScore = toNumber(rainDay.adiScore, adiScore);
        const adiRise = adiScore - rainAdiScore;
        const nightMin = toNumber(current.nightMin, toNumber(current.nightMinTemp, 0));
        const nightFeelsLike = toNumber(current.nightFeelsLike, nightMin);

        let score = 20;
        const reasons = ['前1-2天有降水'];

        if (tempRise >= 5) {
            score += 30;
            reasons.push(`雨后升温${tempRise}℃`);
        } else if (tempRise >= 3) {
            score += 20;
            reasons.push(`雨后升温${tempRise}℃`);
        }

        if (humidity >= 80) {
            score += 25;
            reasons.push(`湿度${humidity}%`);
        } else if (humidity >= 70) {
            score += 15;
            reasons.push(`湿度${humidity}%`);
        }

        if (dayFeelsLike >= 34) {
            score += 15;
            reasons.push(`体感${dayFeelsLike}℃`);
        }
        if (feelsRise >= 3) {
            score += 15;
            reasons.push(`体感上升${feelsRise}℃`);
        }
        if (adiRise >= 8) {
            score += 15;
            reasons.push(`ADI上升${adiRise}分`);
        }
        if (nightMin >= 26 || nightFeelsLike >= 30) {
            score += 10;
            reasons.push(`夜间${nightMin}℃/体感${nightFeelsLike}℃`);
        }

        const cappedScore = Math.min(score, 100);
        let level = 'none';
        if (cappedScore >= 70) level = 'high';
        else if (cappedScore >= 45) level = 'medium';
        else if (cappedScore >= 25) level = 'watch';

        return {
            score: cappedScore,
            level,
            label: MUGGY_LABELS[level],
            reason: level === 'none' ? '雨后湿热信号不足' : reasons.join('，'),
            rainDate: formatDate(rainDay.date),
            tempRise,
            adiRise
        };
    }

    function enrichFuture7Days(days) {
        const normalized = (days || []).map(day => {
            const insurance = calculateInsuranceReminder(day);
            return {
                ...day,
                weatherTextDay: day.weatherTextDay || day.textDay || '',
                weatherTextNight: day.weatherTextNight || day.textNight || '',
                weatherText: day.weatherText || combineWeatherText(day) || '无明显降水',
                precip: toNumber(day.precip, 0),
                rainInsuranceLevel: insurance.level,
                rainInsuranceLabel: insurance.label,
                rainInsuranceReason: insurance.reason
            };
        });

        return normalized.map((day, index) => {
            const muggy = calculatePostRainMuggy(normalized, index);
            return {
                ...day,
                postRainMuggyScore: muggy.score,
                postRainMuggyLevel: muggy.level,
                postRainMuggyLabel: muggy.label,
                postRainMuggyReason: muggy.reason,
                postRainMuggyRainDate: muggy.rainDate || '',
                postRainMuggyTempRise: muggy.tempRise || 0,
                postRainMuggyAdiRise: muggy.adiRise || 0
            };
        });
    }

    function flattenCityDays(cityDataList) {
        return (cityDataList || []).flatMap(city => (city.future7Days || []).map((day, index) => ({
            cityName: city.cityName,
            province: city.province,
            region: city.region,
            adiScore: city.adiScore,
            day,
            dayIndex: index
        })));
    }

    function summarizeRainInsurance(cityDataList) {
        const records = getTopInsuranceCities(cityDataList, 999);
        return {
            strongCount: records.filter(record => record.day.rainInsuranceLevel === 'strong').length,
            remindCount: records.filter(record => record.day.rainInsuranceLevel === 'remind').length,
            topRecords: records.slice(0, 3)
        };
    }

    function summarizePostRainMuggy(cityDataList) {
        const records = getTopPostRainMuggyCities(cityDataList, 999);
        return {
            highCount: records.filter(record => record.day.postRainMuggyLevel === 'high').length,
            mediumCount: records.filter(record => record.day.postRainMuggyLevel === 'medium').length,
            watchCount: records.filter(record => record.day.postRainMuggyLevel === 'watch').length,
            topRecords: records.slice(0, 3)
        };
    }

    function getTopInsuranceCities(cityDataList, limit) {
        return flattenCityDays(cityDataList)
            .filter(record => record.day.rainInsuranceLevel && record.day.rainInsuranceLevel !== 'none')
            .sort((a, b) => {
                // 1. `strong` 优先于 `remind`
                const levelDiff = INSURANCE_LEVEL_ORDER[b.day.rainInsuranceLevel] - INSURANCE_LEVEL_ORDER[a.day.rainInsuranceLevel];
                if (levelDiff !== 0) return levelDiff;
                // 2. 日期越近越靠前
                if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
                // 3. 降水量越大越靠前
                return toNumber(b.day.precip, 0) - toNumber(a.day.precip, 0);
            })
            .slice(0, limit || 10);
    }

    function getTopPostRainMuggyCities(cityDataList, limit) {
        return flattenCityDays(cityDataList)
            .filter(record => record.day.postRainMuggyLevel && record.day.postRainMuggyLevel !== 'none')
            .sort((a, b) => {
                // 1. `postRainMuggyScore` 高者优先
                const scoreDiff = toNumber(b.day.postRainMuggyScore, 0) - toNumber(a.day.postRainMuggyScore, 0);
                if (scoreDiff !== 0) return scoreDiff;
                // 2. 日期越近越靠前
                if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
                // 3. ADI较当前提升更高者优先
                return toNumber(b.day.postRainMuggyAdiRise, 0) - toNumber(a.day.postRainMuggyAdiRise, 0);
            })
            .slice(0, limit || 10);
    }

    function getMaxRainInsuranceLevel(days) {
        return (days || []).reduce((max, day) => (
            INSURANCE_LEVEL_ORDER[day.rainInsuranceLevel] > INSURANCE_LEVEL_ORDER[max] ? day.rainInsuranceLevel : max
        ), 'none');
    }

    function getMaxPostRainMuggyLevel(days) {
        return (days || []).reduce((max, day) => (
            MUGGY_LEVEL_ORDER[day.postRainMuggyLevel] > MUGGY_LEVEL_ORDER[max] ? day.postRainMuggyLevel : max
        ), 'none');
    }

    return {
        INSURANCE_LABELS,
        MUGGY_LABELS,
        calculateInsuranceReminder,
        calculatePostRainMuggy,
        enrichFuture7Days,
        summarizeRainInsurance,
        summarizePostRainMuggy,
        getTopInsuranceCities,
        getTopPostRainMuggyCities,
        getMaxRainInsuranceLevel,
        getMaxPostRainMuggyLevel
    };
});
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
node tests/rain-monitor.test.js
```

Expected: all lines begin with `PASS`, and the process exits with code `0`.

- [ ] **Step 5: Commit**

Run:

```bash
git add js/rain-monitor.js tests/rain-monitor.test.js
git commit -m "feat: add rainfall monitoring rules"
```

Expected: commit succeeds with two files.

## Task 2: Core Data Enrichment

**Files:**
- Modify: `index-v2.html`
- Modify: `js/core.js`
- Test: `tests/rain-monitor.test.js`

- [ ] **Step 1: Write failing integration assertions**

Append this block to `tests/rain-monitor.test.js`:

```js
run('enriched future days expose all UI fields', () => {
    const enriched = RainMonitor.enrichFuture7Days([
        day({ weatherTextDay: '小雨', weatherTextNight: '阴', precip: '1.5' }),
        day({ weatherTextDay: '晴', weatherTextNight: '晴', dayMax: 34, humidity: 81, dayFeelsLike: 36, adiScore: 64 })
    ]);
    assert.equal(enriched[0].weatherTextDay, '小雨');
    assert.equal(enriched[0].weatherTextNight, '阴');
    assert.equal(enriched[0].weatherText.includes('小雨'), true);
    assert.equal(enriched[0].precip, 1.5);
    assert.equal(enriched[0].rainInsuranceLabel, '提醒投保');
    assert.equal(typeof enriched[1].postRainMuggyReason, 'string');
    assert.equal(typeof enriched[1].postRainMuggyScore, 'number');
});
```

- [ ] **Step 2: Run tests and verify current rules still pass**

Run:

```bash
node tests/rain-monitor.test.js
```

Expected: PASS. This test validates the module contract before `Core` uses it.

- [ ] **Step 3: Load `rain-monitor.js` before `core.js`**

In `index-v2.html`, update the script block near the end to include `rain-monitor.js` before `core.js`:

```html
<!-- Scripts -->
<script src="js/rain-monitor.js"></script>
<script src="js/core.js"></script>
<script src="js/china-geo.js"></script>
<script src="js/map.js"></script>
<script src="js/ui.js"></script>
<script src="js/auth.js"></script>
<script src="js/payment.js"></script>
<script src="js/ads.js"></script>
<script src="js/test-mode.js"></script>
<script src="js/app.js"></script>
```

- [ ] **Step 4: Update QWeather parsing in `Core.parseWeatherData()`**

Inside `future7Days.push({ ... })`, include QWeather rainfall fields:

```js
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
```

After the `for` loop that builds `future7Days`, add:

```js
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
```

In the returned city object, replace `future7Days` with:

```js
future7Days: enrichedFuture7Days,
maxRainInsuranceLevel,
maxPostRainMuggyLevel,
maxPostRainMuggyScore,
```

- [ ] **Step 5: Update simulated fallback data**

In `generate7DayDailyData(baseCityData, dayIndex)`, before returning the object, define deterministic simulated weather:

```js
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
```

Add these fields to the returned daily object:

```js
weatherTextDay,
weatherTextNight,
weatherText: [weatherTextDay, weatherTextNight].filter(Boolean).join(' / '),
precip
```

In `generateCityData()` simulated path, after building `future7Days`, add:

```js
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
```

Return `future7Days: enrichedFuture7Days` and the three city-level summary fields.

- [ ] **Step 6: Expose top-list helpers from `Core`**

Before the public API return in `js/core.js`, add:

```js
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
```

Add these functions to the returned `Core` API:

```js
getTopRainInsurance,
getTopPostRainMuggy,
summarizeRainInsurance,
summarizePostRainMuggy,
```

- [ ] **Step 7: Verify tests and browser globals**

Run:

```bash
node tests/rain-monitor.test.js
python3 -m http.server 8080
```

Expected: Node tests pass. The server starts and prints `Serving HTTP on`.

Open `http://localhost:8080/index-v2.html` in the browser and run in DevTools console:

```js
Boolean(window.RainMonitor) && Boolean(window.Core)
```

Expected: `true`.

- [ ] **Step 8: Commit**

Run:

```bash
git add index-v2.html js/core.js tests/rain-monitor.test.js
git commit -m "feat: enrich weather data with rainfall signals"
```

Expected: commit succeeds with core integration changes.

## Task 3: 独立降水监控页（核心功能）

**设计说明:** 新增独立TAB页面，位置在"7天预测"下方，页面标识为 `rain-monitor`。页面布局与7天预测页一致，采用相同的表格和维度切换模式。包含"投保提醒"和"雨后湿热"两个维度。

**文件:**
- Modify: `index-v2.html`
- Modify: `js/ui.js`
- Modify: `css/styles-v2.css`

- [ ] **Step 1: Add rain monitor nav item**

In `index-v2.html`, inside `.nav-menu` and after the `report` nav-item, add:

```html
<div class="nav-item" data-page="rainMonitor">
    <span class="nav-icon">🌧️</span>
    <span class="nav-text">降水监控</span>
</div>
```

- [ ] **Step 2: Add rain monitor page container**

After the `report-page-container` section, add:

```html
<!-- Rain Monitor Page -->
<div class="page-container" id="rainMonitorPage" style="display: none;">
    <div class="page-header">
        <h2>降水监控</h2>
        <p class="page-subtitle">降雨投保提醒与雨后湿热机会</p>
    </div>
    <div class="section-header">
        <h3>未来7天降水监控</h3>
        <div class="dimension-toggle">
            <button class="dimension-btn active" data-dimension="rainInsurance">投保提醒</button>
            <button class="dimension-btn" data-dimension="postRainMuggy">雨后湿热</button>
        </div>
    </div>
    <div class="forecast-section">
        <div class="forecast-table-container">
            <table class="forecast-table" id="rainForecastTable">
                <thead></thead>
                <tbody></tbody>
            </table>
        </div>
    </div>
</div>
```

- [ ] **Step 3: Route rain monitor page**

In `js/ui.js`, add case to the page routing function (where `switch(page)` handles nav pages):

```js
case 'rainMonitor':
    renderRainMonitorPage();
    break;
```

- [ ] **Step 4: Implement rain monitor page renderer**

Add this function near other page renderers:

```js
function renderRainMonitorPage() {
    const tableHead = document.querySelector('#rainForecastTable thead');
    const tableBody = document.querySelector('#rainForecastTable tbody');
    if (!tableHead || !tableBody) return;

    const currentDimension = document.querySelector('#rainMonitorPage .dimension-btn.active')?.dataset.dimension || 'rainInsurance';
    const cities = state.cityData;

    switch (currentDimension) {
    case 'rainInsurance':
        renderReportRainInsurance(cities, tableHead, tableBody);
        break;
    case 'postRainMuggy':
        renderReportPostRainMuggy(cities, tableHead, tableBody);
        break;
    }

    bindTooltipEvents(tableBody);
}
```

- [ ] **Step 5: Bind dimension toggle on rain monitor page**

In the dimension toggle binding section, add handling for rain monitor page:

```js
document.querySelectorAll('.dimension-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const parentPage = this.closest('.page-container');
        if (parentPage) {
            parentPage.querySelectorAll('.dimension-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            if (parentPage.id === 'rainMonitorPage') {
                renderRainMonitorPage();
            }
        }
    });
});
```

- [ ] **Step 6: Verify rain monitor page**

Run:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/index-v2.html`, click "降水监控" nav item, and verify:
- Page loads without console errors.
- "投保提醒" dimension renders by default.
- Clicking "雨后湿热" dimension switches table content.
- Hovering cells shows tooltip with rainfall information.

- [ ] **Step 7: Commit**

Run:

```bash
git add index-v2.html js/ui.js
git commit -m "feat: add independent rain monitor tab page"
```

Expected: commit succeeds.

## Task 4: 首页右侧榜单（可选）

**设计说明:** 为保持与现有UI一致，首页右侧榜单tab中可增加投保提醒和雨后湿热榜单。此功能为可选功能，不影响核心降水监控页面的使用。如无需首页榜单，可跳过此任务。

**文件:**
- Modify: `index-v2.html`
- Modify: `js/ui.js`
- Modify: `css/styles-v2.css`

**排序规则（来自设计规范）:**

投保提醒榜排序:
1. `strong` 优先于 `remind`
2. 日期越近越靠前
3. 降水量越大越靠前

雨后湿热榜排序:
1. `postRainMuggyScore` 高者优先
2. 日期越近越靠前
3. ADI较当前提升更高者优先

- [ ] **Step 1: Add dashboard card containers**

In `index-v2.html`, inside `<div class="map-section">` and before `<div class="section-header">`, add:

```html
<div class="rain-summary-grid">
    <div class="rain-summary-card insurance-card" id="rainInsuranceSummary">
        <div class="rain-summary-header">降雨投保提醒</div>
        <div class="rain-summary-body">--</div>
    </div>
    <div class="rain-summary-card muggy-card" id="postRainMuggySummary">
        <div class="rain-summary-header">雨后湿热机会</div>
        <div class="rain-summary-body">--</div>
    </div>
</div>
```

Inside `#topTabs`, add two buttons after `heatRise`:

```html
<button class="top-tab" data-tab="rainInsurance">投保提醒</button>
<button class="top-tab" data-tab="postRainMuggy">雨后湿热</button>
```

- [ ] **Step 2: Render dashboard cards**

In `js/ui.js`, update `renderDashboard(cityData)` to call the new renderer after `renderLongestHotNight();`:

```js
renderRainSummaries();
```

Add this function near the dashboard render helpers:

```js
function renderRainSummaries() {
    const insuranceEl = document.querySelector('#rainInsuranceSummary .rain-summary-body');
    const muggyEl = document.querySelector('#postRainMuggySummary .rain-summary-body');
    if (!insuranceEl || !muggyEl) return;

    const insurance = Core.summarizeRainInsurance(state.cityData);
    const muggy = Core.summarizePostRainMuggy(state.cityData);

    insuranceEl.innerHTML = `
        <div class="rain-summary-main">${escapeHtml(String(insurance.strongCount + insurance.remindCount))}<span>城</span></div>
        <div class="rain-summary-tags">
            <span class="rain-tag strong">强提醒 ${escapeHtml(String(insurance.strongCount))}</span>
            <span class="rain-tag remind">提醒投保 ${escapeHtml(String(insurance.remindCount))}</span>
        </div>
        <div class="rain-summary-list">
            ${insurance.topRecords.length ? insurance.topRecords.map(record => `
                <div>${escapeHtml(record.cityName)} ${escapeHtml(record.day.rainInsuranceLabel)}：${escapeHtml(record.day.rainInsuranceReason)}</div>
            `).join('') : '<div>未来7天暂无降雨投保提醒</div>'}
        </div>
    `;

    muggyEl.innerHTML = `
        <div class="rain-summary-main">${escapeHtml(String(muggy.highCount + muggy.mediumCount))}<span>城</span></div>
        <div class="rain-summary-tags">
            <span class="rain-tag high">高机会 ${escapeHtml(String(muggy.highCount))}</span>
            <span class="rain-tag medium">中机会 ${escapeHtml(String(muggy.mediumCount))}</span>
        </div>
        <div class="rain-summary-list">
            ${muggy.topRecords.length ? muggy.topRecords.map(record => `
                <div>${escapeHtml(record.cityName)} ${escapeHtml(record.day.postRainMuggyLabel)}：${escapeHtml(record.day.postRainMuggyReason)}</div>
            `).join('') : '<div>未来7天暂无雨后湿热机会</div>'}
        </div>
    `;
}
```

- [ ] **Step 3: Route new top tabs**

In `renderTopCities()`, add cases:

```js
case 'rainInsurance':
    renderRainInsuranceTab(container);
    break;
case 'postRainMuggy':
    renderPostRainMuggyTab(container);
    break;
```

Add these functions after `renderHeatRiseTab(container)`:

```js
function renderRainInsuranceTab(container) {
    const records = Core.getTopRainInsurance(state.cityData, 10);
    container.innerHTML = records.length ? records.map((record, i) => {
        const rankClass = i < 3 ? `rank-${i + 1}` : '';
        return `
            <div class="top-city-item" data-city="${escapeHtml(record.cityName)}">
                <span class="top-city-rank ${rankClass}">${escapeHtml(String(i + 1))}</span>
                <div class="top-city-info-main">
                    <div class="top-city-name">${escapeHtml(record.cityName)} <span class="rain-mini-badge insurance-${escapeHtml(record.day.rainInsuranceLevel)}">${escapeHtml(record.day.rainInsuranceLabel)}</span></div>
                    <div class="top-city-meta">${escapeHtml(record.day.weatherText)}｜降水${escapeHtml(String(record.day.precip))}mm｜${escapeHtml(record.day.rainInsuranceReason)}</div>
                </div>
                <span class="top-city-adi-badge" style="color: ${record.day.rainInsuranceLevel === 'strong' ? '#ff6b35' : '#f5a623'}">${escapeHtml(record.day.rainInsuranceLevel === 'strong' ? '强' : '保')}</span>
            </div>
        `;
    }).join('') : '<div class="empty-list">未来7天暂无投保提醒</div>';
}

function renderPostRainMuggyTab(container) {
    const records = Core.getTopPostRainMuggy(state.cityData, 10);
    container.innerHTML = records.length ? records.map((record, i) => {
        const rankClass = i < 3 ? `rank-${i + 1}` : '';
        return `
            <div class="top-city-item" data-city="${escapeHtml(record.cityName)}">
                <span class="top-city-rank ${rankClass}">${escapeHtml(String(i + 1))}</span>
                <div class="top-city-info-main">
                    <div class="top-city-name">${escapeHtml(record.cityName)} <span class="rain-mini-badge muggy-${escapeHtml(record.day.postRainMuggyLevel)}">${escapeHtml(record.day.postRainMuggyLabel)}</span></div>
                    <div class="top-city-meta">机会分${escapeHtml(String(record.day.postRainMuggyScore))}｜${escapeHtml(record.day.postRainMuggyReason)}</div>
                </div>
                <span class="top-city-adi-badge" style="color: #2ecc71">${escapeHtml(String(record.day.postRainMuggyScore))}</span>
            </div>
        `;
    }).join('') : '<div class="empty-list">未来7天暂无雨后湿热机会</div>';
}
```

- [ ] **Step 4: Add dashboard and badge styles**

Append to `css/styles-v2.css`:

```css
.rain-summary-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 12px;
}

.rain-summary-card {
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(10, 14, 39, 0.82);
    border-radius: 8px;
    padding: 14px;
    min-height: 138px;
}

.rain-summary-header {
    color: var(--text-secondary);
    font-size: 0.82rem;
    margin-bottom: 6px;
}

.rain-summary-main {
    color: var(--text-primary);
    font-family: 'Orbitron', sans-serif;
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
}

.rain-summary-main span {
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.85rem;
    margin-left: 4px;
}

.rain-summary-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 10px 0;
}

.rain-tag,
.rain-mini-badge {
    border-radius: 4px;
    color: #fff;
    display: inline-flex;
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1;
    padding: 4px 7px;
}

.rain-tag.strong,
.rain-mini-badge.insurance-strong { background: #C2410C; }
.rain-tag.remind,
.rain-mini-badge.insurance-remind { background: #B45309; }
.rain-tag.high,
.rain-mini-badge.muggy-high { background: #15803D; }
.rain-tag.medium,
.rain-mini-badge.muggy-medium { background: #16A34A; }
.rain-mini-badge.muggy-watch { background: #4D7C0F; }

.rain-summary-list {
    color: var(--text-secondary);
    display: grid;
    gap: 4px;
    font-size: 0.72rem;
    line-height: 1.35;
}

.empty-list {
    color: var(--text-secondary);
    font-size: 0.82rem;
    padding: 16px 0;
    text-align: center;
}

@media (max-width: 1200px) {
    .rain-summary-grid {
        grid-template-columns: 1fr;
    }
}
```

- [ ] **Step 5: Verify dashboard UI**

Run:

```bash
python3 -m http.server 8080
```

Expected: server starts.

Open `http://localhost:8080/index-v2.html`, wait for data, and verify:

- Two dashboard cards appear above the map.
- Top tabs include `投保提醒` and `雨后湿热`.
- Clicking each new top tab changes the right list without console errors.

- [ ] **Step 6: Commit**

Run:

```bash
git add index-v2.html js/ui.js css/styles-v2.css
git commit -m "feat: show rainfall summaries on dashboard"
```

Expected: commit succeeds.

## Task 5: 7天预测报表维度和提示信息

**设计说明:** 在现有7天预测报表中增加"投保提醒"和"雨后湿热"两个维度，并在提示信息中显示降雨相关数据。

**文件:**
- Modify: `index-v2.html`
- Modify: `js/ui.js`
- Modify: `css/styles-v2.css`

- [ ] **Step 1: Add report dimension buttons**

In `index-v2.html`, inside `.dimension-toggle`, add:

```html
<button class="dimension-btn" data-dimension="rainInsurance">投保提醒</button>
<button class="dimension-btn" data-dimension="postRainMuggy">雨后湿热</button>
```

- [ ] **Step 2: Route report renderers**

In `renderReport()`, add cases:

```js
case 'rainInsurance':
    renderReportRainInsurance(cities, thead, tbody);
    break;
case 'postRainMuggy':
    renderReportPostRainMuggy(cities, thead, tbody);
    break;
```

- [ ] **Step 3: Add shared report header helper**

Near `renderReportTemperature`, add:

```js
function buildSevenDayHeader(cities, metricColumns) {
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const sampleDates = cities.length > 0 && cities[0].future7Days ? cities[0].future7Days : [];
    let headerHtml = metricColumns;
    for (let i = 0; i < 7; i++) {
        const date = sampleDates[i] ? sampleDates[i].date : new Date();
        headerHtml += `
            <th>
                <div class="date-header">
                    <span class="date-header-day">${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}</span>
                </div>
            </th>
        `;
    }
    return headerHtml;
}
```

- [ ] **Step 4: Add insurance report renderer**

Add after `renderReportADI`:

```js
function renderReportRainInsurance(cities, thead, tbody) {
    thead.innerHTML = buildSevenDayHeader(cities, `
        <th class="fixed-left">区域</th>
        <th class="fixed-left">省份</th>
        <th class="fixed-left">城市</th>
        <th class="fixed-left">最高提醒</th>
        <th class="fixed-left">提醒天数</th>
        <th class="fixed-left">强提醒天数</th>
        <th class="fixed-left">最近提醒</th>
        <th class="fixed-left">动作</th>
        <th class="fixed-left">说明</th>
    `);

    if (cities.length === 0) {
        tbody.innerHTML = '<tr><td colspan="16" class="forecast-empty-state"><div class="forecast-empty-icon">🔍</div><div>未找到匹配的城市</div></td></tr>';
        return;
    }

    tbody.innerHTML = cities.map(city => {
        const remindDays = city.future7Days.filter(day => day.rainInsuranceLevel !== 'none');
        const strongDays = city.future7Days.filter(day => day.rainInsuranceLevel === 'strong');
        const topDay = remindDays[0];
        let rowHtml = `
            <td class="fixed-left">${escapeHtml(city.region)}</td>
            <td class="fixed-left">${escapeHtml(city.province)}</td>
            <td class="fixed-left">${escapeHtml(city.cityName)}</td>
            <td class="fixed-left"><span class="rain-mini-badge insurance-${escapeHtml(city.maxRainInsuranceLevel || 'none')}">${escapeHtml(topDay ? topDay.rainInsuranceLabel : '无提醒')}</span></td>
            <td class="fixed-left">${escapeHtml(String(remindDays.length))}天</td>
            <td class="fixed-left">${escapeHtml(String(strongDays.length))}天</td>
            <td class="fixed-left">${escapeHtml(topDay ? topDay.weatherText : '-')}</td>
            <td class="fixed-left">配送照常</td>
            <td class="fixed-left">下雨提醒投保</td>
        `;
        city.future7Days.forEach((day, idx) => {
            rowHtml += `
                <td class="rain-report-cell rain-insurance-${escapeHtml(day.rainInsuranceLevel || 'none')}" data-city="${escapeHtml(city.cityName)}" data-day="${idx}">
                    <div>
                        <div class="rain-cell-main">${escapeHtml(day.rainInsuranceLabel || '无提醒')}</div>
                        <div class="rain-cell-sub">${escapeHtml(day.weatherText || '无明显降水')}</div>
                        <div class="rain-cell-sub">${escapeHtml(String(day.precip || 0))}mm</div>
                    </div>
                </td>
            `;
        });
        return `<tr>${rowHtml}</tr>`;
    }).join('');
}
```

- [ ] **Step 5: Add post-rain muggy report renderer**

Add after `renderReportRainInsurance`:

```js
function renderReportPostRainMuggy(cities, thead, tbody) {
    thead.innerHTML = buildSevenDayHeader(cities, `
        <th class="fixed-left">区域</th>
        <th class="fixed-left">省份</th>
        <th class="fixed-left">城市</th>
        <th class="fixed-left">最高机会</th>
        <th class="fixed-left">最高分</th>
        <th class="fixed-left">机会天数</th>
        <th class="fixed-left">今日ADI</th>
        <th class="fixed-left">动作</th>
        <th class="fixed-left">说明</th>
    `);

    if (cities.length === 0) {
        tbody.innerHTML = '<tr><td colspan="16" class="forecast-empty-state"><div class="forecast-empty-icon">🔍</div><div>未找到匹配的城市</div></td></tr>';
        return;
    }

    tbody.innerHTML = cities.map(city => {
        const opportunityDays = city.future7Days.filter(day => day.postRainMuggyLevel !== 'none');
        const maxScore = Math.max(0, ...city.future7Days.map(day => day.postRainMuggyScore || 0));
        let rowHtml = `
            <td class="fixed-left">${escapeHtml(city.region)}</td>
            <td class="fixed-left">${escapeHtml(city.province)}</td>
            <td class="fixed-left">${escapeHtml(city.cityName)}</td>
            <td class="fixed-left"><span class="rain-mini-badge muggy-${escapeHtml(city.maxPostRainMuggyLevel || 'none')}">${escapeHtml(opportunityDays[0] ? opportunityDays[0].postRainMuggyLabel : '无明显机会')}</span></td>
            <td class="fixed-left">${escapeHtml(String(maxScore))}</td>
            <td class="fixed-left">${escapeHtml(String(opportunityDays.length))}天</td>
            <td class="fixed-left">${escapeHtml(String(city.adiScore))}</td>
            <td class="fixed-left">销售跟进</td>
            <td class="fixed-left">雨后升温高湿</td>
        `;
        city.future7Days.forEach((day, idx) => {
            rowHtml += `
                <td class="rain-report-cell rain-muggy-${escapeHtml(day.postRainMuggyLevel || 'none')}" data-city="${escapeHtml(city.cityName)}" data-day="${idx}">
                    <div>
                        <div class="rain-cell-main">${escapeHtml(day.postRainMuggyLabel || '无明显机会')}</div>
                        <div class="rain-cell-sub">${escapeHtml(String(day.postRainMuggyScore || 0))}分</div>
                        <div class="rain-cell-sub">${escapeHtml(day.postRainMuggyTempRise > 0 ? '+' + day.postRainMuggyTempRise + '℃' : '-')}</div>
                    </div>
                </td>
            `;
        });
        return `<tr>${rowHtml}</tr>`;
    }).join('');
}
```

- [ ] **Step 6: Extend tooltip content**

In `showDayTooltip(city, dayData, dayIndex)`, add these rows before the ADI row:

```js
<div class="forecast-tooltip-row"><span>天气:</span><span>${escapeHtml(dayData.weatherText || '无明显降水')}</span></div>
<div class="forecast-tooltip-row"><span>降水量:</span><span>${escapeHtml(String(dayData.precip || 0))}mm</span></div>
<div class="forecast-tooltip-row"><span>投保提醒:</span><span>${escapeHtml(dayData.rainInsuranceLabel || '无提醒')}</span></div>
<div class="forecast-tooltip-row"><span>投保原因:</span><span>${escapeHtml(dayData.rainInsuranceReason || '未来该日无明显降水')}</span></div>
<div class="forecast-tooltip-row"><span>湿热机会:</span><span>${escapeHtml(dayData.postRainMuggyLabel || '无明显机会')} ${escapeHtml(String(dayData.postRainMuggyScore || 0))}分</span></div>
<div class="forecast-tooltip-row"><span>湿热原因:</span><span>${escapeHtml(dayData.postRainMuggyReason || '雨后湿热信号不足')}</span></div>
```

- [ ] **Step 7: Add report cell styles**

Append to `css/styles-v2.css`:

```css
.rain-report-cell {
    min-width: 112px;
    text-align: center;
}

.rain-cell-main {
    font-size: 0.76rem;
    font-weight: 700;
}

.rain-cell-sub {
    color: rgba(255, 255, 255, 0.68);
    font-size: 0.66rem;
    line-height: 1.25;
}

.rain-insurance-strong { background: rgba(194, 65, 12, 0.24); }
.rain-insurance-remind { background: rgba(180, 83, 9, 0.18); }
.rain-insurance-none { background: rgba(255, 255, 255, 0.02); }

.rain-muggy-high { background: rgba(21, 128, 61, 0.26); }
.rain-muggy-medium { background: rgba(22, 163, 74, 0.18); }
.rain-muggy-watch { background: rgba(77, 124, 15, 0.16); }
.rain-muggy-none { background: rgba(255, 255, 255, 0.02); }
```

- [ ] **Step 8: Verify report dimensions**

Run:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/index-v2.html`, go to `7天预测`, and verify:

- `投保提醒` dimension renders a 7-day table.
- `雨后湿热` dimension renders a 7-day table.
- Hovering a date cell shows rainfall rows in the tooltip.
- No visible table columns overlap at desktop width.

- [ ] **Step 9: Commit**

Run:

```bash
git add index-v2.html js/ui.js css/styles-v2.css
git commit -m "feat: add rainfall dimensions to forecast table"
```

Expected: commit succeeds.

## Task 6: 最终验证与完善

**Files:**
- Modify if verification exposes issues: `css/styles-v2.css`, `js/ui.js`, `js/core.js`, `js/rain-monitor.js`

- [ ] **Step 1: Run rule tests**

Run:

```bash
node tests/rain-monitor.test.js
```

Expected: all tests pass.

- [ ] **Step 2: Start local server**

Run:

```bash
python3 -m http.server 8080
```

Expected: server starts at `http://localhost:8080/`.

- [ ] **Step 3: Browser smoke test dashboard**

Open `http://localhost:8080/index-v2.html` and verify:

- Loading screen hides after data loads.
- Dashboard cards show either real counts or empty states.
- `投保提醒` top tab does not show “避雨”, “禁止送货”, or “延期”.
- `雨后湿热` top tab lists records with score and reason when simulated data contains matching cases.

- [ ] **Step 4: 浏览器报表页面验证**

Open `7天预测` and verify:

- Existing dimensions `高低温度`, `高低体感温度`, and `ADI指数` still render.
- New dimensions `投保提醒` and `雨后湿热` render.
- Tooltip rows show weather text, precipitation, insurance reason, and humid heat reason.

**验收标准检查（来自设计规范）:**
- 用户能在独立降水监控页按城市和日期查看投保提醒与雨后湿热机会。
- 用户能在首页右侧榜单（如启用）查看降水监控相关的top排行。
- 下雨相关文案只表达"提醒投保"或"强提醒"，不表达"避雨"、"禁止送货"。
- 现有ADI、地图、热销榜和7天预测原有维度不回归。

- [ ] **Step 5: 检查禁用配送文案**

根据设计规范的非目标要求，降雨相关文案只表达"提醒投保"或"强提醒"，不表达"避雨"、"禁止送货"、"延期配送"或"停止配送"。

Run:

```bash
rg -n "避雨|禁止送货|延期配送|停止配送" index-v2.html js css
```

Expected: 在面向用户的降雨功能代码中无匹配结果。现有设计规范文件可能包含这些词汇（在非目标描述中），但应用代码不应包含。

- [ ] **Step 6: 提交最终修复**

If files changed during verification, run:

```bash
git add index-v2.html js/core.js js/rain-monitor.js js/ui.js css/styles-v2.css tests/rain-monitor.test.js
git commit -m "fix: 完善降水监控功能体验"
```

Expected: commit succeeds only if verification required fixes. If there are no fixes, skip this commit and record that no final commit was needed.

## 自我审查

- **设计规范覆盖:** 任务涵盖了独立 RainMonitor 模型、和风天气字段解析、模拟降级数据、首页双卡（可选）、首页榜单（可选）、7天预测报表维度、提示信息行、文案约束和浏览器验证。完整设计规范参见 `/docs/superpowers/specs/2026-05-26-rainfall-monitoring-design.md`。
- **占位符检查:** 计划中无未解决的占位符标记或模糊实现步骤。
- **类型一致性:** `rainInsuranceLevel`、`rainInsuranceLabel`、`rainInsuranceReason`、`postRainMuggyScore`、`postRainMuggyLevel`、`postRainMuggyLabel` 和 `postRainMuggyReason` 与批准的设计规范一致，并在所有任务中保持一致使用。
- **非目标遵守:** 实现避免了设计规范中列出的非目标功能（物流排班日历、配送判断、仓库配置、保险购买流程、ADI等级体系变更）。
- **文案约束:** 所有降雨相关文案只表达"提醒投保"或"强提醒"，不表达"避雨"、"禁止送货"、"延期配送"或"停止配送"。
