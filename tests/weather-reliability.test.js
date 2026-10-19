const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const chinaToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

function loadCore(fetchImpl, cached = null) {
    const storage = new Map(cached ? [['weather_cache_v2_北京', JSON.stringify(cached)]] : []);
    const sandbox = {
        console: { warn() {}, error() {} },
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key),
            get length() { return storage.size; },
            key: index => [...storage.keys()][index],
        },
        fetch: fetchImpl,
        AbortController, setTimeout, clearTimeout, Date, Math, Intl,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('js/adi-core.js') + '\n' + read('js/core.js') + '\nglobalThis.core=Core;', sandbox);
    return sandbox.core;
}

test('weather failure does not become plausible random Beijing temperatures', async () => {
    const core = loadCore(() => Promise.reject(new Error('upstream unavailable')));
    const beijing = core.CITIES_CONFIG.find(city => city.name === '北京');
    assert.equal(await core.generateCityData(beijing), null);
});

test('batch reports failed cities and keeps only real weather data', async () => {
    const core = loadCore(async url => {
        if (url.includes('116.46')) throw new Error('Beijing unavailable');
        return { ok: true, json: async () => ({ code: '200', daily: [{ fxDate: chinaToday(), tempMax: '18', tempMin: '8', humidity: '55' }] }) };
    });
    const beijing = core.CITIES_CONFIG.find(city => city.name === '北京');
    const shanghai = core.CITIES_CONFIG.find(city => city.name === '上海');
    core.CITIES_CONFIG.splice(0, core.CITIES_CONFIG.length, beijing, shanghai);
    const result = await core.generateAllCityData();
    assert.deepEqual([...result.failedCities], ['北京']);
    assert.deepEqual([...result.cityData.map(city => city.cityName)], ['上海']);
    assert.equal(result.cityData[0].maxTemp, 18);
});

test('a previous-day cached forecast is fetched again', async () => {
    let calls = 0;
    const today = chinaToday();
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const fresh = { code: '200', daily: [{ fxDate: today, tempMax: '18', tempMin: '8', humidity: '55' }] };
    const core = loadCore(async () => {
        calls++;
        return { ok: true, json: async () => fresh };
    }, { timestamp: Date.now(), data: { code: '200', daily: [{ ...fresh.daily[0], fxDate: yesterday, tempMax: '25' }] } });
    const beijing = core.CITIES_CONFIG.find(city => city.name === '北京');
    const weather = await core.fetchWeatherData(beijing);
    assert.equal(calls, 1);
    assert.equal(weather.daily[0].tempMax, '18');
});

test('city detail pairs the forecast date with its own temperature', () => {
    const modal = { style: {} };
    const content = { innerHTML: '' };
    const sandbox = {
        document: { getElementById: id => ({ cityDetailModal: modal, cityModalContent: content })[id] || null },
        Core: { getLevelInfo: () => ({ color: '#888', name: '凉爽', order: 0 }) },
        Date,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('js/ui.js') + '\nglobalThis.ui=UI;', sandbox);
    sandbox.ui.state.cityData = [{
        cityName: '北京', level: 'cool', adiScore: 14, region: '华北', province: '北京',
        shortReason: '天气凉爽', reason: '天气凉爽', maxTemp: 25, nightMinTemp: 20,
        feelsLike: 26, humidity: 44, continuousHotNightDays: 0, nightMuggyScore: 0,
        future3DayMaxTemps: [24], future3NightMinTemps: [22],
        future7AdiScores: [14, 17],
        future7Days: [
            { date: new Date('2026-10-15T12:00:00+08:00'), dayMax: 25, nightMin: 20, humidity: 44, adiScore: 14 },
            { date: new Date('2026-10-16T12:00:00+08:00'), dayMax: 24, nightMin: 22, humidity: 50, adiScore: 17 },
        ],
    }];
    sandbox.ui.showCityDetail('北京');
    assert.match(content.innerHTML, /10\/15 周四[\s\S]*?25°/);
    assert.match(content.innerHTML, /10\/16 周五[\s\S]*?24°/);
});

test('local weather API is loadable by the CommonJS development server', () => {
    assert.equal(typeof require('../handlers/weather.js'), 'function');
});
