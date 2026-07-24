const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('loads titanium theme after legacy styles', () => {
    const html = read('index-v2.html');
    const legacyIndex = html.indexOf('css/styles-v2.css');
    const themeIndex = html.indexOf('css/titanium-theme.css');
    assert.ok(legacyIndex >= 0);
    assert.ok(themeIndex > legacyIndex);
});

test('defines the complete titanium token contract', () => {
    const css = read('css/titanium-theme.css');
    [
        '--titanium-bg',
        '--titanium-surface',
        '--titanium-surface-raised',
        '--titanium-text',
        '--titanium-text-secondary',
        '--titanium-accent',
        '--titanium-success',
        '--titanium-warning',
        '--titanium-danger',
        '--titanium-radius-sm',
        '--titanium-radius-md',
        '--titanium-radius-lg'
    ].forEach((token) => assert.match(css, new RegExp(token)));
});

test('removes Orbitron from the production stylesheet', () => {
    assert.doesNotMatch(read('css/styles-v2.css'), /Orbitron/);
});

test('uses SVG symbols instead of emoji in primary navigation', () => {
    const html = read('index-v2.html');
    const nav = html.match(/<nav class="nav-menu">([\s\S]*?)<\/nav>/)[1];
    ['icon-dashboard', 'icon-analysis', 'icon-calendar', 'icon-rain', 'icon-settings']
        .forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
    assert.doesNotMatch(nav, /🎯|📈|📊|🌧️|⚙️/);
    assert.match(nav, /<svg[^>]*aria-hidden="true"/);
});

test('preserves navigation and header integration IDs', () => {
    const html = read('index-v2.html');
    ['dashboard', 'analysis', 'report', 'rainMonitor', 'rules'].forEach((page) => {
        assert.match(html, new RegExp(`data-page="${page}"`));
    });
    ['headerDate', 'pageTitle', 'currentTime', 'salesIntensity', 'cityCount', 'outbreakCount',
        'actionCount', 'hotNightCount', 'lastUpdateTime'].forEach((id) => {
        assert.match(html, new RegExp(`id="${id}"`));
    });
});

test('makes primary and submenu navigation keyboard accessible', () => {
    const html = read('index-v2.html');
    const ui = read('js/ui.js');
    const nav = html.match(/<nav class="nav-menu">([\s\S]*?)<\/nav>/)[1];
    const controls = nav.match(/<div class="nav-(?:item|subitem)[^"]*"[^>]*>/g);

    assert.equal(controls.length, 10);
    controls.forEach((control) => {
        assert.match(control, /role="button"/);
        assert.match(control, /tabindex="0"/);
    });
    nav.match(/<div class="nav-item[^"]*"[^>]*>/g).forEach((control) => {
        assert.match(control, /aria-label="[^"]+"/);
    });
    assert.match(ui, /event\.key === 'Enter' \|\| event\.key === ' '/);
    assert.match(ui, /event\.preventDefault\(\);/);
    assert.match(ui, /item\.click\(\);/);
});

test('provides a compact tablet shell and honors reduced motion', () => {
    const css = read('css/titanium-theme.css');
    assert.match(css, /@media \(max-width: 1024px\)[\s\S]*?\.sidebar[\s\S]*?\.dashboard-layout[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(css, /@media \(max-width: 1024px\)[\s\S]*?\.nav-item[\s\S]*?min-width: 44px[\s\S]*?min-height: 44px/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none !important/);
});

test('updates the header date from the shared current-time integration', () => {
    const ui = read('js/ui.js');
    assert.match(ui, /const headerDate = document\.getElementById\('headerDate'\);/);
    assert.match(ui, /headerDate\.textContent = now\.toLocaleDateString\('zh-CN', \{[\s\S]*?weekday: 'long'/);
});
