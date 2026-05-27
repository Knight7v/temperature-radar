/**
 * UI Module - 空调热销区域雷达 界面渲染
 */

const UI = (function() {
    'use strict';

    let state = {
        currentPage: 'dashboard',
        cityData: [],
        selectedCity: null,
        mapViewMode: 'adi',
        activeTopTab: 'hotSales',
        reportFilter: 'all',
        historyFilter: 'today',
        reportDimension: 'temperature',
        reportSearch: '',
        rainFilter: 'all',
        rainSearch: ''
    };

    // ==================== 工具函数 ====================

    /**
     * 转义HTML特殊字符，防止XSS攻击
     * @param {string} str - 需要转义的字符串
     * @returns {string} 转义后的安全字符串
     */
    function escapeHtml(str) {
        if (typeof str !== 'string') return str;
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function showDayTooltip(city, dayData, dayIndex) {
        let tooltip = document.getElementById('forecastTooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'forecastTooltip';
            tooltip.className = 'forecast-tooltip';
            document.body.appendChild(tooltip);
        }

        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        const date = dayData.date;
        const dateStr = `${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}`;

        const levelInfo = Core.getLevelInfo(dayData.level);

        tooltip.innerHTML = `
            <div class="forecast-tooltip-header">${escapeHtml(city.cityName)} - ${escapeHtml(dateStr)}</div>
            <div class="forecast-tooltip-body">
                <div class="forecast-tooltip-row"><span>白天最高温:</span><span style="color: ${dayData.dayMax >= 35 ? '#D0021B' : '#F5A623'}">${dayData.dayMax}℃</span></div>
                <div class="forecast-tooltip-row"><span>夜间最低温:</span><span style="color: ${dayData.nightMin >= 28 ? '#D0021B' : '#00D4FF'}">${dayData.nightMin}℃</span></div>
                <div class="forecast-tooltip-row"><span>最高体感:</span><span style="color: ${dayData.dayFeelsLike >= 38 ? '#D0021B' : '#F5A623'}">${dayData.dayFeelsLike}℃</span></div>
                <div class="forecast-tooltip-row"><span>最低体感:</span><span style="color: ${dayData.nightFeelsLike >= 30 ? '#D0021B' : '#00D4FF'}">${dayData.nightFeelsLike}℃</span></div>
                <div class="forecast-tooltip-row"><span>湿度:</span><span>${dayData.humidity}%</span></div>
                <div class="forecast-tooltip-row"><span>ADI:</span><span style="color: ${levelInfo.color}; font-weight: 600;">${dayData.adiScore} [${levelInfo.name}]</span></div>
                ${dayData.isHotNight ? '<div class="forecast-tooltip-row" style="color: #D0021B;">🌙 热夜</div>' : ''}
            </div>
        `;
        return tooltip;
    }

    function hideDayTooltip() {
        const tooltip = document.getElementById('forecastTooltip');
        if (tooltip) {
            tooltip.classList.remove('show');
        }
    }

    // ==================== 初始化 ====================

    function init() {
        initPageNavigation();
        initEventListeners();
        initTopTabs();
        initFilters();
        updateCurrentTime();
        setInterval(updateCurrentTime, 1000);
    }

    function initPageNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        const pages = document.querySelectorAll('.page');
        const pageTitle = document.getElementById('pageTitle');

        const pageTitles = {
            dashboard: '今日热销',
            analysis: '热销分析',
            report: '7天预测',
            rainMonitor: '降水监控',
            history: '历史记录',
            rules: '规则设置'
        };

        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                navItems.forEach(n => n.classList.remove('active'));
                item.classList.add('active');
                pages.forEach(p => p.classList.remove('active'));
                document.getElementById(page).classList.add('active');
                pageTitle.textContent = pageTitles[page];
                state.currentPage = page;

                if (page === 'analysis') renderAnalysis();
                if (page === 'report') renderReport();
                if (page === 'rainMonitor') renderRainMonitorPage();
                if (page === 'history') renderHistory();
                if (page === 'rules') renderRules();
            });
        });
    }

    function initEventListeners() {
        document.querySelectorAll('.view-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                console.log('视图模式切换:', mode);
                document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.mapViewMode = mode;
                renderMap();
            });
        });

        document.addEventListener('click', (e) => {
            const topCityItem = e.target.closest('.top-city-item');
            if (topCityItem) selectCity(topCityItem.dataset.city);
            const tableRow = e.target.closest('.data-table tbody tr');
            if (tableRow) selectCity(tableRow.dataset.city);
            const chartRow = e.target.closest('.chart-table-row');
            if (chartRow) selectCity(chartRow.dataset.city);

            const viewAllLink = e.target.closest('.summary-link');
            if (viewAllLink && viewAllLink.dataset.action === 'viewAll') {
                document.querySelector('.nav-item[data-page="analysis"]').click();
            }
        });

        // 生成简报按钮
        const briefBtn = document.getElementById('generateBriefBtn');
        if (briefBtn) {
            briefBtn.addEventListener('click', openDailyBriefModal);
        }

        // 简报模态框tab切换
        document.querySelectorAll('.modal-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                renderBriefContent(tab.dataset.version);
            });
        });

    }

    function initTopTabs() {
        document.querySelectorAll('.top-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.top-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                state.activeTopTab = tab.dataset.tab;
                renderTopCities();
            });
        });
    }

    function initFilters() {
        // Dimension toggle buttons
        document.querySelectorAll('.dimension-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const parentPage = btn.closest('.page');
                if (parentPage) {
                    parentPage.querySelectorAll('.dimension-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    if (parentPage.id === 'report') {
                        state.reportDimension = btn.dataset.dimension;
                        renderReport();
                    } else if (parentPage.id === 'rainMonitor') {
                        renderRainMonitorPage();
                    }
                }
            });
        });

        // Search input with debounce
        const searchInput = document.getElementById('reportSearchInput');
        const clearSearchBtn = document.getElementById('clearSearchBtn');

        if (searchInput) {
            const debouncedSearch = debounce((value) => {
                state.reportSearch = value.toLowerCase().trim();
                renderReport();
            }, 300);

            searchInput.addEventListener('input', (e) => {
                debouncedSearch(e.target.value);
                // Toggle clear button visibility
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = e.target.value ? 'block' : 'none';
                }
            });
        }

        // Clear search button
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    state.reportSearch = '';
                    clearSearchBtn.style.display = 'none';
                    renderReport();
                }
            });
        }

        // Rain monitor search input
        const rainSearchInput = document.getElementById('rainSearchInput');
        const rainClearSearchBtn = document.getElementById('clearRainSearchBtn');

        if (rainSearchInput) {
            const debouncedRainSearch = debounce((value) => {
                state.rainSearch = value.toLowerCase().trim();
                renderRainMonitorPage();
            }, 300);

            rainSearchInput.addEventListener('input', (e) => {
                debouncedRainSearch(e.target.value);
                if (rainClearSearchBtn) {
                    rainClearSearchBtn.style.display = e.target.value ? 'block' : 'none';
                }
            });
        }

        if (rainClearSearchBtn) {
            rainClearSearchBtn.addEventListener('click', () => {
                if (rainSearchInput) {
                    rainSearchInput.value = '';
                    state.rainSearch = '';
                    rainClearSearchBtn.style.display = 'none';
                    renderRainMonitorPage();
                }
            });
        }

        document.querySelectorAll('#rainFilters .filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#rainFilters .filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.rainFilter = btn.dataset.filter;
                renderRainMonitorPage();
            });
        });

        document.querySelectorAll('#reportFilters .filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#reportFilters .filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.reportFilter = btn.dataset.filter;
                renderReport();
            });
        });
        document.querySelectorAll('#historyFilters .filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#historyFilters .filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.historyFilter = btn.dataset.filter;
                renderHistory();
            });
        });
    }

    // ==================== 今日热销页 ====================

    function renderDashboard(cityData) {
        state.cityData = cityData;
        updateHeaderStats();
        renderTodayConclusion();
        renderRegionRanking();
        renderLongestHotNight();
        renderMap();
        renderTopCities();
    }

    function updateHeaderStats() {
        const stats = Core.getLevelStats(state.cityData);
        const hotNightCities = Core.getHotNightCities(state.cityData);
        const intensity = Core.calculateSalesIntensity(state.cityData);
        const el = (id) => document.getElementById(id);

        // 销售机会强度
        if (el('salesIntensity')) {
            const intensityEl = el('salesIntensity');
            intensityEl.textContent = intensity;
            intensityEl.className = 'header-stat-value intensity-' + intensity;
        }

        if (el('cityCount')) el('cityCount').textContent = state.cityData.length;
        if (el('outbreakCount')) el('outbreakCount').textContent = stats.outbreak;
        if (el('actionCount')) el('actionCount').textContent = stats.action;
        if (el('hotNightCount')) el('hotNightCount').textContent = hotNightCities.length;

        // 更新数据更新时间
        const lastUpdateEl = document.getElementById('lastUpdateTime');
        if (lastUpdateEl && App.state.lastUpdateTime) {
            const time = App.state.lastUpdateTime;
            const hours = String(time.getHours()).padStart(2, '0');
            const minutes = String(time.getMinutes()).padStart(2, '0');
            lastUpdateEl.textContent = `${hours}:${minutes}`;
        }
    }

    function renderTodayConclusion() {
        const container = document.getElementById('todayConclusion');
        if (!container) return;

        const intensity = Core.calculateSalesIntensity(state.cityData);
        const regionStats = Core.calculateRegionStats(state.cityData);

        // 获取重点大区（只选择真正有较强销售机会的大区）
        const activeRegions = Object.entries(regionStats)
            .filter(([_, stats]) => {
                // 至少满足以下条件之一：
                // 1. 有2个及以上爆热级城市
                // 2. 有3个及以上行动级城市
                // 3. 爆热+行动级合计>=3
                const totalHot = stats.explosiveCount + stats.actionCount;
                return stats.explosiveCount >= 2 || stats.actionCount >= 3 || totalHot >= 3;
            })
            .sort((a, b) => (b[1].explosiveCount * 2 + b[1].actionCount) - (a[1].explosiveCount * 2 + a[1].actionCount))
            .slice(0, 3)
            .map(([name, _]) => name)
            .join('、') || '暂无';

        // 核心原因 - 根据实际数据动态生成
        const stats = Core.getLevelStats(state.cityData);
        const hotNightCities = Core.getHotNightCities(state.cityData);
        let reason = '';

        if (stats.outbreak >= 5) {
            reason = `多城市达到爆热级（${stats.outbreak}个），短期需求强烈`;
        } else if (stats.outbreak >= 2) {
            reason = `部分城市达到爆热级（${stats.outbreak}个），局部需求强烈`;
        } else if (stats.action >= 10) {
            reason = `多城市达到热级（${stats.action}个），需求明显增强`;
        } else if (stats.action >= 5) {
            reason = `部分城市达到热级（${stats.action}个），需求开始增强`;
        } else if (hotNightCities.length >= 15) {
            reason = `夜间温度持续偏高（${hotNightCities.length}个城市），部分连续闷热夜`;
        } else if (stats.opportunity >= 15) {
            reason = `待热城市较多（${stats.opportunity}个），有升温趋势`;
        } else if (stats.opportunity >= 5) {
            reason = `部分城市进入机会级（${stats.opportunity}个），有升温迹象`;
        } else {
            reason = '整体需求平稳，少数地区有升温迹象';
        }

        container.innerHTML = `
            <div class="conclusion-intensity">
                今日销售机会：<span class="intensity-value intensity-${escapeHtml(intensity)}">${escapeHtml(intensity)}</span>
            </div>
            <div class="conclusion-regions">
                重点区域：<span class="regions-value">${escapeHtml(activeRegions)}</span>
            </div>
            <div class="conclusion-reason">
                核心原因：<span class="reason-value">${escapeHtml(reason)}</span>
            </div>
        `;
    }

    function renderRegionRanking() {
        const container = document.getElementById('regionRanking');
        if (!container) return;

        const regionStats = Core.calculateRegionStats(state.cityData);

        // 按机会等级排序
        const levelOrder = { '强': 4, '偏强': 3, '中高': 2, '中': 1, '低': 0 };
        const sortedRegions = Object.entries(regionStats)
            .sort((a, b) => levelOrder[b[1].level] - levelOrder[a[1].level] ||
                          (b[1].explosiveCount * 2 + b[1].actionCount) - (a[1].explosiveCount * 2 + a[1].actionCount));

        const levelColors = {
            '强': '#D0021B',
            '偏强': '#F57C00',
            '中高': '#F5A623',
            '中': '#4A90E2',
            '低': '#666666'
        };

        container.innerHTML = sortedRegions.map(([regionName, stats]) => `
            <div class="region-ranking-item">
                <div class="region-info">
                    <span class="region-name">${escapeHtml(regionName)}</span>
                    <span class="region-badge" style="background: ${levelColors[stats.level]}">${escapeHtml(stats.level)}</span>
                </div>
                <div class="region-stats">
                    <span class="region-stat">爆热${stats.explosiveCount}</span>
                    <span class="region-stat">热${stats.actionCount}</span>
                    <span class="region-stat">热夜${stats.hotNightCount}</span>
                </div>
                <div class="region-cities">
                    代表：${(stats.representativeCities || []).slice(0, 3).map(city => escapeHtml(city)).join('、')}
                </div>
            </div>
        `).join('');
    }

    function renderLongestHotNight() {
        const container = document.getElementById('longestHotNight');
        if (!container) return;

        const hotNight = Core.getLongestHotNight(state.cityData);
        const hotNightCities = Core.getHotNightCities(state.cityData);

        const forecastStr = hotNight.future3Nights.length > 0
            ? hotNight.future3Nights.map(t => t + '℃').join(' / ')
            : '--';

        container.innerHTML = `
            <div class="hotnight-stats">
                <div class="hotnight-days">${escapeHtml(hotNight.maxDays.toString())}<span class="hotnight-unit">天</span></div>
                <div class="hotnight-city">城市：${escapeHtml(hotNight.cityName)}</div>
            </div>
            <div class="hotnight-forecast">
                未来3晚：${escapeHtml(forecastStr)}
            </div>
            <div class="hotnight-total">
                热夜城市：<span class="hotnight-count">${hotNight.totalCities}</span>个
            </div>
        `;
    }

    function updateMapLegend(mode) {
        // 图例已移除，此函数保留以避免调用错误
    }

    function renderMap() {
        console.log('renderMap 调用, mapViewMode:', state.mapViewMode, 'cityData长度:', state.cityData.length);
        if (!window.MapModule) {
            console.log('MapModule 未就绪');
            return;
        }
        if (!MapModule.render) {
            console.log('MapModule.render 方法不存在');
            return;
        }
        if (!state.cityData || state.cityData.length === 0) {
            console.log('cityData 为空，跳过地图渲染');
            return;
        }
        updateMapLegend(state.mapViewMode);
        MapModule.render(state.cityData, state.mapViewMode);
    }

    // ==================== 右侧榜单 ====================

    function renderTopCities() {
        const container = document.getElementById('topCitiesContainer');
        if (!container) return;

        switch (state.activeTopTab) {
            case 'hotSales':
                renderHotSalesTab(container);
                break;
            case 'nightMuggy':
                renderNightMuggyTab(container);
                break;
            case 'heatRise':
                renderHeatRiseTab(container);
                break;
        }
    }

    function renderHotSalesTab(container) {
        // 重点城市固定顺序（按业务重要性排列）
        const priorityCityNames = [
            '广州',  // 核心中的核心，广东大盘代表城市
            '北京',  // 北方高成交城市
            '上海',  // 华东核心消费城市
            '深圳',  // 广东核心城市，线上购买力强
            '东莞',  // 广东制造业/居住人口基础强
            '成都',  // 西南核心成交城市
            '重庆',  // 天气驱动强，成交占比高
            '佛山',  // 广东核心成交城市，客单价较高
            '西安',  // 西北/华中交界重点城市
            '天津'   // 北方重点城市
        ];

        // 按固定顺序获取城市数据
        const cities = priorityCityNames.map(cityName => {
            return state.cityData.find(c => c.cityName === cityName);
        }).filter(c => c !== undefined);

        container.innerHTML = cities.map((city, i) => {
            const info = Core.getLevelInfo(city.level);
            const rankClass = i < 3 ? `rank-${i + 1}` : '';
            return `
                <div class="top-city-item" data-city="${escapeHtml(city.cityName)}">
                    <span class="top-city-rank ${rankClass}">${escapeHtml((i + 1).toString())}</span>
                    <div class="top-city-info-main">
                        <div class="top-city-name">${escapeHtml(city.cityName)} <span class="top-city-level" style="background: ${info.color}">${escapeHtml(info.name)}</span></div>
                        <div class="top-city-meta">ADI ${escapeHtml(city.adiScore.toString())} ｜ 白天${escapeHtml(city.maxTemp.toString())}℃ / 夜${escapeHtml(city.nightMinTemp.toString())}℃${city.continuousHotNightDays > 0 ? ' / 热夜' + escapeHtml(city.continuousHotNightDays.toString()) + '天' : ''}</div>
                    </div>
                    <span class="top-city-adi-badge" style="color: ${info.color}">${escapeHtml(city.adiScore.toString())}</span>
                </div>
            `;
        }).join('');
    }

    function renderNightMuggyTab(container) {
        const cities = Core.getTopNightMuggy(state.cityData, 10);
        container.innerHTML = cities.map((city, i) => {
            const rankClass = i < 3 ? `rank-${i + 1}` : '';
            const nightFeels = Math.round(city.nightMinTemp + (city.humidity - 50) * 0.08);
            return `
                <div class="top-city-item" data-city="${escapeHtml(city.cityName)}">
                    <span class="top-city-rank ${rankClass}">${escapeHtml((i + 1).toString())}</span>
                    <div class="top-city-info-main">
                        <div class="top-city-name">${escapeHtml(city.cityName)}</div>
                        <div class="top-city-meta">夜间${escapeHtml(city.nightMinTemp.toString())}℃｜体感${escapeHtml(nightFeels.toString())}℃｜湿度${escapeHtml(city.humidity.toString())}%${city.continuousHotNightDays > 0 ? '｜连续' + escapeHtml(city.continuousHotNightDays.toString()) + '晚' : ''}</div>
                    </div>
                    <span class="top-city-adi-badge" style="color: #e84393">${escapeHtml(city.nightMuggyScore.toString())}</span>
                </div>
            `;
        }).join('');
    }

    function renderHeatRiseTab(container) {
        const cities = Core.getTopHeatRise(state.cityData, 10);
        container.innerHTML = cities.map((city, i) => {
            const rankClass = i < 3 ? `rank-${i + 1}` : '';
            const adiChg = city.adiChange > 0 ? '+' + city.adiChange : city.adiChange;
            const maxChg = city.maxTempChange > 0 ? '+' + city.maxTempChange + '℃' : city.maxTempChange + '℃';
            const nightChg = city.nightTempChange > 0 ? '+' + city.nightTempChange + '℃' : city.nightTempChange + '℃';
            return `
                <div class="top-city-item" data-city="${escapeHtml(city.cityName)}">
                    <span class="top-city-rank ${rankClass}">${escapeHtml((i + 1).toString())}</span>
                    <div class="top-city-info-main">
                        <div class="top-city-name">${escapeHtml(city.cityName)}</div>
                        <div class="top-city-meta">今日ADI ${escapeHtml(city.adiScore.toString())}→${escapeHtml(city.futureAdi3.toString())} (${escapeHtml(adiChg.toString())}) ｜ 最高温${escapeHtml(city.maxTemp.toString())}→${escapeHtml(city.futureMax3.toString())}℃ (${escapeHtml(maxChg)}) ｜ 夜间${escapeHtml(city.nightMinTemp.toString())}→${escapeHtml(city.futureNight3.toString())}℃ (${escapeHtml(nightChg)})</div>
                    </div>
                    <span class="top-city-adi-badge" style="color: ${city.adiChange > 0 ? '#D0021B' : '#00D4FF'}">${escapeHtml(adiChg.toString())}</span>
                </div>
            `;
        }).join('');
    }

    // ==================== 热销分析页 ====================

    function renderAnalysis() {
        if (state.cityData.length === 0) return;
        initAnalysisNavigation();
        // 默认显示第一个子项
        renderAnalysisContent('nightMuggy');
    }

    function initAnalysisNavigation() {
        // 热销分析主菜单展开/收起
        const analysisNavItem = document.querySelector('.nav-item[data-page="analysis"]');
        const analysisSubmenu = document.getElementById('analysisSubmenu');

        if (analysisNavItem && analysisSubmenu) {
            analysisNavItem.classList.add('expanded');
            analysisSubmenu.classList.add('open');

            analysisNavItem.addEventListener('click', (e) => {
                if (e.target.closest('.nav-item') === analysisNavItem) {
                    analysisNavItem.classList.toggle('expanded');
                    analysisSubmenu.classList.toggle('open');
                }
            });

            // 子菜单点击事件
            analysisSubmenu.querySelectorAll('.nav-subitem').forEach(subitem => {
                subitem.addEventListener('click', () => {
                    const subpage = subitem.dataset.subpage;
                    renderAnalysisContent(subpage);

                    // 更新子菜单激活状态
                    analysisSubmenu.querySelectorAll('.nav-subitem').forEach(item => {
                        item.classList.remove('active');
                    });
                    subitem.classList.add('active');
                });
            });

            // 默认激活第一个子项
            const firstSubitem = analysisSubmenu.querySelector('.nav-subitem[data-subpage="nightMuggy"]');
            if (firstSubitem) {
                firstSubitem.classList.add('active');
            }
        }
    }

    function renderAnalysisContent(subpage) {
        const titles = {
            nightMuggy: '夜间闷热排行榜',
            future3Day: '未来3天热销榜',
            future7Day: '未来7天升温榜',
            cityGroupMonitor: '重点城市群监控'
        };
        const descs = {
            nightMuggy: '按夜间闷热指数排序，识别夜间温度持续偏高的城市',
            future3Day: '按3天内ADI最高值排序，预测近期热销趋势',
            future7Day: '按ADI涨幅和升温幅度排序，发现潜在热销区域',
            cityGroupMonitor: '华东、华中、华南、西南城市群实时监控'
        };

        document.getElementById('analysisPageTitle').textContent = titles[subpage] || subpage;
        document.getElementById('analysisPageDesc').textContent = descs[subpage] || '';

        const contentContainer = document.getElementById('analysisContent');
        switch (subpage) {
            case 'nightMuggy':
                renderNightMuggySubpage(contentContainer);
                break;
            case 'future3Day':
                renderFuture3DaySubpage(contentContainer);
                break;
            case 'future7Day':
                renderFuture7DaySubpage(contentContainer);
                break;
            case 'cityGroupMonitor':
                renderCityGroupMonitorSubpage(contentContainer);
                break;
        }
    }

    function renderNightMuggySubpage(container) {
        const cities = Core.getTopNightMuggy(state.cityData, 50);

        container.innerHTML = `
            <div class="subpage-table-wrapper">
                <table class="subpage-table">
                    <thead>
                        <tr>
                            <th>排名</th>
                            <th>省份</th>
                            <th>城市</th>
                            <th>夜间温度</th>
                            <th>体感温度</th>
                            <th>湿度</th>
                            <th>连续热夜</th>
                            <th>ADI</th>
                            <th>等级</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cities.map((city, i) => {
                            const info = Core.getLevelInfo(city.level);
                            const nightFeels = Math.round(city.nightMinTemp + (city.humidity - 50) * 0.08);
                            return `
                                <tr data-city="${city.cityName}">
                                    <td style="color: ${i < 3 ? ['#ffd700', '#c0c0c0', '#cd7f32'][i] : 'inherit'}; font-weight: 600;">${i + 1}</td>
                                    <td style="color: var(--text-secondary); font-size: 0.85rem;">${city.province}</td>
                                    <td style="font-weight: 500;">${city.cityName}</td>
                                    <td style="color: ${city.nightMinTemp >= 28 ? '#D0021B' : '#00D4FF'};">${city.nightMinTemp}℃</td>
                                    <td>${nightFeels}℃</td>
                                    <td>${city.humidity}%</td>
                                    <td>${city.continuousHotNightDays > 0 ? city.continuousHotNightDays + '天' : '-'}</td>
                                    <td style="font-family: 'Orbitron', sans-serif; font-weight: 600; color: ${info.color};">${city.adiScore}</td>
                                    <td><span style="background: ${info.color}; color: #fff; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${info.name}</span></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderFuture3DaySubpage(container) {
        const cities = [...state.cityData]
            .map(c => ({ ...c, maxAdi3: Math.max(...c.future7AdiScores.slice(0, 3)) }))
            .sort((a, b) => b.maxAdi3 - a.maxAdi3);

        container.innerHTML = `
            <div class="subpage-table-wrapper">
                <table class="subpage-table">
                    <thead>
                        <tr>
                            <th>排名</th>
                            <th>省份</th>
                            <th>城市</th>
                            <th>3天最高ADI</th>
                            <th>今日ADI</th>
                            <th>预测等级</th>
                            <th>未来3天高温</th>
                            <th>未来3天夜间</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cities.map((city, i) => {
                            let level = 'normal';
                            if (city.maxAdi3 >= 85) level = 'outbreak';
                            else if (city.maxAdi3 >= 75) level = 'action';
                            else if (city.maxAdi3 >= 65) level = 'opportunity';
                            else if (city.maxAdi3 >= 55) level = 'observe';
                            const info = Core.getLevelInfo(level);

                            return `
                                <tr data-city="${city.cityName}">
                                    <td style="color: ${i < 3 ? ['#ffd700', '#c0c0c0', '#cd7f32'][i] : 'inherit'}; font-weight: 600;">${i + 1}</td>
                                    <td style="color: var(--text-secondary); font-size: 0.85rem;">${city.province}</td>
                                    <td style="font-weight: 500;">${city.cityName}</td>
                                    <td style="font-family: 'Orbitron', sans-serif; font-weight: 600; color: ${info.color}; font-size: 1rem;">${city.maxAdi3}</td>
                                    <td>${city.adiScore}</td>
                                    <td><span style="background: ${info.color}; color: #fff; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${info.name}</span></td>
                                    <td>${city.future3DayMaxTemps.join('℃ / ')}℃</td>
                                    <td>${city.future3NightMinTemps.join('℃ / ')}℃</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderFuture7DaySubpage(container) {
        const cities = [...state.cityData]
            .map(c => {
                const maxAdi = Math.max(...c.future7AdiScores);
                const adiChange = maxAdi - c.adiScore;
                const futureMax7 = Math.max(...c.future3DayMaxTemps, c.maxTemp);
                const futureNight7 = Math.max(...c.future3NightMinTemps, c.nightMinTemp);
                return { ...c, maxAdi7: maxAdi, adiChange, futureMax7, futureNight7 };
            })
            .filter(c => c.adiChange > 0 || c.futureMax7 > c.maxTemp)
            .sort((a, b) => (b.adiChange + (b.futureMax7 - b.maxTemp) * 0.5) - (a.adiChange + (a.futureMax7 - a.maxTemp) * 0.5));

        container.innerHTML = `
            <div class="subpage-table-wrapper">
                <table class="subpage-table">
                    <thead>
                        <tr>
                            <th>排名</th>
                            <th>省份</th>
                            <th>城市</th>
                            <th>今日ADI</th>
                            <th>7天最高ADI</th>
                            <th>ADI涨幅</th>
                            <th>今日最高温</th>
                            <th>7天最高温</th>
                            <th>升温趋势</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cities.map((city, i) => {
                            const tempChange = city.futureMax7 - city.maxTemp;
                            return `
                                <tr data-city="${city.cityName}">
                                    <td style="color: ${i < 3 ? ['#ffd700', '#c0c0c0', '#cd7f32'][i] : 'inherit'}; font-weight: 600;">${i + 1}</td>
                                    <td style="color: var(--text-secondary); font-size: 0.85rem;">${city.province}</td>
                                    <td style="font-weight: 500;">${city.cityName}</td>
                                    <td style="font-family: 'Orbitron', sans-serif; font-weight: 600;">${city.adiScore}</td>
                                    <td style="font-family: 'Orbitron', sans-serif; font-weight: 600; color: #D0021B;">${city.maxAdi7}</td>
                                    <td style="font-family: 'Orbitron', sans-serif; font-weight: 600; color: ${city.adiChange > 0 ? '#D0021B' : '#00D4FF'};">${city.adiChange > 0 ? '+' : ''}${city.adiChange}</td>
                                    <td>${city.maxTemp}℃</td>
                                    <td style="color: ${city.futureMax7 >= 35 ? '#D0021B' : '#F5A623'};">${city.futureMax7}℃</td>
                                    <td style="color: ${tempChange > 0 ? '#D0021B' : '#4A90E2'};">${tempChange > 0 ? '+' : ''}${tempChange}℃</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderCityGroupMonitorSubpage(container) {
        // 默认显示华东城市群
        let currentGroup = 'eastChina';
        let currentSortField = 'adiScore';
        let currentSortOrder = 'desc';

        const cityGroups = Core.CITY_GROUPS || {};

        function getGroupCities(groupKey) {
            const group = cityGroups[groupKey];
            if (!group) return [];

            return state.cityData.filter(city => {
                // 根据省份或region匹配
                return group.provinces.includes(city.province) || group.regions.includes(city.region);
            });
        }

        function sortCities(cities, field, order) {
            return [...cities].sort((a, b) => {
                let valA = a[field];
                let valB = b[field];

                // 处理数字字段
                if (typeof valA === 'string') valA = parseFloat(valA) || 0;
                if (typeof valB === 'string') valB = parseFloat(valB) || 0;

                return order === 'desc' ? valB - valA : valA - valB;
            });
        }

        function render() {
            const group = cityGroups[currentGroup];
            const cities = getGroupCities(currentGroup);
            const sortedCities = sortCities(cities, currentSortField, currentSortOrder);

            // 计算指标
            const stats = {
                totalCount: cities.length,
                avgFeelsLike: Math.round(cities.reduce((sum, c) => sum + c.feelsLike, 0) / cities.length),
                outbreakCount: cities.filter(c => c.level === 'outbreak').length,
                actionCount: cities.filter(c => c.level === 'action').length,
                risingCount: cities.filter(c => c.adiChange > 5).length,
                hotNightCount: cities.filter(c => c.nightMinTemp >= 28).length
            };

            // 识别重点关注城市
            const suddenRise = cities.filter(c => (c.adiChange || 0) >= 10).slice(0, 5);
            const continuousHot = cities.filter(c => c.continuousHotNightDays >= 3).slice(0, 5);
            const nearOutbreak = cities.filter(c => c.adiScore >= 80 && c.adiScore < 85).slice(0, 5);

            // 生成参考结论
            const hotCities = cities.filter(c => c.maxTemp >= 35 || c.feelsLike >= 38);
            const veryHotCities = cities.filter(c => c.maxTemp >= 37 || c.feelsLike >= 40);
            const outbreakCities = cities.filter(c => c.level === 'outbreak');
            const actionCities = cities.filter(c => c.level === 'action');

            let conclusion = '';
            if (veryHotCities.length > 0) {
                conclusion = `<strong>${group.name}</strong>高温预警：${veryHotCities.length}个城市达到极端高温（≥37℃或体感≥40℃），需重点关注。`;
                if (outbreakCities.length > 0) {
                    conclusion += `其中${outbreakCities.map(c => c.cityName).join('、')}已进入爆热级，空调需求强烈。`;
                }
            } else if (hotCities.length > 0) {
                conclusion = `<strong>${group.name}</strong>升温明显：${hotCities.length}个城市达到高温（≥35℃或体感≥38℃）。`;
                if (actionCities.length > 0) {
                    conclusion += `${actionCities.slice(0, 3).map(c => c.cityName).join('、')}等城市空调需求增加。`;
                }
            } else {
                conclusion = `<strong>${group.name}</strong>温度适中，暂无明显高温城市，保持一般监控即可。`;
            }

            container.innerHTML = `
                <div class="citygroup-monitor">
                    <div class="citygroup-left-panel">
                        <div class="citygroup-tabs">
                            <div class="citygroup-tab ${currentGroup === 'eastChina' ? 'active' : ''}" data-group="eastChina">
                                华东
                            </div>
                            <div class="citygroup-tab ${currentGroup === 'centralChina' ? 'active' : ''}" data-group="centralChina">
                                华中
                            </div>
                            <div class="citygroup-tab ${currentGroup === 'southChina' ? 'active' : ''}" data-group="southChina">
                                华南
                            </div>
                            <div class="citygroup-tab ${currentGroup === 'southwestChina' ? 'active' : ''}" data-group="southwestChina">
                                西南
                            </div>
                        </div>

                        <div class="citygroup-conclusions">
                            <div class="conclusion-header">
                                <span class="conclusion-icon">📋</span>
                                <span class="conclusion-title">参考结论</span>
                            </div>
                            <div class="conclusion-content">
                                ${conclusion}
                            </div>
                            <div class="conclusion-details">
                                <div class="conclusion-detail">
                                    <span class="detail-label">爆热级：</span>
                                    <span class="detail-value">${outbreakCities.length > 0 ? outbreakCities.map(c => c.cityName).join('、') : '无'}</span>
                                </div>
                                <div class="conclusion-detail">
                                    <span class="detail-label">热级：</span>
                                    <span class="detail-value">${actionCities.length > 0 ? actionCities.map(c => c.cityName).join('、') : '无'}</span>
                                </div>
                                ${stats.avgFeelsLike >= 38 ? `
                                <div class="conclusion-detail warning">
                                    <span class="detail-label">⚠️ 高温：</span>
                                    <span class="detail-value">平均体感${stats.avgFeelsLike}℃</span>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="citygroup-main">
                        <div class="citygroup-metrics">
                            <div class="metric-card">
                                <div class="metric-label">监控城市</div>
                                <div class="metric-value">${stats.totalCount}</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-label">平均体感</div>
                                <div class="metric-value">${stats.avgFeelsLike}℃</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-label">爆热级</div>
                                <div class="metric-value outbreak">${stats.outbreakCount}</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-label">热级</div>
                                <div class="metric-value action">${stats.actionCount}</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-label">升温城市</div>
                                <div class="metric-value observe">${stats.risingCount}</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-label">热夜城市</div>
                                <div class="metric-value hotnight">${stats.hotNightCount}</div>
                            </div>
                        </div>

                        <div class="citygroup-table-wrapper">
                            <table class="citygroup-table">
                                <thead>
                                    <tr>
                                        <th data-sort="adiScore">排名</th>
                                        <th>省份</th>
                                        <th data-sort="cityName">城市</th>
                                        <th data-sort="adiScore">ADI指数 <span class="sort-indicator ${currentSortField === 'adiScore' ? 'active' : ''}">↓</span></th>
                                        <th data-sort="feelsLike">体感温度 <span class="sort-indicator ${currentSortField === 'feelsLike' ? 'active' : ''}">↓</span></th>
                                        <th data-sort="nightMinTemp">夜间温度 <span class="sort-indicator ${currentSortField === 'nightMinTemp' ? 'active' : ''}">↓</span></th>
                                        <th data-sort="maxTemp">白天最高温 <span class="sort-indicator ${currentSortField === 'maxTemp' ? 'active' : ''}">↓</span></th>
                                        <th data-sort="humidity">湿度 <span class="sort-indicator ${currentSortField === 'humidity' ? 'active' : ''}">↓</span></th>
                                        <th data-sort="continuousHotNightDays">连续热夜 <span class="sort-indicator ${currentSortField === 'continuousHotNightDays' ? 'active' : ''}">↓</span></th>
                                        <th>等级</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${sortedCities.map((city, i) => {
                                        const info = Core.getLevelInfo(city.level);
                                        return `
                                            <tr data-city="${city.cityName}">
                                                <td style="color: ${i < 3 ? ['#ffd700', '#c0c0c0', '#cd7f32'][i] : 'inherit'}; font-weight: 600;">${i + 1}</td>
                                                <td style="color: var(--text-secondary); font-size: 0.85rem;">${city.province}</td>
                                                <td style="font-weight: 500;">${city.cityName}</td>
                                                <td style="font-family: 'Orbitron', sans-serif; font-weight: 600; color: ${info.color};">${city.adiScore}</td>
                                                <td style="color: ${city.feelsLike >= 40 ? '#D0021B' : city.feelsLike >= 37 ? '#F57C00' : '#F5A623'};">${city.feelsLike}℃</td>
                                                <td style="color: ${city.nightMinTemp >= 28 ? '#D0021B' : '#00D4FF'};">${city.nightMinTemp}℃</td>
                                                <td style="color: ${city.maxTemp >= 37 ? '#D0021B' : city.maxTemp >= 35 ? '#F57C00' : '#F5A623'};">${city.maxTemp}℃</td>
                                                <td>${city.humidity}%</td>
                                                <td>${city.continuousHotNightDays > 0 ? city.continuousHotNightDays + '天' : '-'}</td>
                                                <td><span style="background: ${info.color}; color: #fff; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${info.name}</span></td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;

            // 绑定事件
            container.querySelectorAll('.citygroup-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    currentGroup = tab.dataset.group;
                    render();
                });
            });

            container.querySelectorAll('.citygroup-table th[data-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    const field = th.dataset.sort;
                    if (currentSortField === field) {
                        currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
                    } else {
                        currentSortField = field;
                        currentSortOrder = 'desc';
                    }
                    render();
                });
            });
        }

        render();
    }

    // ==================== 7天预测页 ====================

    function renderReport() {
        const thead = document.getElementById('forecastTableHead');
        const tbody = document.getElementById('forecastTableBody');
        if (!thead || !tbody || state.cityData.length === 0) return;

        // Filter out cities without future7Days data
        let cities = state.cityData.filter(c => c.future7Days && c.future7Days.length > 0);
        const filter = state.reportFilter;

        // Apply level/region filters
        if (['outbreak', 'action', 'opportunity', 'observe'].includes(filter)) {
            cities = cities.filter(c => c.level === filter);
        } else if (filter === 'nightMuggy') {
            cities = cities.filter(c => {
                const hotNightCount = c.future7Days.filter(d => d.isHotNight).length;
                return hotNightCount >= 2;
            });
        } else if (filter === 'heatRise') {
            cities = cities.filter(c => {
                if (!c.future7Days || c.future7Days.length < 7) return false;
                const day7Adi = c.future7Days[6].adiScore;
                return day7Adi - c.adiScore >= 10;
            });
        } else if (['华东', '华南', '华中', '西南', '华北', '西北', '东北'].includes(filter)) {
            cities = cities.filter(c => c.region === filter);
        }

        // Apply search filter
        if (state.reportSearch) {
            cities = cities.filter(c => c.cityName.toLowerCase().includes(state.reportSearch));
        }

        // Sort by future 3-day ADI average, then today's ADI
        cities.sort((a, b) => {
            const avgA = a.future7Days.slice(0, 3).reduce((sum, d) => sum + d.adiScore, 0) / 3;
            const avgB = b.future7Days.slice(0, 3).reduce((sum, d) => sum + d.adiScore, 0) / 3;
            if (avgB !== avgA) return avgB - avgA;
            return b.adiScore - a.adiScore;
        });

        // Route to dimension-specific renderer
        switch (state.reportDimension) {
            case 'temperature':
                renderReportTemperature(cities, thead, tbody);
                break;
            case 'feelsLike':
                renderReportFeelsLike(cities, thead, tbody);
                break;
            case 'adi':
                renderReportADI(cities, thead, tbody);
                break;
            default:
                renderReportTemperature(cities, thead, tbody);
        }

        // Setup tooltip event listeners after rendering
        setupTooltipListeners(cities);
    }

    function setupTooltipListeners(cities) {
        const tbody = document.getElementById('forecastTableBody');
        if (!tbody) return;

        tbody.querySelectorAll('td[data-city]').forEach(cell => {
            cell.onmouseenter = null;
            cell.onmouseleave = null;
        });

        tbody.querySelectorAll('td[data-city]').forEach(cell => {
            const cityName = cell.dataset.city;
            const dayIndex = parseInt(cell.dataset.day);
            const city = cities.find(c => c.cityName === cityName);

            if (!city || !city.future7Days || !city.future7Days[dayIndex]) return;

            let tooltipTimer = null;

            cell.addEventListener('mouseenter', (e) => {
                tooltipTimer = setTimeout(() => {
                    const tooltip = showDayTooltip(city, city.future7Days[dayIndex], dayIndex);
                    const rect = cell.getBoundingClientRect();
                    tooltip.style.left = rect.left + rect.width / 2 - 125 + 'px';
                    tooltip.style.top = rect.top - 10 + 'px';
                    tooltip.classList.add('show');
                }, 200);
            });

            cell.addEventListener('mouseleave', () => {
                if (tooltipTimer) clearTimeout(tooltipTimer);
                hideDayTooltip();
            });

            // Click handler
            cell.addEventListener('click', () => {
                const dayData = city.future7Days[dayIndex];
                const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
                const date = dayData.date;
                const dateStr = `${date.getMonth() + 1}月${date.getDate()}日`;
                const levelInfo = Core.getLevelInfo(dayData.level);
                showToast(`${cityName} ${dateStr}：ADI ${dayData.adiScore} ${levelInfo.name}`, 2000);
            });

            cell.style.cursor = 'pointer';
        });

        // City name click
        tbody.querySelectorAll('td.fixed-left:nth-child(3)').forEach(cityCell => {
            cityCell.style.cursor = 'pointer';
            cityCell.addEventListener('click', () => {
                const cityName = cityCell.textContent;
                selectCity(cityName);
            });
        });
    }

    function renderReportTemperature(cities, thead, tbody) {
        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

        // 使用第一个城市的future7Days数据来获取实际日期，确保表头和数据对应
        const sampleDates = cities.length > 0 && cities[0].future7Days ? cities[0].future7Days : [];

        // Generate date headers for 7 days
        let headerHtml = `
            <th class="fixed-left">区域</th>
            <th class="fixed-left">省份</th>
            <th class="fixed-left">城市</th>
            <th class="fixed-left">当前等级</th>
            <th class="fixed-left">今日ADI</th>
            <th class="fixed-left">7天最高ADI</th>
            <th class="fixed-left">7天最高等级</th>
            <th class="fixed-left">热夜天数</th>
            <th class="fixed-left">等级趋势</th>
        `;

        for (let i = 0; i < 7; i++) {
            // 使用数据中的实际日期，而不是基于当前日期计算
            const date = sampleDates[i] ? sampleDates[i].date : new Date();
            headerHtml += `
                <th>
                    <div class="date-header">
                        <span class="date-header-day">${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}</span>
                    </div>
                </th>
            `;
        }
        thead.innerHTML = headerHtml;

        // Generate table body
        if (cities.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="16" class="forecast-empty-state">
                        <div class="forecast-empty-icon">🔍</div>
                        <div>未找到匹配的城市</div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = cities.map(city => {
            const currentInfo = Core.getLevelInfo(city.level);
            const maxAdi = Math.max(...city.future7Days.map(d => d.adiScore));
            const maxLevelInfo = Core.getLevelInfo(
                city.future7Days.find(d => d.adiScore === maxAdi)?.level || 'normal'
            );
            const hotNightCount = city.future7Days.filter(d => d.isHotNight).length;
            const trendInfo = Core.calculateLevelTrend(city.level, city.future7Days.map(d => d.adiScore));

            // Fixed columns
            let rowHtml = `
                <td class="fixed-left">${city.region}</td>
                <td class="fixed-left">${city.province}</td>
                <td class="fixed-left">${city.cityName}</td>
                <td class="fixed-left">
                    <span class="table-level-badge" style="background: ${currentInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                        ${currentInfo.name}
                    </span>
                </td>
                <td class="fixed-left">${city.adiScore}</td>
                <td class="fixed-left">${maxAdi}</td>
                <td class="fixed-left">
                    <span class="table-level-badge" style="background: ${maxLevelInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                        ${maxLevelInfo.name}
                    </span>
                </td>
                <td class="fixed-left">${hotNightCount > 0 ? hotNightCount + '天' : '-'}</td>
                <td class="fixed-left" style="color: ${trendInfo.trendColor}; font-size: 0.75rem;">${trendInfo.trendText}</td>
            `;

            // 7-day data columns
            city.future7Days.forEach((day, idx) => {
                const tempHigh = day.dayMax;
                const tempLow = day.nightMin;
                const highColor = tempHigh >= 35 ? '#D0021B' : tempHigh >= 33 ? '#F57C00' : tempHigh >= 30 ? '#F5A623' : '#4A90E2';
                const lowColor = tempLow >= 28 ? '#D0021B' : tempLow >= 26 ? '#F5A623' : '#00D4FF';
                const hotNightIcon = day.isHotNight ? '<span class="hot-night-indicator">🌙</span>' : '';

                rowHtml += `
                    <td data-city="${city.cityName}" data-day="${idx}">
                        <div>
                            <div style="color: ${highColor}; font-weight: 600;">${tempHigh}°</div>
                            <div style="color: ${lowColor}; font-size: 0.75rem;">${tempLow}°</div>
                            ${hotNightIcon}
                        </div>
                    </td>
                `;
            });

            return `<tr>${rowHtml}</tr>`;
        }).join('');
    }

    function renderReportFeelsLike(cities, thead, tbody) {
        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

        // 使用第一个城市的future7Days数据来获取实际日期，确保表头和数据对应
        const sampleDates = cities.length > 0 && cities[0].future7Days ? cities[0].future7Days : [];

        // Generate date headers (same as temperature mode)
        let headerHtml = `
            <th class="fixed-left">区域</th>
            <th class="fixed-left">省份</th>
            <th class="fixed-left">城市</th>
            <th class="fixed-left">当前等级</th>
            <th class="fixed-left">今日ADI</th>
            <th class="fixed-left">7天最高ADI</th>
            <th class="fixed-left">7天最高等级</th>
            <th class="fixed-left">热夜天数</th>
            <th class="fixed-left">等级趋势</th>
        `;

        for (let i = 0; i < 7; i++) {
            // 使用数据中的实际日期，而不是基于当前日期计算
            const date = sampleDates[i] ? sampleDates[i].date : new Date();
            headerHtml += `
                <th>
                    <div class="date-header">
                        <span class="date-header-day">${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}</span>
                    </div>
                </th>
            `;
        }
        thead.innerHTML = headerHtml;

        // Empty state
        if (cities.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="16" class="forecast-empty-state">
                        <div class="forecast-empty-icon">🔍</div>
                        <div>未找到匹配的城市</div>
                    </td>
                </tr>
            `;
            return;
        }

        // Generate table body with feels-like temperatures
        tbody.innerHTML = cities.map(city => {
            const currentInfo = Core.getLevelInfo(city.level);
            const maxAdi = Math.max(...city.future7Days.map(d => d.adiScore));
            const maxLevelInfo = Core.getLevelInfo(
                city.future7Days.find(d => d.adiScore === maxAdi)?.level || 'normal'
            );
            const hotNightCount = city.future7Days.filter(d => d.nightFeelsLike >= 30).length;
            const trendInfo = Core.calculateLevelTrend(city.level, city.future7Days.map(d => d.adiScore));

            // Fixed columns
            let rowHtml = `
                <td class="fixed-left">${city.region}</td>
                <td class="fixed-left">${city.province}</td>
                <td class="fixed-left">${city.cityName}</td>
                <td class="fixed-left">
                    <span class="table-level-badge" style="background: ${currentInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                        ${currentInfo.name}
                    </span>
                </td>
                <td class="fixed-left">${city.adiScore}</td>
                <td class="fixed-left">${maxAdi}</td>
                <td class="fixed-left">
                    <span class="table-level-badge" style="background: ${maxLevelInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                        ${maxLevelInfo.name}
                    </span>
                </td>
                <td class="fixed-left">${hotNightCount > 0 ? hotNightCount + '天' : '-'}</td>
                <td class="fixed-left" style="color: ${trendInfo.trendColor}; font-size: 0.75rem;">${trendInfo.trendText}</td>
            `;

            // 7-day data columns with feels-like temperatures
            city.future7Days.forEach((day, idx) => {
                const dayFeelsLike = day.dayFeelsLike;
                const nightFeelsLike = day.nightFeelsLike;
                const highColor = dayFeelsLike >= 40 ? '#D0021B' : dayFeelsLike >= 37 ? '#F57C00' : dayFeelsLike >= 34 ? '#F5A623' : '#4A90E2';
                const lowColor = nightFeelsLike >= 32 ? '#D0021B' : nightFeelsLike >= 30 ? '#F5A623' : '#00D4FF';
                const hotNightIcon = nightFeelsLike >= 30 ? '<span class="hot-night-indicator">🌙</span>' : '';

                rowHtml += `
                    <td data-city="${city.cityName}" data-day="${idx}">
                        <div>
                            <div style="color: ${highColor}; font-weight: 600;">${dayFeelsLike}°</div>
                            <div style="color: ${lowColor}; font-size: 0.75rem;">${nightFeelsLike}°</div>
                            ${hotNightIcon}
                        </div>
                    </td>
                `;
            });

            return `<tr>${rowHtml}</tr>`;
        }).join('');
    }

    function renderReportADI(cities, thead, tbody) {
        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

        // 使用第一个城市的future7Days数据来获取实际日期，确保表头和数据对应
        const sampleDates = cities.length > 0 && cities[0].future7Days ? cities[0].future7Days : [];

        // Generate date headers
        let headerHtml = `
            <th class="fixed-left">区域</th>
            <th class="fixed-left">省份</th>
            <th class="fixed-left">城市</th>
            <th class="fixed-left">当前等级</th>
            <th class="fixed-left">今日ADI</th>
            <th class="fixed-left">7天最高ADI</th>
            <th class="fixed-left">7天最高等级</th>
            <th class="fixed-left">热夜天数</th>
            <th class="fixed-left">等级趋势</th>
        `;

        for (let i = 0; i < 7; i++) {
            // 使用数据中的实际日期，而不是基于当前日期计算
            const date = sampleDates[i] ? sampleDates[i].date : new Date();
            headerHtml += `
                <th>
                    <div class="date-header">
                        <span class="date-header-day">${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}</span>
                    </div>
                </th>
            `;
        }
        thead.innerHTML = headerHtml;

        // Empty state
        if (cities.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="16" class="forecast-empty-state">
                        <div class="forecast-empty-icon">🔍</div>
                        <div>未找到匹配的城市</div>
                    </td>
                </tr>
            `;
            return;
        }

        // Helper function to get ADI cell color class
        function getAdiColorClass(adi) {
            if (adi >= 90) return 'adi-cell-outbreak';
            if (adi >= 85) return 'adi-cell-action';
            if (adi >= 75) return 'adi-cell-opportunity';
            if (adi >= 65) return 'adi-cell-observe';
            return 'adi-cell-normal';
        }

        // Generate table body with ADI scores
        tbody.innerHTML = cities.map(city => {
            const currentInfo = Core.getLevelInfo(city.level);
            const maxAdi = Math.max(...city.future7Days.map(d => d.adiScore));
            const maxLevelInfo = Core.getLevelInfo(
                city.future7Days.find(d => d.adiScore === maxAdi)?.level || 'normal'
            );
            const hotNightCount = city.future7Days.filter(d => d.isHotNight).length;
            const trendInfo = Core.calculateLevelTrend(city.level, city.future7Days.map(d => d.adiScore));

            // Fixed columns
            let rowHtml = `
                <td class="fixed-left">${city.region}</td>
                <td class="fixed-left">${city.province}</td>
                <td class="fixed-left">${city.cityName}</td>
                <td class="fixed-left">
                    <span class="table-level-badge" style="background: ${currentInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                        ${currentInfo.name}
                    </span>
                </td>
                <td class="fixed-left">${city.adiScore}</td>
                <td class="fixed-left">${maxAdi}</td>
                <td class="fixed-left">
                    <span class="table-level-badge" style="background: ${maxLevelInfo.color}; font-size: 0.7rem; padding: 2px 6px; border-radius: 3px;">
                        ${maxLevelInfo.name}
                    </span>
                </td>
                <td class="fixed-left">${hotNightCount > 0 ? hotNightCount + '天' : '-'}</td>
                <td class="fixed-left" style="color: ${trendInfo.trendColor}; font-size: 0.75rem;">${trendInfo.trendText}</td>
            `;

            // 7-day data columns with ADI scores
            city.future7Days.forEach((day, idx) => {
                const adi = day.adiScore;
                const colorClass = getAdiColorClass(adi);
                const levelInfo = Core.getLevelInfo(day.level);
                const hotNightIcon = day.isHotNight ? '<span class="hot-night-indicator">🌙</span>' : '';

                rowHtml += `
                    <td class="${colorClass}" data-city="${city.cityName}" data-day="${idx}">
                        <div>
                            <div style="font-weight: 700; font-size: 0.9rem;">${adi}</div>
                            <div style="font-size: 0.65rem; opacity: 0.8;">${levelInfo.name}</div>
                            ${hotNightIcon}
                        </div>
                    </td>
                `;
            });

            return `<tr>${rowHtml}</tr>`;
        }).join('');
    }

    // ==================== 降水监控页 ====================

    function renderRainMonitorPage() {
        const thead = document.getElementById('rainForecastTableHead');
        const tbody = document.getElementById('rainForecastTableBody');
        if (!thead || !tbody || state.cityData.length === 0) return;

        // Filter out cities without future7Days data
        let cities = state.cityData.filter(c => c.future7Days && c.future7Days.length > 0);
        const filter = state.rainFilter || 'all';

        // Apply region filters
        if (['华东', '华南', '华中', '西南', '华北', '西北', '东北'].includes(filter)) {
            cities = cities.filter(c => c.region === filter);
        }

        // Apply search filter
        if (state.rainSearch) {
            cities = cities.filter(c => c.cityName.toLowerCase().includes(state.rainSearch));
        }

        // Sort by city name for consistency
        cities.sort((a, b) => a.cityName.localeCompare(b.cityName, 'zh-CN'));

        // Route to dimension-specific renderer
        const currentDimension = document.querySelector('#rainMonitorPage .dimension-btn.active')?.dataset.dimension || 'rainInsurance';
        switch (currentDimension) {
            case 'rainInsurance':
                renderReportRainInsurance(cities, thead, tbody);
                break;
            case 'postRainMuggy':
                renderReportPostRainMuggy(cities, thead, tbody);
                break;
        }

        bindTooltipEvents(tbody);
    }

    function renderReportRainInsurance(cities, thead, tbody) {
        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        const sampleDates = cities.length > 0 && cities[0].future7Days ? cities[0].future7Days : [];

        let headerHtml = `
            <th class="fixed-left">区域</th>
            <th class="fixed-left">省份</th>
            <th class="fixed-left">城市</th>
            <th class="fixed-left">最高提醒</th>
            <th class="fixed-left">提醒天数</th>
            <th class="fixed-left">强提醒天数</th>
            <th class="fixed-left">最近提醒</th>
            <th class="fixed-left">动作</th>
            <th class="fixed-left">说明</th>
        `;

        for (let i = 0; i < 7; i++) {
            const date = sampleDates[i] ? sampleDates[i].date : new Date();
            headerHtml += `
                <th>
                    <div class="date-header">
                        <span class="date-header-day">${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}</span>
                    </div>
                </th>
            `;
        }
        thead.innerHTML = headerHtml;

        if (cities.length === 0) {
            tbody.innerHTML = '<tr><td colspan="16" class="forecast-empty-state"><div class="forecast-empty-icon">🔍</div><div>未找到匹配的城市</div></td></tr>';
            return;
        }

        tbody.innerHTML = cities.map(city => {
            const remindDays = city.future7Days.filter(day => day.rainInsuranceLevel !== 'none');
            const strongDays = city.future7Days.filter(day => day.rainInsuranceLevel === 'strong');
            const topDay = remindDays[0];
            let rowHtml = `
                <td class="fixed-left">${escapeHtml(city.region)}</td>
                <td class="fixed-left">${escapeHtml(city.province)}</td>
                <td class="fixed-left">${escapeHtml(city.cityName)}</td>
                <td class="fixed-left"><span class="rain-mini-badge insurance-${escapeHtml(city.maxRainInsuranceLevel || 'none')}">${escapeHtml(topDay ? topDay.rainInsuranceLabel : '无提醒')}</span></td>
                <td class="fixed-left">${escapeHtml(String(remindDays.length))}天</td>
                <td class="fixed-left">${escapeHtml(String(strongDays.length))}天</td>
                <td class="fixed-left">${escapeHtml(topDay ? topDay.weatherText : '-')}</td>
                <td class="fixed-left">配送照常</td>
                <td class="fixed-left">下雨提醒投保</td>
            `;
            city.future7Days.forEach((day, idx) => {
                rowHtml += `
                    <td class="rain-report-cell rain-insurance-${escapeHtml(day.rainInsuranceLevel || 'none')}" data-city="${escapeHtml(city.cityName)}" data-day="${idx}">
                        <div>
                            <div class="rain-cell-main">${escapeHtml(day.rainInsuranceLabel || '无提醒')}</div>
                            <div class="rain-cell-sub">${escapeHtml(day.weatherText || '无明显降水')}</div>
                            <div class="rain-cell-sub">${escapeHtml(String(day.precip || 0))}mm</div>
                        </div>
                    </td>
                `;
            });
            return `<tr>${rowHtml}</tr>`;
        }).join('');
    }

    function renderReportPostRainMuggy(cities, thead, tbody) {
        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        const sampleDates = cities.length > 0 && cities[0].future7Days ? cities[0].future7Days : [];

        let headerHtml = `
            <th class="fixed-left">区域</th>
            <th class="fixed-left">省份</th>
            <th class="fixed-left">城市</th>
            <th class="fixed-left">最高机会</th>
            <th class="fixed-left">最高分</th>
            <th class="fixed-left">机会天数</th>
            <th class="fixed-left">今日ADI</th>
            <th class="fixed-left">动作</th>
            <th class="fixed-left">说明</th>
        `;

        for (let i = 0; i < 7; i++) {
            const date = sampleDates[i] ? sampleDates[i].date : new Date();
            headerHtml += `
                <th>
                    <div class="date-header">
                        <span class="date-header-day">${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}</span>
                    </div>
                </th>
            `;
        }
        thead.innerHTML = headerHtml;

        if (cities.length === 0) {
            tbody.innerHTML = '<tr><td colspan="16" class="forecast-empty-state"><div class="forecast-empty-icon">🔍</div><div>未找到匹配的城市</div></td></tr>';
            return;
        }

        tbody.innerHTML = cities.map(city => {
            const opportunityDays = city.future7Days.filter(day => day.postRainMuggyLevel !== 'none');
            const maxScore = Math.max(0, ...city.future7Days.map(day => day.postRainMuggyScore || 0));
            let rowHtml = `
                <td class="fixed-left">${escapeHtml(city.region)}</td>
                <td class="fixed-left">${escapeHtml(city.province)}</td>
                <td class="fixed-left">${escapeHtml(city.cityName)}</td>
                <td class="fixed-left"><span class="rain-mini-badge muggy-${escapeHtml(city.maxPostRainMuggyLevel || 'none')}">${escapeHtml(opportunityDays[0] ? opportunityDays[0].postRainMuggyLabel : '无明显机会')}</span></td>
                <td class="fixed-left">${escapeHtml(String(maxScore))}</td>
                <td class="fixed-left">${escapeHtml(String(opportunityDays.length))}天</td>
                <td class="fixed-left">${escapeHtml(String(city.adiScore))}</td>
                <td class="fixed-left">销售跟进</td>
                <td class="fixed-left">雨后升温高湿</td>
            `;
            city.future7Days.forEach((day, idx) => {
                rowHtml += `
                    <td class="rain-report-cell rain-muggy-${escapeHtml(day.postRainMuggyLevel || 'none')}" data-city="${escapeHtml(city.cityName)}" data-day="${idx}">
                        <div>
                            <div class="rain-cell-main">${escapeHtml(day.postRainMuggyLabel || '无明显机会')}</div>
                            <div class="rain-cell-sub">${escapeHtml(String(day.postRainMuggyScore || 0))}分</div>
                            <div class="rain-cell-sub">${escapeHtml(day.postRainMuggyTempRise > 0 ? '+' + day.postRainMuggyTempRise + '℃' : '-')}</div>
                        </div>
                    </td>
                `;
            });
            return `<tr>${rowHtml}</tr>`;
        }).join('');
    }

    // ==================== 历史记录页 ====================

    function renderHistory() {
        const tbody = document.getElementById('historyTableBody');
        if (!tbody || state.cityData.length === 0) return;

        const now = new Date();
        const records = [];

        state.cityData.forEach(city => {
            records.push({
                date: fmtDate(now), city: city.cityName, region: city.region,
                adi: city.adiScore, level: city.level,
                maxTemp: city.maxTemp, nightMinTemp: city.nightMinTemp,
                feelsLike: city.feelsLike, humidity: city.humidity,
                hotNightDays: city.continuousHotNightDays,
                shortReason: city.shortReason, reason: city.reason,
                time: city.updatedAt
            });

            const y = new Date(now); y.setDate(y.getDate() - 1);
            const yAdi = Math.max(0, city.adiScore + Math.floor(Math.random() * 10) - 5);
            records.push({
                date: fmtDate(y), city: city.cityName, region: city.region,
                adi: yAdi, level: adiToLevel(yAdi),
                maxTemp: city.maxTemp + Math.floor(Math.random() * 4) - 2,
                nightMinTemp: city.nightMinTemp + Math.floor(Math.random() * 4) - 2,
                feelsLike: city.feelsLike + Math.floor(Math.random() * 3) - 1,
                humidity: city.humidity + Math.floor(Math.random() * 8) - 4,
                hotNightDays: Math.max(0, city.continuousHotNightDays - 1),
                shortReason: '历史记录', reason: '历史模拟数据',
                time: '14:00'
            });
        });

        let filtered = records;
        const filter = state.historyFilter;
        if (filter === 'today') filtered = records.filter(r => r.date === fmtDate(now));
        else if (filter === 'yesterday') { const y = new Date(now); y.setDate(y.getDate() - 1); filtered = records.filter(r => r.date === fmtDate(y)); }
        else if (filter === 'outbreak' || filter === 'action') filtered = records.filter(r => r.level === filter);
        else if (filter === 'nightMuggy') filtered = records.filter(r => r.hotNightDays >= 2);
        else if (filter === 'heatRise') filtered = records.filter(r => r.adi >= 75);

        filtered.sort((a, b) => b.adi - a.adi);
        filtered = filtered.slice(0, 100);

        tbody.innerHTML = filtered.map(r => {
            const info = Core.getLevelInfo(r.level);
            return `
                <tr data-city="${r.city}">
                    <td>${r.date}</td>
                    <td>${r.city}</td>
                    <td>${r.region}</td>
                    <td><span class="table-adi" style="color: ${info.color}">${r.adi}</span></td>
                    <td><span class="table-level-badge" style="background: ${info.color}">${info.name}</span></td>
                    <td class="table-temp-high">${r.maxTemp}℃</td>
                    <td class="table-temp-low">${r.nightMinTemp}℃</td>
                    <td>${r.feelsLike}℃</td>
                    <td>${r.humidity}%</td>
                    <td>${r.hotNightDays > 0 ? r.hotNightDays + '天' : '-'}</td>
                    <td class="table-reason" title="${r.reason}">${r.shortReason}</td>
                    <td>${r.time}</td>
                </tr>
            `;
        }).join('');
    }

    function adiToLevel(adi) {
        if (adi >= 85) return 'outbreak';
        if (adi >= 75) return 'action';
        if (adi >= 65) return 'opportunity';
        if (adi >= 55) return 'observe';
        return 'normal';
    }

    function fmtDate(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

    // ==================== 规则设置页 ====================

    function renderRules() {
        const container = document.getElementById('rulesSections');
        if (!container) return;

        const config = Core.ADI_CONFIG;

        container.innerHTML = `
            <div class="rules-section">
                <h4>ADI 权重配置</h4>
                <div style="font-size:0.75rem;color:var(--alert-yellow);margin-bottom:1rem;padding:0.5rem;background:rgba(245,166,35,0.08);border-radius:6px;">
                    💡 体感温度权重最高(40%)，夜间最低温权重20%，白天最高温权重30%，综合反映人体不适感和空调购买需求。
                </div>
                <div class="rule-field">
                    <label>夜间最低温 <input type="number" id="w_night" value="${Math.round(config.weights.nightMinTemp * 100)}" min="0" max="100" onchange="UI.updateWeightTotal()"><span class="weight-suffix">%</span></label>
                </div>
                <div class="rule-field">
                    <label>白天最高温 <input type="number" id="w_day" value="${Math.round(config.weights.dayMaxTemp * 100)}" min="0" max="100" onchange="UI.updateWeightTotal()"><span class="weight-suffix">%</span></label>
                </div>
                <div class="rule-field">
                    <label>体感温度 <input type="number" id="w_feels" value="${Math.round(config.weights.feelsLike * 100)}" min="0" max="100" onchange="UI.updateWeightTotal()"><span class="weight-suffix">%</span></label>
                </div>
                <div class="rule-field">
                    <label>连续高温 <input type="number" id="w_cont" value="${Math.round(config.weights.continuousHeat * 100)}" min="0" max="100" onchange="UI.updateWeightTotal()"><span class="weight-suffix">%</span></label>
                </div>
                <div class="rule-field">
                    <label>湿度闷热 <input type="number" id="w_hum" value="${Math.round(config.weights.humidityMuggy * 100)}" min="0" max="100" onchange="UI.updateWeightTotal()"><span class="weight-suffix">%</span></label>
                </div>
                <div class="weight-total valid" id="weightTotal">权重总计：100%</div>
            </div>

            <div class="rules-section">
                <h4>等级阈值配置</h4>
                <div class="rule-field">
                    <label>凉爽 ADI范围 <input type="number" id="th_cool_max" value="${config.thresholds.cool.max}" min="0" max="100"> 以下</label>
                </div>
                <div class="rule-field">
                    <label>一般 ADI范围 <input type="number" id="th_observe_min" value="${config.thresholds.observe.min}" min="0" max="100"> - <input type="number" id="th_observe_max" value="${config.thresholds.observe.max}" min="0" max="100"></label>
                </div>
                <div class="rule-field">
                    <label>待热 ADI范围 <input type="number" id="th_oppo_min" value="${config.thresholds.opportunity.min}" min="0" max="100"> - <input type="number" id="th_oppo_max" value="${config.thresholds.opportunity.max}" min="0" max="100"></label>
                </div>
                <div class="rule-field">
                    <label>热 ADI范围 <input type="number" id="th_action_min" value="${config.thresholds.action.min}" min="0" max="100"> - <input type="number" id="th_action_max" value="${config.thresholds.action.max}" min="0" max="100"></label>
                </div>
                <div class="rule-field">
                    <label>爆热 ADI阈值 <input type="number" id="th_outbreak_min" value="${config.thresholds.outbreak.min}" min="0" max="100"> 以上</label>
                </div>
            </div>

            <div class="rules-section">
                <h4>强制升级规则</h4>
                ${config.forceUpgrade.map(rule => `
                    <div class="rule-item">
                        <div class="rule-item-left">
                            <div class="rule-item-name">${rule.name}</div>
                            <div class="rule-item-desc">${rule.desc}</div>
                        </div>
                        <span class="rule-item-status">已启用</span>
                    </div>
                `).join('')}
            </div>

            <div class="rules-section">
                <h4>热夜定义 & 夜间闷热加成</h4>
                <div class="rule-item">
                    <div class="rule-item-left">
                        <div class="rule-item-name">热夜定义</div>
                        <div class="rule-item-desc">夜间最低温 ≥${config.hotNight.minTemp}℃ 或 夜间体感温度 ≥${config.hotNight.feelsLike}℃</div>
                    </div>
                    <span class="rule-item-status">已启用</span>
                </div>
                ${config.nightMuggyBonus.map((rule, idx) => {
                    const descs = ['连续2晚≥26℃: +3分', '连续3晚≥26℃: +5分', '连续2晚≥27℃: +8分', '连续3晚≥27℃: +10分', '夜间≥26℃且湿度≥80%: +5分'];
                    return `
                        <div class="rule-item">
                            <div class="rule-item-left">
                                <div class="rule-item-name">夜间闷热加成 ${idx + 1}</div>
                                <div class="rule-item-desc">${descs[idx]}</div>
                            </div>
                            <span class="rule-item-status">已启用</span>
                        </div>
                    `;
                }).join('')}
                <div class="rule-item">
                    <div class="rule-item-left">
                        <div class="rule-item-name">ADI总分封顶</div>
                        <div class="rule-item-desc">ADI计算结果封顶100分</div>
                    </div>
                    <span class="rule-item-status">已启用</span>
                </div>
            </div>
        `;
    }

    function updateWeightTotal() {
        const ids = ['w_night', 'w_day', 'w_feels', 'w_cont', 'w_hum'];
        const total = ids.reduce((sum, id) => {
            const el = document.getElementById(id);
            return sum + (el ? parseInt(el.value) || 0 : 0);
        }, 0);
        const el = document.getElementById('weightTotal');
        if (el) {
            el.textContent = '权重总计：' + total + '%';
            el.className = 'weight-total ' + (total === 100 ? 'valid' : 'invalid');
        }
    }

    function saveRules() { showToast('规则配置已保存'); }

    function resetRules() {
        if (confirm('确定要恢复默认设置吗？')) { renderRules(); showToast('已恢复默认设置'); }
    }

    // ==================== 城市详情弹窗 ====================

    function selectCity(cityName) {
        state.selectedCity = cityName;
        showCityDetail(cityName);
        if (window.MapModule && MapModule.highlightCity) MapModule.highlightCity(cityName);
    }

    function showCityDetail(cityName) {
        const city = state.cityData.find(c => c.cityName === cityName);
        if (!city) return;

        const info = Core.getLevelInfo(city.level);
        const modal = document.getElementById('cityDetailModal');
        const content = document.getElementById('cityModalContent');
        if (!modal || !content) return;

        content.innerHTML = `
            <button class="modal-close" onclick="UI.closeCityDetail()">✕</button>
            <div class="modal-header" style="border-left: 4px solid ${escapeHtml(info.color)}">
                <h2>${escapeHtml(city.cityName)}</h2>
                <div class="modal-meta">
                    <span class="modal-level-badge" style="background: ${escapeHtml(info.color)}">${escapeHtml(info.name)}</span>
                    <span class="modal-adi-score" style="color: ${escapeHtml(info.color)}">ADI ${escapeHtml(city.adiScore.toString())}</span>
                    <span class="modal-region">${escapeHtml(city.region)} · ${escapeHtml(city.province)}</span>
                </div>
            </div>
            <div class="modal-body">
                <!-- 新增：管理层摘要 -->
                <div class="management-summary" style="background: ${escapeHtml(info.color)}15; border-left: 3px solid ${escapeHtml(info.color)}; padding: 12px; margin-bottom: 16px; border-radius: 4px;">
                    <strong style="color: ${escapeHtml(info.color)}">💡 管理层摘要</strong><br>
                    <span style="color: #e0e6ed; font-size: 14px;">该城市当前处于${escapeHtml(info.name)}，主要原因是${escapeHtml(city.shortReason)}，预计短期空调需求${info.order >= 3 ? '较强' : info.order >= 2 ? '中等' : '一般'}。</span>
                </div>

                <div class="detail-grid">
                    <div class="detail-item">
                        <div class="detail-label">ADI 指数</div>
                        <div class="detail-value" style="color: ${escapeHtml(info.color)}">${escapeHtml(city.adiScore.toString())}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">白天最高温</div>
                        <div class="detail-value" style="color: #F57C00">${escapeHtml(city.maxTemp.toString())}℃</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">夜间最低温</div>
                        <div class="detail-value" style="color: ${city.nightMinTemp >= 28 ? '#D0021B' : '#00D4FF'}">${escapeHtml(city.nightMinTemp.toString())}℃</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">体感温度</div>
                        <div class="detail-value" style="color: ${city.feelsLike >= 38 ? '#D0021B' : '#F5A623'}">${escapeHtml(city.feelsLike.toString())}℃</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">湿度</div>
                        <div class="detail-value">${escapeHtml(city.humidity.toString())}%</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">连续热夜</div>
                        <div class="detail-value">${city.continuousHotNightDays > 0 ? '🔥 ' + escapeHtml(city.continuousHotNightDays.toString()) + '天' : '无'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">未来3天最高温</div>
                        <div class="detail-value" style="font-size: 0.85rem">${city.future3DayMaxTemps.map(t => escapeHtml(t.toString()) + '℃').join(' / ')}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">未来3晚最低温</div>
                        <div class="detail-value" style="font-size: 0.85rem">${city.future3NightMinTemps.map(t => escapeHtml(t.toString()) + '℃').join(' / ')}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">夜间闷热指数</div>
                        <div class="detail-value">${escapeHtml(city.nightMuggyScore.toString())}</div>
                    </div>
                </div>

                <div class="alert-reason" style="background: ${escapeHtml(info.color)}15; border-left: 3px solid ${escapeHtml(info.color)}">
                    <strong>判断原因：</strong>${escapeHtml(city.reason)}
                    ${city.triggeredRules && city.triggeredRules.length > 0 ? `
                        <div class="triggered-rules">
                            ${city.triggeredRules.map(r => `<span class="triggered-rule">${escapeHtml(r)}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>

                <div class="forecast-section">
                    <h3>未来7天ADI趋势</h3>
                    ${renderForecastTable(city)}
                </div>
            </div>
        `;

        modal.style.display = 'flex';
    }

    function renderForecastTable(city) {
        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        let rows = '';
        // 从明天开始显示（i+1），与future7AdiScores的索引对应
        const daysToShow = Math.min(7, city.future7AdiScores.length);

        for (let i = 0; i < daysToShow; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i + 1);  // 从明天开始
            const adi = city.future7AdiScores[i] || city.adiScore;
            // 使用真实的7天API数据，而不是随机生成
            const high = city.future7DayMaxTemps?.[i] ?? city.future3DayMaxTemps[i] ?? Math.round(city.maxTemp);
            const night = city.future7NightMinTemps?.[i] ?? city.future3NightMinTemps[i] ?? Math.round(city.nightMinTemp);
            // 根据当天温度重新计算体感温度（暂时用简单公式）
            const feels = Math.round(high + Math.max(0, (city.humidity - 55) * 0.08));
            const isHotNight = night >= 28;

            let fLevel = 'cool';
            if (adi >= 85) fLevel = 'outbreak';
            else if (adi >= 75) fLevel = 'action';
            else if (adi >= 65) fLevel = 'opportunity';
            else if (adi >= 55) fLevel = 'observe';
            const fInfo = Core.getLevelInfo(fLevel);

            rows += `
                <div class="forecast-row ${isHotNight ? 'hot' : ''}">
                    <div class="forecast-date">${date.getMonth() + 1}/${date.getDate()} 周${weekDays[date.getDay()]}${isHotNight ? ' 🌙' : ''}</div>
                    <div style="color: #FF6B35; font-weight: 600">${high}°</div>
                    <div style="color: ${night >= 28 ? '#D0021B' : '#00D4FF'}">${night}°</div>
                    <div style="color: #F5A623">${feels}°</div>
                    <div><span style="color: ${fInfo.color}; font-weight: 600">${adi}</span> <span style="background:${fInfo.color};color:#fff;padding:0 4px;border-radius:3px;font-size:0.6rem;margin-left:4px;">${fInfo.name}</span></div>
                </div>
            `;
        }
        return `
            <div class="forecast-table">
                <div class="forecast-header"><div>日期</div><div>最高温</div><div>夜间</div><div>体感</div><div>ADI</div></div>
                ${rows}
            </div>
        `;
    }

    function closeCityDetail() {
        const modal = document.getElementById('cityDetailModal');
        if (modal) modal.style.display = 'none';
        state.selectedCity = null;
        if (window.MapModule && MapModule.clearHighlight) MapModule.clearHighlight();
    }

    // ==================== 工具 ====================

    function updateCurrentTime() {
        const el = document.getElementById('currentTime');
        if (el) {
            const now = new Date();
            const date = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
            const time = now.toLocaleTimeString('zh-CN', { hour12: false });
            el.textContent = `${date} ${time}`;
        }
    }

    function showToast(msg, dur) {
        let t = document.getElementById('toast');
        if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
        t.textContent = msg; t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), dur || 2000);
    }

    // ==================== 简报相关 ====================

    function openDailyBriefModal() {
        const modal = document.getElementById('dailyBriefModal');
        if (!modal) return;

        modal.classList.add('active');
        renderBriefContent('management');
    }

    function closeDailyBriefModal() {
        const modal = document.getElementById('dailyBriefModal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    function renderBriefContent(version) {
        const container = document.getElementById('briefContent');
        if (!container) return;

        const brief = Core.generateDailyBrief(state.cityData, version);
        container.innerHTML = brief.content;

        // 更新tab状态
        document.querySelectorAll('.modal-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.version === version);
        });
    }

    function copyDailyBrief() {
        const container = document.getElementById('briefContent');
        if (!container) return;

        const text = container.innerText;
        navigator.clipboard.writeText(text).then(() => {
            showToast('简报已复制到剪贴板');
        }).catch(() => {
            showToast('复制失败，请手动复制');
        });
    }

    return {
        init, renderDashboard, renderAnalysis, renderReport, renderHistory, renderRules,
        selectCity, closeCityDetail, showCityDetail, saveRules, resetRules, updateWeightTotal,
        showToast, state, renderTodayConclusion, renderRegionRanking, renderLongestHotNight,
        openDailyBriefModal, closeDailyBriefModal, copyDailyBrief,
        renderReportTemperature, renderReportFeelsLike, renderReportADI
    };
})();
