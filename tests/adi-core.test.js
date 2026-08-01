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
