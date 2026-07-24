const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('vercel configuration excludes removed public property', () => {
    const configPath = path.join(__dirname, '..', 'vercel.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    assert.equal(Object.hasOwn(config, 'public'), false);
});
