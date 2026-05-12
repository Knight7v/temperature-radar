/**
 * App Module - 空调热销区域雷达 主应用入口
 */

(function() {
    'use strict';

    const AppState = {
        initialized: false,
        cityData: [],
        lastUpdateTime: null,
        refreshTimer: null
    };

    async function waitForChinaGeoData() {
        const maxWait = 10000; // 最多等待10秒
        const startTime = Date.now();

        while (!window.CHINA_GEO_DATA) {
            if (Date.now() - startTime > maxWait) {
                console.warn('地图数据加载超时，将尝试从网络获取');
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!window.CHINA_GEO_DATA) {
            console.warn('CHINA_GEO_DATA 未加载，MapModule 将尝试从其他来源加载');
        }
    }

    async function init() {
        console.log('空调热销区域雷达启动中...');

        try {
            UI.init();
            await waitForChinaGeoData();
            await MapModule.init();
            await refreshData();

            setTimeout(() => {
                const loadingScreen = document.getElementById('loadingScreen');
                if (loadingScreen) loadingScreen.classList.add('hidden');
            }, 1000);

            AppState.refreshTimer = setInterval(async () => {
                await refreshData();
            }, 6 * 60 * 60 * 1000);  // 6小时刷新
            AppState.initialized = true;
            console.log('系统启动完成');

        } catch (error) {
            console.error('初始化失败:', error);
        }
    }

    async function refreshData() {
        // 设置加载状态
        const loadingEl = document.getElementById('apiLoadingStatus');
        const errorEl = document.getElementById('apiErrorMessage');
        if (loadingEl) loadingEl.style.display = 'flex';
        if (errorEl) errorEl.style.display = 'none';

        try {
            const cityData = await Core.generateAllCityData();
            AppState.cityData = cityData;
            AppState.lastUpdateTime = new Date();
            UI.renderDashboard(cityData);

            // 手动触发地图渲染事件
            if (typeof CustomEvent !== 'undefined') {
                const event = new CustomEvent('cityDataLoaded', { detail: { cityData: cityData } });
                window.dispatchEvent(event);
            }

            // 更新加载成功提示
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }

        } catch (error) {
            console.error('数据加载失败:', error);
            // 显示错误提示
            if (errorEl) {
                errorEl.textContent = `数据加载失败: ${error.message}`;
                errorEl.style.display = 'block';
            }
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.App = {
        state: AppState,
        refreshData: refreshData,
        init: init
    };

})();
