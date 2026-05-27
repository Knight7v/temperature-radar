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

run('小雨触发提醒投保', () => {
    const result = RainMonitor.calculateInsuranceReminder(day({ weatherTextDay: '小雨' }));
    assert.equal(result.level, 'remind');
    assert.equal(result.label, '提醒投保');
    assert.match(result.reason, /小雨/);
});

run('中雨触发强提醒', () => {
    const result = RainMonitor.calculateInsuranceReminder(day({ weatherTextDay: '中雨' }));
    assert.equal(result.level, 'strong');
    assert.equal(result.label, '强提醒');
    assert.match(result.reason, /中雨/);
});

run('有降水量无天气文字触发提醒投保', () => {
    const result = RainMonitor.calculateInsuranceReminder(day({ precip: 2.5 }));
    assert.equal(result.level, 'remind');
    assert.equal(result.label, '提醒投保');
    assert.match(result.reason, /2.5mm/);
});

run('降水量超过10mm触发强提醒', () => {
    const result = RainMonitor.calculateInsuranceReminder(day({ precip: 12 }));
    assert.equal(result.level, 'strong');
    assert.equal(result.label, '强提醒');
    assert.match(result.reason, /12mm/);
});

run('雨后湿热需要前面有雨', () => {
    const days = [
        day({ weatherTextDay: '晴', dayMax: 29, humidity: 82, adiScore: 50 }),
        day({ weatherTextDay: '晴', dayMax: 35, humidity: 84, dayFeelsLike: 37, nightMin: 27, nightFeelsLike: 31, adiScore: 66 })
    ];
    const result = RainMonitor.calculatePostRainMuggy(days, 1);
    assert.equal(result.level, 'none');
    assert.equal(result.score, 0);
});

run('雨后升温高湿时触发高湿热机会', () => {
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

run('汇总和top列表包含最强城市日记录', () => {
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
