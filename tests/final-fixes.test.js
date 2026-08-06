const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function hexToLuminance(hex) {
    const channels = hex.match(/[a-f\d]{2}/gi)
        .map((channel) => Number.parseInt(channel, 16) / 255)
        .map((channel) => channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
    const foregroundLuminance = hexToLuminance(foreground);
    const backgroundLuminance = hexToLuminance(background);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}

test('dashboard fills the available content height without a forced viewport height', () => {
    const html = read('index-v2.html');
    const theme = read('css/titanium-theme.css');
    const criticalDashboard = html.match(/\.dashboard-layout\s*\{([\s\S]*?)\}/)?.[1] || '';

    assert.doesNotMatch(criticalDashboard, /height\s*:/);
    assert.match(
        theme,
        /#dashboard\.page\.active\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?min-height:\s*100%;/
    );
    assert.match(
        theme,
        /\.dashboard-layout\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;/
    );
});

test('forecast and rain tables keep only the first three columns sticky', () => {
    const legacy = read('css/styles-v2.css');
    const ui = read('js/ui.js');

    assert.doesNotMatch(legacy, /\.fixed-left:nth-child\((?:4|5|6|7|8|9)\)/);
    assert.doesNotMatch(
        legacy,
        /\.forecast-table (?:thead th|tbody td):nth-child\((?:10|11|12|13|14|15|16)\)[\s\S]*?position:\s*sticky/
    );
    assert.doesNotMatch(ui, /<th class="fixed-left">(?:当前等级|今日ADI|最高提醒|最高机会)/);
    assert.doesNotMatch(ui, /<td class="fixed-left">(?:\$\{city\.adiScore\}|<span class="rain-mini-badge)/);
    assert.match(
        legacy,
        /\.forecast-table thead th\.fixed-left:nth-child\(1\)[^{]*\{[^}]*left:\s*0;[^}]*width:\s*76px;/
    );
    assert.match(
        legacy,
        /\.forecast-table thead th\.fixed-left:nth-child\(2\)[^{]*\{[^}]*left:\s*76px;[^}]*width:\s*84px;/
    );
    assert.match(
        legacy,
        /\.forecast-table thead th\.fixed-left:nth-child\(3\)[^{]*\{[^}]*left:\s*160px;[^}]*width:\s*92px;/
    );
});

test('analysis navigation uses native buttons and removes the closed submenu from focus', () => {
    const html = read('index-v2.html');
    const ui = read('js/ui.js');
    const nav = html.match(/<nav class="nav-menu">([\s\S]*?)<\/nav>/)?.[1] || '';

    assert.doesNotMatch(nav, /<div class="nav-(?:item|subitem)/);
    assert.equal((nav.match(/<button[^>]*class="nav-item/g) || []).length, 6);
    assert.equal((nav.match(/<button[^>]*class="nav-subitem/g) || []).length, 4);
    assert.match(
        nav,
        /class="nav-item"[^>]*data-page="analysis"[^>]*aria-controls="analysisSubmenu"[^>]*aria-expanded="false"/
    );
    assert.match(
        nav,
        /id="analysisSubmenu"[^>]*hidden[^>]*inert[^>]*aria-hidden="true"/
    );
    assert.equal((nav.match(/class="nav-subitem"[^>]*tabindex="-1"/g) || []).length, 4);
    assert.match(ui, /function setAnalysisMenuExpanded\(expanded\)/);
    assert.match(ui, /analysisNavItem\.setAttribute\('aria-expanded', String\(expanded\)\)/);
    assert.match(ui, /analysisSubmenu\.hidden = !expanded;/);
    assert.match(ui, /subitem\.tabIndex = expanded \? 0 : -1;/);
});

test('city-group tabs and sortable headers expose native keyboard and sort semantics', () => {
    const ui = read('js/ui.js');

    assert.match(ui, /class="citygroup-tabs" role="tablist"/);
    assert.match(
        ui,
        /<button type="button" class="citygroup-tab[^"]*" role="tab"[^>]*aria-selected="\$\{currentGroup === 'eastChina'\}"/
    );
    assert.match(
        ui,
        /<th data-sort="adiScore" aria-sort="\$\{getAriaSort\('adiScore'\)\}">[\s\S]*?<button type="button" class="citygroup-sort-button" data-sort="adiScore"/
    );
    assert.match(ui, /container\.querySelectorAll\('\.citygroup-sort-button'\)/);
    assert.doesNotMatch(ui, /container\.querySelectorAll\('\.citygroup-table th\[data-sort\]'\)/);
});

test('city-group sorting orders Chinese names in both directions and keeps numeric sorting', () => {
    const ui = read('js/ui.js');
    const context = vm.createContext({
        console,
        document: {},
        window: {},
        navigator: {},
        setInterval() {},
        clearInterval() {},
        setTimeout() {},
        clearTimeout() {}
    });

    vm.runInContext(ui, context);
    const sortCities = vm.runInContext('UI.sortCityGroupCities', context);
    const cities = [
        { cityName: '广州', adiScore: '80' },
        { cityName: '北京', adiScore: '100' },
        { cityName: '上海', adiScore: '70' },
        { cityName: '成都', adiScore: '90' }
    ];
    const names = (order) => Array.from(
        sortCities(cities, 'cityName', order),
        (city) => city.cityName
    );
    const scores = (order) => Array.from(
        sortCities(cities, 'adiScore', order),
        (city) => Number(city.adiScore)
    );

    assert.deepEqual(names('asc'), ['北京', '成都', '广州', '上海']);
    assert.deepEqual(names('desc'), ['上海', '广州', '成都', '北京']);
    assert.deepEqual(names('desc'), [...names('asc')].reverse());
    assert.deepEqual(scores('asc'), [70, 80, 90, 100]);
    assert.deepEqual(scores('desc'), [100, 90, 80, 70]);
    assert.match(ui, /const sortedCities = sortCityGroupCities\(cities, currentSortField, currentSortOrder\);/);
    assert.match(
        ui,
        /String\(valA \?\? ''\)\.localeCompare\(String\(valB \?\? ''\), 'zh-CN'\)/
    );
});

test('dynamic UI templates use shared numeric typography and the SVG icon system', () => {
    const html = read('index-v2.html');
    const ui = read('js/ui.js');
    const map = read('js/map.js');

    ['icon-search', 'icon-document', 'icon-insight', 'icon-moon', 'icon-alert']
        .forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
    assert.doesNotMatch(ui, /Orbitron/);
    assert.match(ui, /class="[^"]*tabular-number[^"]*"/);
    assert.doesNotMatch(html, /🧪|📄|🔍/u);
    assert.doesNotMatch(ui, /🌙|📋|⚠️|🔍|💡|🔥/u);
    assert.doesNotMatch(map, /🌙|⚠️/u);
    assert.match(
        read('css/titanium-theme.css'),
        /\.tabular-number\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/
    );
});

test('theme overrides legacy table and primary-button visuals with titanium surfaces', () => {
    const theme = read('css/titanium-theme.css');

    assert.match(
        theme,
        /\.data-table-shell \.forecast-table\s*\{[\s\S]*?background:\s*rgba\(20, 20, 22, 0\.86\)\s*!important;/
    );
    assert.match(
        theme,
        /\.data-table-shell \.forecast-table thead th\s*\{[\s\S]*?background:\s*rgba\(28, 28, 30, 0\.96\)\s*!important;/
    );
    assert.match(
        theme,
        /\.data-table-shell \.forecast-table tbody td\.fixed-left\s*\{[\s\S]*?background:\s*rgba\(28, 28, 30, 0\.96\)\s*!important;/
    );
    assert.match(
        theme,
        /\.settings-actions \.btn-primary\s*\{[\s\S]*?background:\s*var\(--titanium-accent\);[\s\S]*?border-radius:\s*var\(--titanium-radius-sm\);[\s\S]*?box-shadow:\s*none;/
    );
});

test('muted and danger text tokens meet WCAG AA on the brightest small-text surface', () => {
    const theme = read('css/titanium-theme.css');
    const muted = theme.match(/--titanium-text-muted:\s*(#[a-f\d]{6})/i)?.[1];
    const danger = theme.match(/--titanium-danger:\s*(#[a-f\d]{6})/i)?.[1];

    assert.ok(muted);
    assert.ok(danger);
    assert.ok(contrast(muted, '#202023') >= 4.5, `${muted} muted text must meet 4.5:1`);
    assert.ok(contrast(danger, '#202023') >= 4.5, `${danger} danger text must meet 4.5:1`);
    assert.match(theme, /--alert-red:\s*var\(--titanium-danger\);/);
    assert.match(
        theme,
        /\[style\*="color: #D0021B" i\][^{]*\{[\s\S]*?color:\s*var\(--titanium-danger\)\s*!important;/
    );
    assert.match(
        theme,
        /\.header-stat-value\.intensity-strong,[\s\S]*?\.temp-cell-high\s*\{[\s\S]*?color:\s*var\(--titanium-danger\)\s*!important;/
    );
    assert.doesNotMatch(read('js/ui.js'), /#D0021B/i);
    assert.doesNotMatch(read('js/map.js'), /#D0021B/i);
});

test('dashboard hero excludes no-signal regions before ranking', () => {
    const ui = read('js/ui.js');
    const hero = ui.slice(
        ui.indexOf('function renderDashboardHero()'),
        ui.indexOf('function renderDashboard(cityData)')
    );
    const filterIndex = hero.indexOf('.filter(([, stats]) =>');
    const sortIndex = hero.indexOf('.sort((a, b) =>');

    assert.ok(filterIndex >= 0, 'hero must filter region stats');
    assert.ok(sortIndex > filterIndex, 'hero must filter before sorting');
    assert.match(
        hero,
        /\.filter\(\(\[, stats\]\) => stats\.explosiveCount > 0 \|\| stats\.actionCount > 0\)/
    );
});
