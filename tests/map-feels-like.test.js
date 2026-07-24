const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mapPath = path.join(__dirname, '..', 'js', 'map.js');
const source = fs.readFileSync(mapPath, 'utf8');
const uiPath = path.join(__dirname, '..', 'js', 'ui.js');
const uiSource = fs.readFileSync(uiPath, 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '..', 'index-v2.html'), 'utf8');
const stylesheetSource = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles-v2.css'), 'utf8');
let option;

const mapContainer = {
    clientWidth: 800,
    clientHeight: 500,
    parentElement: { clientWidth: 800 },
    style: {},
    querySelector: () => null,
    appendChild: () => {},
    innerHTML: ''
};
const mapChart = {
    resize: () => {},
    setOption: (nextOption) => { option = nextOption; },
    off: () => {},
    on: () => {},
    getOption: () => option
};
const context = {
    console,
    setTimeout,
    document: {
        getElementById: (id) => id === 'china-map' ? mapContainer : null,
        createElement: () => ({})
    },
    window: {
        CHINA_GEO_DATA: {},
        UI: { state: { cityData: [], mapViewMode: 'adi' } },
        addEventListener: () => {},
        innerWidth: 1200
    },
    echarts: {
        registerMap: () => {},
        init: () => mapChart
    },
    UI: { state: { cityData: [], mapViewMode: 'adi' } },
    Core: { getLevelInfo: () => ({ color: '#123456', name: '测试' }) }
};
context.window.window = context.window;
vm.runInNewContext(source, context, { filename: mapPath });

const { MapModule } = context.window;

assert.equal(MapModule.getFeelsLikeColor(19), '#00D4FF');
assert.equal(MapModule.getFeelsLikeColor(20), '#00D4FF');
assert.equal(MapModule.getFeelsLikeColor(26), '#4A90E2');
assert.equal(MapModule.getFeelsLikeColor(27), '#FFE082');
assert.equal(MapModule.getFeelsLikeColor(35), '#F5A623');
assert.equal(MapModule.getFeelsLikeColor(36), '#FFB15C');
assert.equal(MapModule.getFeelsLikeColor(40), '#F57C00');
assert.equal(MapModule.getFeelsLikeColor(41), '#FF453A');
assert.equal(MapModule.getFeelsLikeColor(45), '#FA4137');
assert.equal(MapModule.getFeelsLikeColor(46), '#FA4137');

const legend = MapModule.getLegendConfig('feelsLike');
assert.deepEqual(Array.from(legend.items, item => item.label), ['≥41℃', '36-40℃', '27-35℃', '≤26℃']);

assert.match(pageSource, /<div\s+id="mapLegend"\s+class="map-legend"\s+hidden(?:\s|>)/);
const baseLegendRule = stylesheetSource.indexOf('.map-legend {');
const hiddenLegendRule = stylesheetSource.indexOf('.map-legend[hidden] {');
assert.ok(baseLegendRule >= 0);
assert.ok(hiddenLegendRule > baseLegendRule);
assert.match(stylesheetSource.slice(hiddenLegendRule), /\.map-legend\[hidden\]\s*\{\s*display:\s*none;/);

const mapLegend = { innerHTML: '', hidden: true };
const uiContext = {
    console,
    document: { getElementById: (id) => id === 'mapLegend' ? mapLegend : null },
    window: { MapModule },
    MapModule,
    Core: {}
};
vm.runInNewContext(`${uiSource}\nthis.__UI__ = UI;`, uiContext, { filename: uiPath });
uiContext.__UI__.updateMapLegend('feelsLike');
assert.equal(mapLegend.hidden, false);
assert.equal((mapLegend.innerHTML.match(/class="legend-item"/g) || []).length, 4);
assert.match(mapLegend.innerHTML, /≥41℃/);
assert.match(mapLegend.innerHTML, /36-40℃/);
assert.match(mapLegend.innerHTML, /27-35℃/);
assert.match(mapLegend.innerHTML, /≤26℃/);
['adi', 'nightTemp', 'dayMax'].forEach(mode => {
    uiContext.__UI__.updateMapLegend(mode);
    assert.equal(mapLegend.hidden, true);
    assert.equal(mapLegend.innerHTML, '');
});

(async () => {
    await MapModule.init();
    MapModule.render([{
        cityName: '测试城市', lng: 113.2, lat: 23.1, feelsLike: 41,
        adiScore: 80, nightMinTemp: 28, maxTemp: 35, humidity: 70,
        level: 'outbreak', continuousHotNightDays: 0, triggeredRules: []
    }], 'feelsLike');

    assert.equal(option.visualMap.min, 20);
    assert.equal(option.visualMap.max, 45);
    assert.deepEqual(Array.from(option.visualMap.inRange.color), Array.from({ length: 26 }, (_, index) => MapModule.getFeelsLikeColor(20 + index)));
    assert.equal(option.series[0].symbolSize([0, 0, 45]), 20);
    assert.equal(option.series[0].data[0].itemStyle.color, MapModule.getFeelsLikeColor(41));
    assert.match(option.tooltip.formatter({ data: option.series[0].data[0] }), /体感温度/);
    assert.match(option.tooltip.formatter({ data: option.series[0].data[0] }), new RegExp(MapModule.getFeelsLikeColor(41), 'i'));

    console.log('PASS map feels-like scale');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
