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

test('keeps analysis subpages reachable from the compact navigation', () => {
    const html = read('index-v2.html');
    const css = read('css/titanium-theme.css');
    const compactCss = css.match(/@media \(max-width: 1024px\) \{([\s\S]*?)@media \(prefers-reduced-motion/)[1];
    const subitems = html.match(/<div class="nav-subitem"[^>]*>/g);

    assert.equal(subitems.length, 4);
    subitems.forEach((subitem) => {
        assert.match(subitem, /role="button"/);
        assert.match(subitem, /tabindex="0"/);
    });
    assert.doesNotMatch(compactCss, /\.nav-submenu\s*\{[^}]*display:\s*none/);
    assert.match(compactCss, /\.nav-submenu\.open\s*\{[\s\S]*?visibility:\s*visible[\s\S]*?pointer-events:\s*auto/);
    assert.match(compactCss, /\.nav-subitem\s*\{[\s\S]*?min-height:\s*44px/);
});

test('updates the header date from the shared current-time integration', () => {
    const ui = read('js/ui.js');
    assert.match(ui, /const headerDate = document\.getElementById\('headerDate'\);/);
    assert.match(ui, /headerDate\.textContent = now\.toLocaleDateString\('zh-CN', \{[\s\S]*?weekday: 'long'/);
});

test('defines the dashboard hero and preserves dynamic dashboard targets', () => {
    const html = read('index-v2.html');
    ['dashboardHeroTitle', 'dashboardHeroSummary', 'todayConclusion', 'regionRanking',
        'longestHotNight', 'china-map', 'topCitiesContainer', 'generateBriefBtn']
        .forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
    assert.match(html, /class="dashboard-hero"/);
});

test('renders the dashboard hero from current sales intensity', () => {
    const ui = read('js/ui.js');
    assert.match(ui, /function renderDashboardHero\(\)/);
    assert.match(ui, /dashboardHeroTitle/);
    assert.match(ui, /dashboardHeroSummary/);
    assert.match(ui, /renderDashboardHero\(\);/);
});

test('keeps titanium segmented controls at accessible touch-target sizes', () => {
    const css = read('css/titanium-theme.css');
    const controls = css.match(/\.view-mode-btn,[\s\S]*?\.dimension-btn \{([\s\S]*?)\n\}/)[1];

    assert.match(controls, /min-width: 44px/);
    assert.match(controls, /min-height: 44px/);
    assert.match(controls, /padding: 8px 10px/);
});

test('keeps the dashboard hero and map controls reachable on narrow screens', () => {
    const css = read('css/titanium-theme.css');
    const narrowStart = css.indexOf('@media (max-width: 767px)');
    const narrowEnd = css.indexOf('@media (max-width: 1024px)');
    const narrowCss = css.slice(narrowStart, narrowEnd);

    assert.ok(narrowStart >= 0 && narrowEnd > narrowStart);
    assert.match(narrowCss, /\.dashboard-hero \{[\s\S]*?flex-direction: column/);
    assert.match(narrowCss, /\.map-section \.section-header \{[\s\S]*?flex-wrap: wrap/);
    assert.match(narrowCss, /\.view-mode-toggle \{[\s\S]*?flex-wrap: wrap/);
    assert.match(narrowCss, /\.view-mode-btn \{[\s\S]*?flex: 1 1 calc\(50% - 3px\)/);
});
