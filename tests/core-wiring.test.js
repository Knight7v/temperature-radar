const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function loadCore() {
    const sandbox = {
        console,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        AbortController, setTimeout, clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const src = read('js/adi-core.js') + '\n' + read('js/core.js') + '\n;globalThis.__Core = Core;';
    vm.runInContext(src, sandbox);
    return sandbox;
}

test('index-v2.html loads adi-core.js before core.js', () => {
    const html = read('index-v2.html');
    const adiIdx = html.indexOf('js/adi-core.js');
    const coreIdx = html.indexOf('js/core.js');
    assert.ok(adiIdx > 0, 'adi-core.js script tag must exist');
    assert.ok(coreIdx > adiIdx, 'adi-core.js must load before core.js');
});

test('core.js no longer applies level capping', () => {
    const src = read('js/core.js');
    assert.equal(src.includes('MAX_OUTBREAK'), false);
    assert.equal(src.includes('actionThreshold'), false);
});

test('Core loads via ADICore and keeps public API', () => {
    const s = loadCore();
    assert.equal(typeof s.__Core.calculateADI, 'function');
    assert.equal(s.__Core.CITIES_CONFIG.length, 131);
    const r = s.__Core.calculateADI({ nightMinTemp: 26, maxTemp: 34, feelsLike: 35, continuousHotNightDays: 1, humidity: 70 });
    assert.equal(r.adiScore, 70);
    assert.equal(typeof s.__Core.generateAllCityData, 'function');
});
