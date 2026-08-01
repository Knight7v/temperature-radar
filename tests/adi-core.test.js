const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ADICore = require(path.join(__dirname, '..', 'js', 'adi-core.js'));

test('CITIES_CONFIG has 131 cities', () => {
    assert.equal(ADICore.CITIES_CONFIG.length, 131);
});

test('calculateADI matches current core.js baselines', () => {
    const mild = { nightMinTemp: 26, maxTemp: 34, feelsLike: 35, continuousHotNightDays: 1, humidity: 70 };
    assert.equal(ADICore.calculateADI(mild).adiScore, 70);

    const maxed = { nightMinTemp: 29, maxTemp: 38, feelsLike: 41, continuousHotNightDays: 3, humidity: 80 };
    assert.equal(ADICore.calculateADI(maxed).adiScore, 100);
});

test('determineLevel applies force-upgrade for night min >= 28', () => {
    const force = { nightMinTemp: 29, maxTemp: 30, feelsLike: 30, continuousHotNightDays: 0, humidity: 50 };
    const r = ADICore.determineLevel(ADICore.calculateADI(force).adiScore, force);
    assert.equal(r.level, 'outbreak');
    assert.ok(r.triggeredRules.includes('夜间最低温≥28℃'));
});

test('determineLevel classifies mild input as opportunity', () => {
    const mild = { nightMinTemp: 26, maxTemp: 34, feelsLike: 35, continuousHotNightDays: 1, humidity: 70 };
    assert.equal(ADICore.determineLevel(70, mild).level, 'opportunity');
});

test('assembleCityData attaches adiScore/level/reason/trend', () => {
    const parsed = {
        cityName: '测试城', region: '华东', province: '测试',
        lat: 30, lng: 120,
        maxTemp: 34, nightMinTemp: 26, feelsLike: 35, humidity: 70, continuousHotNightDays: 1,
        future3DayMaxTemps: [34, 35, 36], future3NightMinTemps: [26, 26, 27],
        future7DayMaxTemps: [34, 35, 36, 36, 35, 34, 33],
        future7NightMinTemps: [26, 26, 27, 27, 26, 25, 25],
        future7AdiScores: [70, 72, 75, 76, 74, 70, 68],
        future7Days: [],
        nightMuggyScore: 0,
        updatedAt: '00:00'
    };
    const c = ADICore.assembleCityData(parsed);
    assert.equal(c.adiScore, 70);
    assert.equal(c.level, 'opportunity');
    assert.equal(typeof c.reason, 'string');
    assert.equal(c.levelTrend.currentLevel, 'opportunity');
});

test('buildHeatFocusSummary sets hasContent=false when no outbreak/action', () => {
    const cities = [
        { cityName: 'A', adiScore: 60, level: 'opportunity', region: '华东', future7AdiScores: [60, 60, 60] }
    ];
    const s = ADICore.buildSummary('heatFocus', cities, { updateTime: '08/01 09:30' });
    assert.equal(s.hasContent, false);
});

test('buildHeatFocusSummary sets hasContent=true with outbreak city', () => {
    const cities = [
        { cityName: 'A', adiScore: 90, level: 'outbreak', region: '华东', maxTemp: 38, nightMinTemp: 29, feelsLike: 41, future7AdiScores: [90, 90, 90] }
    ];
    const s = ADICore.buildSummary('heatFocus', cities, { updateTime: '08/01 09:30' });
    assert.equal(s.hasContent, true);
    assert.equal(s.outbreakCities[0].name, 'A');
});

test('buildHeatRiseSummary filters by minAdiChange=10', () => {
    const cities = [
        { cityName: 'R', adiScore: 60, level: 'opportunity', region: '华东', maxTemp: 33, nightMinTemp: 24,
          future7AdiScores: [60, 65, 75], future3DayMaxTemps: [33, 34, 36], future3NightMinTemps: [24, 25, 26] }
    ];
    const s = ADICore.buildSummary('heatRise', cities, { updateTime: '08/01 09:30' });
    assert.equal(s.hasContent, true);
    assert.equal(s.risingCities.length, 1);
    // adiChange = futureAdi3(75) - adiNow(60) = 15 >= 10
});
