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

test('uses shared data workspace classes on report and rain pages', () => {
    const html = read('index-v2.html');
    assert.ok((html.match(/class="[^"]*data-toolbar[^"]*"/g) || []).length >= 2);
    assert.ok((html.match(/class="[^"]*data-table-shell[^"]*"/g) || []).length >= 2);
});

test('rain monitor resolves its active dimension and tooltip binder', () => {
    const ui = read('js/ui.js');
    assert.doesNotMatch(ui, /#rainMonitorPage/);
    assert.match(ui, /#rainMonitor \.dimension-btn\.active/);
    assert.match(ui, /function bindTooltipEvents\(container\)/);
});

test('wraps data workspace dimensions within narrow viewports', () => {
    const css = read('css/titanium-theme.css');
    const narrowStart = css.indexOf('@media (max-width: 767px)');
    const narrowEnd = css.indexOf('@media (max-width: 1024px)');
    const narrowCss = css.slice(narrowStart, narrowEnd);

    assert.ok(narrowStart >= 0 && narrowEnd > narrowStart);
    assert.match(narrowCss, /\.data-toolbar \.segmented-control \{[\s\S]*?max-width: 100%[\s\S]*?flex-wrap: wrap/);
});

test('keeps filter chips at accessible touch-target sizes', () => {
    const css = read('css/titanium-theme.css');
    const filters = css.match(/\.filter-chip,\s*\.filter-btn \{([\s\S]*?)\n\}/)[1];

    assert.match(filters, /min-width: 44px/);
    assert.match(filters, /min-height: 44px/);
});

test('clamps tooltip position using its rendered width and viewport margins', () => {
    const ui = read('js/ui.js');

    assert.doesNotMatch(ui, /window\.innerWidth - 340/);
    assert.match(ui, /const tooltipWidth = tooltip\.getBoundingClientRect\(\)\.width;/);
    assert.match(ui, /const maxLeft = Math\.max\(12, window\.innerWidth - tooltipWidth - 12\);/);
    assert.match(ui, /Math\.max\(12, Math\.min\(rect\.left, maxLeft\)\)/);
});

test('rules page exposes saved and dirty visual status', () => {
    const html = read('index-v2.html');
    const ui = read('js/ui.js');
    assert.match(html, /id="rulesSaveStatus"/);
    assert.match(ui, /function setRulesStatus\(status\)/);
    assert.match(ui, /setRulesStatus\('dirty'\)/);
    assert.match(ui, /setRulesStatus\('saved'\)/);
});

test('rules render binds dirty feedback only to the newly rendered inputs', () => {
    const ui = read('js/ui.js');
    const binding = "input.addEventListener('input', () => setRulesStatus('dirty'))";

    assert.equal(ui.split(binding).length - 1, 1);
    assert.match(
        ui,
        /container\.innerHTML = `[\s\S]*?container\.querySelectorAll\('input'\)\.forEach\(\(input\) => \{[\s\S]*?setRulesStatus\('saved'\);/
    );
});

test('rules action buttons meet touch-target and focus requirements', () => {
    const html = read('index-v2.html');
    const css = read('css/titanium-theme.css');
    const actions = html.match(/<div class="settings-actions">([\s\S]*?)<\/div>\s*<\/div>/)[1];
    const buttons = actions.match(/<button[^>]*>/g);

    assert.equal(buttons.length, 2);
    buttons.forEach((button) => assert.match(button, /type="button"/));
    assert.match(css, /\.settings-action-buttons \.btn \{[\s\S]*?min-width: 44px[\s\S]*?min-height: 44px/);
    assert.match(css, /:where\(button, input, select, textarea, \[tabindex\]\):focus-visible/);
});

test('rules number inputs override the legacy focus reset with a titanium ring', () => {
    const css = read('css/titanium-theme.css');

    assert.match(
        css,
        /\.rule-field input\[type="number"\]:focus-visible \{[\s\S]*?outline: 2px solid var\(--titanium-accent\);[\s\S]*?outline-offset: 3px;/
    );
});

test('rules sticky actions stay within narrow viewports', () => {
    const css = read('css/titanium-theme.css');
    const narrowStart = css.indexOf('@media (max-width: 767px)');
    const narrowEnd = css.indexOf('@media (max-width: 1024px)');
    const narrowCss = css.slice(narrowStart, narrowEnd);

    assert.ok(narrowStart >= 0 && narrowEnd > narrowStart);
    assert.match(narrowCss, /\.settings-actions \{[\s\S]*?flex-direction: column/);
    assert.match(narrowCss, /\.settings-action-buttons \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(narrowCss, /\.settings-action-buttons \.btn \{[\s\S]*?min-width: 0/);
});

test('rules groups collapse without overflowing narrow viewports', () => {
    const css = read('css/titanium-theme.css');
    const narrowStart = css.indexOf('@media (max-width: 767px)');
    const narrowEnd = css.indexOf('@media (max-width: 1024px)');
    const narrowCss = css.slice(narrowStart, narrowEnd);

    assert.match(narrowCss, /\.alert-guide-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(narrowCss, /\.rules-sections \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(narrowCss, /\.rule-field label \{[\s\S]*?flex-wrap: wrap/);
});

test('applies titanium surfaces to all product modals', () => {
    const html = read('index-v2.html');
    ['cityDetailModal', 'dailyBriefModal', 'loginModal', 'paymentModal'].forEach((id) => {
        const pattern = new RegExp(`id="${id}"[\\s\\S]{0,500}modal-surface`);
        assert.match(html, pattern);
    });
});

test('login controls retain labels and accessible input modes', () => {
    const html = read('index-v2.html');
    assert.match(html, /for="loginPhone"/);
    assert.match(html, /id="loginPhone"[^>]*class="titanium-input"[^>]*inputmode="numeric"[^>]*autocomplete="tel"/);
    assert.match(html, /for="loginCode"/);
    assert.match(html, /id="loginCode"[^>]*class="titanium-input"[^>]*inputmode="numeric"[^>]*autocomplete="one-time-code"/);
});

test('preserves modal IDs, form IDs, and authentication and payment handlers', () => {
    const html = read('index-v2.html');

    ['cityDetailModal', 'dailyBriefModal', 'loginModal', 'paymentModal',
        'phoneLoginForm', 'wechatLoginForm', 'wechatQRCode', 'wechatLoading',
        'loginPhone', 'loginCode', 'sendCodeBtn']
        .forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
    [
        'UI.closeCityDetail()',
        'UI.closeDailyBriefModal()',
        'Auth.closeModal()',
        'Auth.sendCode()',
        'Auth.phoneLogin()',
        'Payment.closeModal()',
        "Payment.buy('hot_analysis', 'onetime')",
        "Payment.buy('forecast_7d', 'subscription')"
    ].forEach((handler) => assert.ok(html.includes(handler), `${handler} must remain wired`));
});

test('gives every product modal close button an accessible name', () => {
    const html = read('index-v2.html');
    const ui = read('js/ui.js');
    const staticCloseButtons = html.match(/<button class="modal-close"[^>]*>/g);

    assert.equal(staticCloseButtons.length, 3);
    staticCloseButtons.forEach((button) => {
        assert.match(button, /type="button"/);
        assert.match(button, /aria-label="关闭[^"]*"/);
    });
    assert.match(
        ui,
        /<button class="modal-close" type="button" aria-label="关闭城市详情" onclick="UI\.closeCityDetail\(\)">/
    );
});

test('uses titanium pricing, QR placeholder, feedback, and city detail surfaces', () => {
    const html = read('index-v2.html');
    const ui = read('js/ui.js');

    assert.equal((html.match(/class="payment-plan pricing-card(?: featured)?"/g) || []).length, 2);
    assert.match(html, /class="wechat-qr-placeholder"[^>]*role="img"[^>]*aria-label="微信登录二维码区域"/);
    assert.match(html, /登录二维码将在服务接入后显示/);
    assert.match(html, /id="toast" class="toast feedback-toast"/);
    assert.match(ui, /content\.innerHTML = `\s*<div class="modal-header titanium-modal-header">/);
    assert.ok((ui.match(/class="detail-item surface-raised"/g) || []).length >= 9);
});

test('modal styles provide touch targets, focus recovery, and narrow-screen containment', () => {
    const css = read('css/titanium-theme.css');
    const narrowStart = css.indexOf('@media (max-width: 767px)');
    const narrowEnd = css.indexOf('@media (max-width: 1024px)');
    const narrowCss = css.slice(narrowStart, narrowEnd);

    assert.match(css, /\.modal-close \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
    assert.match(css, /\.login-form input:focus-visible[\s\S]*?outline: 2px solid var\(--titanium-accent\);/);
    assert.match(css, /\.modal-content[\s\S]*?max-width: calc\(100vw - 24px\)/);
    assert.match(narrowCss, /\.modal-content \{[\s\S]*?width: calc\(100% - 24px\)[\s\S]*?max-height: calc\(100dvh - 24px\)/);
    assert.match(narrowCss, /\.payment-plans \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(narrowCss, /\.code-input-group \{[\s\S]*?flex-wrap: wrap/);
});

test('modal surface specificity overrides legacy dialog radii', () => {
    const css = read('css/titanium-theme.css');

    assert.match(
        css,
        /\.city-detail-modal \.modal-surface,[\s\S]*?\.daily-brief-modal \.modal-surface,[\s\S]*?\.login-modal \.modal-surface,[\s\S]*?\.payment-modal \.modal-surface \{[\s\S]*?border-radius: var\(--titanium-radius-lg\);/
    );
});
