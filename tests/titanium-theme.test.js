const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
    const nav = html.match(/<nav class="nav-menu">([\s\S]*?)<\/nav>/)[1];
    const controls = nav.match(/<button[^>]*class="nav-(?:item|subitem)[^"]*"[^>]*>/g);

    assert.equal(controls.length, 10);
    controls.forEach((control) => {
        assert.match(control, /type="button"/);
    });
    nav.match(/<button[^>]*class="nav-item[^"]*"[^>]*>/g).forEach((control) => {
        assert.match(control, /aria-label="[^"]+"/);
    });
    const subitems = nav.match(/<button[^>]*class="nav-subitem"[^>]*>/g);
    subitems.forEach((control) => assert.match(control, /tabindex="-1"/));
});

test('provides a compact tablet shell and honors reduced motion', () => {
    const css = read('css/titanium-theme.css');
    const tabletCss = css.slice(
        css.indexOf('@media (min-width: 768px) and (max-width: 1024px)'),
        css.indexOf('@media (max-width: 1023px)')
    );
    const compactCss = css.slice(
        css.indexOf('@media (max-width: 1023px)'),
        css.indexOf('@media (prefers-reduced-motion: reduce)')
    );

    assert.match(tabletCss, /\.app-container \{[\s\S]*?flex-direction: row/);
    assert.match(tabletCss, /\.sidebar \{[\s\S]*?width: 78px[\s\S]*?flex-direction: column/);
    assert.match(tabletCss, /\.nav-item \{[\s\S]*?min-width: 44px[\s\S]*?min-height: 44px/);
    assert.doesNotMatch(
        tabletCss,
        /\.dashboard-layout \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/
    );
    assert.match(
        compactCss,
        /\.dashboard-layout,[\s\S]*?\.rules-sections \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/
    );
    assert.match(
        compactCss,
        /\.dashboard-layout \{[\s\S]*?height: auto !important/
    );
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none !important/);
});

test('keeps analysis subpages reachable from the compact navigation', () => {
    const html = read('index-v2.html');
    const css = read('css/titanium-theme.css');
    const compactCss = css.slice(
        css.indexOf('@media (min-width: 768px) and (max-width: 1024px)'),
        css.indexOf('@media (max-width: 1023px)')
    );
    const subitems = html.match(/<button[^>]*class="nav-subitem"[^>]*>/g);

    assert.equal(subitems.length, 4);
    subitems.forEach((subitem) => {
        assert.match(subitem, /type="button"/);
        assert.match(subitem, /tabindex="-1"/);
    });
    assert.doesNotMatch(compactCss, /\.nav-submenu\s*\{[^}]*display:\s*none/);
    assert.match(compactCss, /\.nav-submenu\.open\s*\{[\s\S]*?visibility:\s*visible[\s\S]*?pointer-events:\s*auto/);
    assert.match(compactCss, /\.nav-subitem\s*\{[\s\S]*?min-height:\s*44px/);
});

test('closes analysis navigation before activating another primary page', () => {
    const ui = read('js/ui.js');

    assert.match(ui, /if \(page !== 'analysis'\) \{/);
    assert.match(ui, /setAnalysisMenuExpanded\(false\);/);
    assert.match(
        ui,
        /document\.getElementById\('analysisSubmenu'\)\?\.querySelectorAll\('\.nav-subitem'\)\.forEach\(subitem => \{[\s\S]*?subitem\.classList\.remove\('active'\);/
    );
});

test('analysis navigation stays open and listener counts stay stable across round trips', () => {
    const createClassList = (...initial) => {
        const values = new Set(initial);
        return {
            add(...names) { names.forEach((name) => values.add(name)); },
            remove(...names) { names.forEach((name) => values.delete(name)); },
            contains(name) { return values.has(name); },
            toggle(name, force) {
                const next = force === undefined ? !values.has(name) : Boolean(force);
                if (next) values.add(name);
                else values.delete(name);
                return next;
            }
        };
    };
    const createElement = ({ id, classes = [], dataset = {} } = {}) => {
        const listeners = new Map();
        const attributes = new Map();
        const element = {
            id,
            dataset,
            classList: createClassList(...classes),
            style: {},
            textContent: '',
            innerHTML: '',
            hidden: false,
            tabIndex: 0,
            setAttribute(name, value) {
                attributes.set(name, String(value));
            },
            getAttribute(name) {
                return attributes.has(name) ? attributes.get(name) : null;
            },
            removeAttribute(name) {
                attributes.delete(name);
            },
            addEventListener(type, listener) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(listener);
            },
            click() {
                const event = {
                    target: element,
                    preventDefault() {}
                };
                [...(listeners.get('click') || [])].forEach((listener) => listener(event));
            },
            closest(selector) {
                return selector === '.nav-item' && element.classList.contains('nav-item')
                    ? element
                    : null;
            },
            listenerCount(type) {
                return (listeners.get(type) || []).length;
            },
            querySelector() { return null; },
            querySelectorAll() { return []; }
        };
        return element;
    };

    const dashboardNav = createElement({
        classes: ['nav-item', 'active'],
        dataset: { page: 'dashboard' }
    });
    const analysisNav = createElement({
        classes: ['nav-item'],
        dataset: { page: 'analysis' }
    });
    const reportNav = createElement({
        classes: ['nav-item'],
        dataset: { page: 'report' }
    });
    const nightSubitem = createElement({
        classes: ['nav-subitem'],
        dataset: { subpage: 'nightMuggy' }
    });
    const futureSubitem = createElement({
        classes: ['nav-subitem'],
        dataset: { subpage: 'future3Day' }
    });
    const subitems = [nightSubitem, futureSubitem];
    const submenu = createElement({ id: 'analysisSubmenu', classes: ['nav-submenu'] });
    submenu.querySelectorAll = (selector) => selector === '.nav-subitem' ? subitems : [];
    submenu.querySelector = (selector) => selector === '.nav-subitem[data-subpage="nightMuggy"]'
        ? nightSubitem
        : null;

    const pages = ['dashboard', 'analysis', 'report'].map((id) => createElement({
        id,
        classes: ['page', ...(id === 'dashboard' ? ['active'] : [])]
    }));
    const byId = new Map(pages.map((page) => [page.id, page]));
    [
        createElement({ id: 'pageTitle' }),
        submenu,
        createElement({ id: 'analysisPageTitle' }),
        createElement({ id: 'analysisPageDesc' }),
        createElement({ id: 'analysisContent' }),
        createElement({ id: 'forecastTableHead' }),
        createElement({ id: 'forecastTableBody' }),
        createElement({ id: 'currentTime' }),
        createElement({ id: 'headerDate' })
    ].forEach((element) => byId.set(element.id, element));
    byId.get('forecastTableBody').querySelectorAll = () => [];

    const navItems = [dashboardNav, analysisNav, reportNav];
    const document = {
        body: { appendChild() {} },
        getElementById(id) { return byId.get(id) || null; },
        querySelector(selector) {
            if (selector === '.nav-item[data-page="analysis"]') return analysisNav;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.nav-item') return navItems;
            if (selector === '.page') return pages;
            if (selector === '.nav-item, .nav-subitem') return [...navItems, ...subitems];
            return [];
        },
        addEventListener() {},
        createElement() { return createElement(); }
    };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        document,
        window: {},
        navigator: { clipboard: { writeText: () => Promise.resolve() } },
        Core: {
            getTopNightMuggy: () => []
        },
        MapModule: {},
        setInterval: () => 1,
        clearInterval() {},
        setTimeout: (callback) => {
            callback();
            return 1;
        },
        clearTimeout() {}
    });

    vm.runInContext(read('js/ui.js'), context);
    const UI = vm.runInContext('UI', context);
    UI.state.cityData.push({});
    UI.init();

    analysisNav.click();
    assert.equal(analysisNav.classList.contains('expanded'), true);
    assert.equal(analysisNav.getAttribute('aria-expanded'), 'true');
    assert.equal(submenu.classList.contains('open'), true);
    assert.equal(submenu.hidden, false);
    assert.equal(nightSubitem.tabIndex, 0);
    assert.equal(nightSubitem.classList.contains('active'), true);
    const initialListenerCounts = {
        analysis: analysisNav.listenerCount('click'),
        night: nightSubitem.listenerCount('click'),
        future: futureSubitem.listenerCount('click')
    };

    for (let roundTrip = 0; roundTrip < 3; roundTrip += 1) {
        reportNav.click();
        assert.equal(submenu.classList.contains('open'), false);
        assert.equal(submenu.hidden, true);
        assert.equal(nightSubitem.tabIndex, -1);
        assert.equal(subitems.some((subitem) => subitem.classList.contains('active')), false);

        analysisNav.click();
        assert.equal(
            analysisNav.classList.contains('expanded'),
            true,
            `analysis must expand after round trip ${roundTrip + 1}`
        );
        assert.equal(
            submenu.classList.contains('open'),
            true,
            `submenu must open after round trip ${roundTrip + 1}`
        );
        assert.equal(nightSubitem.classList.contains('active'), true);
        nightSubitem.click();
        assert.equal(nightSubitem.classList.contains('active'), true);
        assert.deepEqual(
            {
                analysis: analysisNav.listenerCount('click'),
                night: nightSubitem.listenerCount('click'),
                future: futureSubitem.listenerCount('click')
            },
            initialListenerCounts
        );
    }
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
    const narrowEnd = css.indexOf('@media (min-width: 768px) and (max-width: 1024px)');
    const narrowCss = css.slice(narrowStart, narrowEnd);

    assert.ok(narrowStart >= 0 && narrowEnd > narrowStart);
    assert.match(narrowCss, /\.dashboard-hero \{[\s\S]*?flex-direction: column/);
    assert.match(narrowCss, /\.dashboard-layout \{[\s\S]*?height: auto/);
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
    const narrowEnd = css.indexOf('@media (min-width: 768px) and (max-width: 1024px)');
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
    const narrowEnd = css.indexOf('@media (min-width: 768px) and (max-width: 1024px)');
    const narrowCss = css.slice(narrowStart, narrowEnd);

    assert.ok(narrowStart >= 0 && narrowEnd > narrowStart);
    assert.match(narrowCss, /\.settings-actions \{[\s\S]*?flex-direction: column/);
    assert.match(narrowCss, /\.settings-action-buttons \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(narrowCss, /\.settings-action-buttons \.btn \{[\s\S]*?min-width: 0/);
});

test('rules groups collapse without overflowing narrow viewports', () => {
    const css = read('css/titanium-theme.css');
    const narrowStart = css.indexOf('@media (max-width: 767px)');
    const narrowEnd = css.indexOf('@media (min-width: 768px) and (max-width: 1024px)');
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

test('gives the dynamically rendered payment QR close button a precise accessible name', () => {
    const payment = read('js/payment.js');
    const qrCloseButtons = [
        ...payment.matchAll(/<button[^>]*class="modal-close"[^>]*>/g)
    ].map((match) => match[0]);

    assert.equal(qrCloseButtons.length, 1);
    assert.match(qrCloseButtons[0], /type="button"/);
    assert.match(qrCloseButtons[0], /aria-label="关闭支付二维码"/);
    assert.match(
        qrCloseButtons[0],
        /onclick="this\.closest\('\.payment-qr-modal'\)\.remove\(\)"/
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
    const narrowEnd = css.indexOf('@media (min-width: 768px) and (max-width: 1024px)');
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

test('map module defines and uses the titanium map theme', () => {
    const map = read('js/map.js');
    assert.match(map, /const TITANIUM_MAP_THEME = \{/);
    assert.match(map, /areaColor: TITANIUM_MAP_THEME\.area/);
    assert.match(map, /borderColor: TITANIUM_MAP_THEME\.border/);
    assert.match(map, /class="map-tooltip titanium-map-tooltip"/);

    const tooltipRoots = [...map.matchAll(/<div class="(map-tooltip[^"]*)"/g)]
        .map((match) => match[1])
        .sort();
    assert.deepEqual(tooltipRoots, [
        'map-tooltip titanium-map-tooltip',
        'map-tooltip titanium-map-tooltip titanium-map-tooltip-loading'
    ].sort());
});

test('titanium stylesheet presents the map and tooltip as restrained dark surfaces', () => {
    const html = read('index-v2.html');
    const css = read('css/titanium-theme.css');
    const criticalMapStyle = html.match(/#china-map\s*\{([^}]*)\}/)[1];

    assert.doesNotMatch(criticalMapStyle, /background\s*:/);
    assert.match(
        css,
        /#china-map \{[\s\S]*?border-radius: calc\(var\(--titanium-radius-md\) - 1px\);[\s\S]*?overflow: hidden;[\s\S]*?#111113;/
    );
    assert.match(
        css,
        /\.titanium-map-tooltip \{[\s\S]*?background: rgba\(35, 35, 38, 0\.94\);[\s\S]*?border-radius: var\(--titanium-radius-sm\);[\s\S]*?backdrop-filter: var\(--titanium-blur\);/
    );
    assert.match(
        css,
        /\.titanium-map-tooltip \.tooltip-reason,[\s\S]*?\.titanium-map-tooltip \.tooltip-mode-badge \{[\s\S]*?color: var\(--titanium-text-secondary\);/
    );
});

test('map tooltip formatter covers every view mode and the loading branch', async () => {
    let option;
    let clickHandler;
    let selectedCity;
    const mapContainer = {
        clientWidth: 640,
        clientHeight: 500,
        parentElement: { clientWidth: 640 },
        style: {},
        querySelector: () => null
    };
    const mapViewDesc = { textContent: '' };
    const chart = {
        resize() {},
        setOption(value) { option = value; },
        off() {},
        on(event, handler) {
            if (event === 'click') clickHandler = handler;
        }
    };
    const UI = {
        state: { cityData: [], mapViewMode: 'adi' },
        selectCity(name) { selectedCity = name; }
    };
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById(id) {
                if (id === 'china-map') return mapContainer;
                if (id === 'mapViewDesc') return mapViewDesc;
                return null;
            }
        },
        echarts: {
            registerMap() {},
            init: () => chart
        },
        Core: {
            getLevelInfo: () => ({ name: '热', color: '#ff9f0a' })
        },
        UI,
        window: {
            CHINA_GEO_DATA: { type: 'FeatureCollection', features: [] },
            UI,
            innerWidth: 1440,
            addEventListener() {}
        }
    });

    vm.runInContext(read('js/map.js'), context);
    await context.window.MapModule.init();

    const city = {
        cityName: '测试城市',
        lng: 121.47,
        lat: 31.23,
        level: 'action',
        adiScore: 83,
        nightMinTemp: 27,
        feelsLike: 38,
        maxTemp: 36,
        humidity: 70,
        continuousHotNightDays: 0,
        triggeredRules: ['测试规则']
    };
    const expectations = {
        adi: 'ADI: 83',
        nightTemp: '夜间最低温: 27℃',
        feelsLike: '体感温度: 38℃',
        dayMax: '白天最高温: 36℃'
    };

    Object.entries(expectations).forEach(([mode, expectedText]) => {
        context.window.MapModule.render([city], mode);
        const tooltip = option.tooltip.formatter({ data: { cityData: city } });
        const tooltipText = tooltip.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        assert.match(tooltip, /class="map-tooltip titanium-map-tooltip"/);
        assert.match(tooltipText, new RegExp(expectedText));
    });

    context.Core.getLevelInfo = () => null;
    const loadingTooltip = option.tooltip.formatter({ data: { cityData: city } });
    assert.match(
        loadingTooltip,
        /class="map-tooltip titanium-map-tooltip titanium-map-tooltip-loading"/
    );

    clickHandler({ componentType: 'series', data: { name: city.cityName } });
    assert.equal(selectedCity, city.cityName);
});

test('defines all required responsive breakpoints and reduced motion', () => {
    const css = read('css/titanium-theme.css');

    assert.match(css, /@media \(max-width: 1439px\)/);
    assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1024px\)/);
    assert.match(css, /@media \(max-width: 1023px\)/);
    assert.match(css, /@media \(max-width: 767px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('icon-only controls have accessible names', () => {
    const html = read('index-v2.html');
    const iconButtons = [
        ...html.matchAll(/<button[^>]*class="[^"]*(?:modal-close|clear-search-btn)[^"]*"[^>]*>/g)
    ];

    assert.ok(iconButtons.length >= 4);
    iconButtons.forEach(([button]) => assert.match(button, /aria-label=/));
});

test('theme defines minimum touch targets and visible focus styles', () => {
    const css = read('css/titanium-theme.css');

    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /:focus-visible/);
    assert.match(
        css,
        /\.clear-search-btn \{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/
    );
});

test('compact navigation keeps every primary page and analysis submenu reachable', () => {
    const html = read('index-v2.html');
    const css = read('css/titanium-theme.css');
    const mobileCss = css.match(
        /@media \(max-width: 767px\) \{([\s\S]*?)(?=@media \(min-width: 768px\) and \(max-width: 1024px\))/
    )?.[1] || '';

    ['dashboard', 'analysis', 'report', 'rainMonitor', 'rules'].forEach((page) => {
        assert.match(html, new RegExp(`data-page="${page}"`));
    });
    assert.doesNotMatch(mobileCss, /\.nav-submenu\s*\{[^}]*display:\s*none/);
    assert.match(mobileCss, /\.nav-submenu\.open\s*\{[\s\S]*?visibility:\s*visible/);
    assert.match(mobileCss, /\.nav-menu\s*\{[\s\S]*?\n\s*height:\s*48px;[\s\S]*?flex-wrap:\s*nowrap/);
    assert.match(mobileCss, /\.nav-item\s*\{[\s\S]*?\n\s*height:\s*48px;/);
});

test('mobile primary navigation hides text inside its fixed icon targets', () => {
    const css = read('css/titanium-theme.css');
    const mobileCss = css.match(
        /@media \(max-width: 767px\) \{([\s\S]*?)(?=@media \(min-width: 768px\) and \(max-width: 1024px\))/
    )?.[1] || '';

    assert.match(
        mobileCss,
        /\.nav-text,\s*\.nav-expand\s*\{\s*display:\s*none;\s*\}/
    );
});

test('hides header metrics inside the mobile breakpoint', () => {
    const css = read('css/titanium-theme.css');
    const mobileCss = css.match(
        /@media \(max-width: 767px\) \{([\s\S]*?)(?=@media \(min-width: 768px\) and \(max-width: 1024px\))/
    )?.[1] || '';

    assert.match(
        mobileCss,
        /\.header-stats\s*\{\s*display:\s*none;\s*\}/
    );
});

test('keeps the exact 1024px dashboard in the two-column desktop layout', () => {
    const css = read('css/titanium-theme.css');
    const desktopCompactCss = css.slice(
        css.indexOf('@media (max-width: 1439px)'),
        css.indexOf('@media (max-width: 767px)')
    );
    const tabletCss = css.match(
        /@media \(min-width: 768px\) and \(max-width: 1024px\) \{([\s\S]*?)(?=@media \(max-width: 1023px\))/
    )?.[1] || '';

    assert.match(
        desktopCompactCss,
        /\.dashboard-layout \{[\s\S]*?grid-template-columns: minmax\(220px, 0\.8fr\) minmax\(520px, 1\.8fr\)/
    );
    assert.doesNotMatch(tabletCss, /\.dashboard-layout\s*\{/);
    assert.doesNotMatch(tabletCss, /\.dashboard-map\s*\{[\s\S]*?grid-row:\s*1/);
});

test('keeps the tablet analysis submenu beside the icon sidebar and above content', () => {
    const css = read('css/titanium-theme.css');
    const tabletCss = css.match(
        /@media \(min-width: 768px\) and \(max-width: 1024px\) \{([\s\S]*?)(?=@media \(max-width: 1023px\))/
    )?.[1] || '';

    assert.match(
        tabletCss,
        /\.sidebar\s*\{[\s\S]*?z-index:\s*100;[\s\S]*?width:\s*78px;/
    );
    assert.match(
        tabletCss,
        /\.nav-submenu\s*\{[\s\S]*?inset-inline-start:\s*calc\(100% \+ 8px\);/
    );
    assert.match(
        tabletCss,
        /\.nav-submenu\.open\s*\{[\s\S]*?visibility:\s*visible;[\s\S]*?pointer-events:\s*auto;/
    );
});

test('keeps long tablet pages reachable through an explicit content scroll container', () => {
    const css = read('css/titanium-theme.css');
    const tabletCss = css.match(
        /@media \(min-width: 768px\) and \(max-width: 1024px\) \{([\s\S]*?)(?=@media \(max-width: 1023px\))/
    )?.[1] || '';

    assert.match(
        tabletCss,
        /\.main-content\s*\{[\s\S]*?height:\s*100vh;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/
    );
    assert.match(
        tabletCss,
        /\.content-area\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overflow-x:\s*hidden;/
    );
    assert.doesNotMatch(
        tabletCss,
        /\.main-content,\s*\.content-area\s*\{[\s\S]*?overflow:\s*visible;/
    );
});

test('titanium tooltip badge foregrounds meet WCAG AA for every severity color', () => {
    const css = read('css/titanium-theme.css');
    const hexToLuminance = (hex) => {
        const channels = hex.match(/[a-f\d]{2}/gi)
            .map((channel) => Number.parseInt(channel, 16) / 255)
            .map((channel) => channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4);
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (foreground, background) => {
        const foregroundLuminance = hexToLuminance(foreground);
        const backgroundLuminance = hexToLuminance(background);
        const lighter = Math.max(foregroundLuminance, backgroundLuminance);
        const darker = Math.min(foregroundLuminance, backgroundLuminance);
        return (lighter + 0.05) / (darker + 0.05);
    };
    const severityPairs = [
        ['#f5f5f7', '#d0021b'],
        ['#1d1d1f', '#f57c00'],
        ['#1d1d1f', '#f5a623'],
        ['#1d1d1f', '#4a90e2'],
        ['#1d1d1f', '#888888'],
        ['#f5f5f7', '#666666']
    ];

    assert.match(
        css,
        /\.titanium-map-tooltip \.tooltip-badge\[style\*="#F57C00" i\],[\s\S]*?color:\s*#1d1d1f;/
    );
    assert.match(
        css,
        /\.titanium-map-tooltip \.tooltip-badge\[style\*="#D0021B" i\],[\s\S]*?color:\s*#f5f5f7;/
    );
    severityPairs.forEach(([foreground, background]) => {
        assert.ok(
            contrast(foreground, background) >= 4.5,
            `${foreground} on ${background} must meet WCAG AA`
        );
    });
});
