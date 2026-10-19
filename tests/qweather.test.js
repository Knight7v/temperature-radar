const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Q = require(path.join(__dirname, '..', 'lib', 'qweather.js'));

test('buildWeatherUrl encodes location and appends key', () => {
    const url = Q.buildWeatherUrl('120.00,30.00', 'KEY123');
    assert.ok(url.startsWith(Q.QWEATHER_BASE));
    assert.ok(url.includes('location=120.00%2C30.00') || url.includes('location=120.00,30.00'));
    assert.ok(url.includes('key=KEY123'));
});

test('mapWithConcurrency respects concurrency limit and preserves order', async () => {
    const inFlight = [];
    const maxSeen = { v: 0 };
    const items = [1, 2, 3, 4, 5];
    const out = await Q.mapWithConcurrency(items, 2, async (n) => {
        inFlight.push(n);
        maxSeen.v = Math.max(maxSeen.v, inFlight.length);
        await new Promise((r) => setTimeout(r, 10));
        inFlight.pop();
        return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
    assert.ok(maxSeen.v <= 2, 'concurrency never exceeds limit');
});

test('fetch7dBatch reports failed cities without throwing', async () => {
    const cities = [
        { name: 'OK', lat: 30, lng: 120 },
        { name: 'BAD', lat: 0, lng: 0 }
    ];
    // 注入 fetch:对 'BAD' 返回非 200
    const fakeFetch = (url) => Promise.resolve({
        ok: !url.includes('location=0.00'),
        status: 200,
        json: () => Promise.resolve({ code: '200', daily: [{ tempMax: '30', tempMin: '20', humidity: '60', fxDate: '2026-08-01' }] })
    });
    const { results, failed } = await Q.fetch7dBatch(cities, 'KEY', { fetchImpl: fakeFetch, concurrency: 2, timeoutMs: 500 });
    assert.ok(results.length >= 1);
    assert.ok(failed.includes('BAD'));
});

test('server cache does not keep a previous-day forecast after midnight', async () => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    let calls = 0;
    const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ code: '200', daily: [{ fxDate: ++calls === 1 ? yesterday : today, tempMax: String(calls) }] }),
    });
    const first = await Q.fetch7d('116.46,39.92-cache-test', 'KEY', { fetchImpl });
    const second = await Q.fetch7d('116.46,39.92-cache-test', 'KEY', { fetchImpl });
    assert.equal(first.daily[0].fxDate, yesterday);
    assert.equal(second.daily[0].fxDate, today);
    assert.equal(calls, 2);
});
