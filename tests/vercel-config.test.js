const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('vercel configuration excludes removed public property', () => {
    const configPath = path.join(__dirname, '..', 'vercel.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    assert.equal(Object.hasOwn(config, 'public'), false);
});

test('vercel cron triggers cron-push daily at 01:30 UTC', () => {
    const configPath = path.join(__dirname, '..', 'vercel.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    assert.ok(Array.isArray(config.crons), 'crons array must exist');
    const cron = config.crons.find((c) => c.path === '/api/cron-push');
    assert.ok(cron, '/api/cron-push cron entry must exist');
    assert.equal(cron.schedule, '30 1 * * *');
});
