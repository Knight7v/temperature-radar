/**
 * Map Module - 空调热销区域雷达地图
 * 支持: ADI指数、夜间温度、体感温度、白天最高温
 */

(function() {
    'use strict';

    let mapChart = null;
    let chinaJson = null;

    const COLORS = {
        outbreak: '#D0021B',
        action: '#F57C00',
        opportunity: '#F5A623',
        observe: '#4A90E2',
        normal: '#555555'
    };

    // 每个模式的图例配置
    const LEGEND_CONFIG = {
        adi: {
            title: '空调销售机会',
            items: [
                { label: '爆热', class: 'outbreak', desc: 'ADI ≥ 85' },
                { label: '热', class: 'action', desc: 'ADI 75-84' },
                { label: '待爆', class: 'opportunity', desc: 'ADI 65-74' },
                { label: '一般', class: 'observe', desc: 'ADI 55-64' },
                { label: '普通', class: 'normal', desc: 'ADI < 55' }
            ]
        },
        nightTemp: {
            title: '夜间最低温',
            items: [
                { label: '≥28℃', class: 'outbreak', desc: '极热夜' },
                { label: '26-27℃', class: 'action', desc: '热夜' },
                { label: '24-25℃', class: 'opportunity', desc: '温暖夜' },
                { label: '22-23℃', class: 'observe', desc: '微热夜' },
                { label: '<22℃', class: 'normal', desc: '凉爽夜' }
            ]
        },
        feelsLike: {
            title: '体感温度',
            items: [
                { label: '≥40℃', class: 'outbreak', desc: '极闷热' },
                { label: '37-39℃', class: 'action', desc: '闷热' },
                { label: '34-36℃', class: 'opportunity', desc: '炎热' },
                { label: '30-33℃', class: 'observe', desc: '较热' },
                { label: '<30℃', class: 'normal', desc: '舒适' }
            ]
        },
        dayMax: {
            title: '白天最高温',
            items: [
                { label: '≥37℃', class: 'outbreak', desc: '酷热' },
                { label: '35-36℃', class: 'action', desc: '高温' },
                { label: '33-34℃', class: 'opportunity', desc: '炎热' },
                { label: '30-32℃', class: 'observe', desc: '较热' },
                { label: '<30℃', class: 'normal', desc: '温和' }
            ]
        }
    };

    const VIEW_DESCRIPTIONS = {
        adi: '颜色越红，空调销售机会越高',
        nightTemp: '颜色越红，夜间温度越高',
        feelsLike: '颜色越红，体感温度越高',
        dayMax: '颜色越红，白天最高温越高'
    };

    function updateViewDescription(mode) {
        const descEl = document.getElementById('mapViewDesc');
        if (descEl && VIEW_DESCRIPTIONS[mode]) {
            descEl.textContent = VIEW_DESCRIPTIONS[mode];
        }
    }

    function getLegendConfig(mode) {
        return LEGEND_CONFIG[mode] || LEGEND_CONFIG.adi;
    }

    function getCityValue(city, mode) {
        switch (mode) {
            case 'adi': return city.adiScore;
            case 'nightTemp': return city.nightMinTemp;
            case 'feelsLike': return city.feelsLike;
            case 'dayMax': return city.maxTemp;
            default: return city.adiScore;
        }
    }

    function getCityColor(city) {
        return COLORS[city.level] || COLORS.normal;
    }

    async function init() {
        const mapContainer = document.getElementById('china-map');
        if (!mapContainer) {
            console.error('地图容器不存在');
            return;
        }

        // 加载地图数据
        let mapData = window.CHINA_GEO_DATA || null;

        if (!mapData) {
            try {
                const localResponse = await fetch('assets/china.json');
                if (localResponse.ok) {
                    mapData = await localResponse.json();
                }
            } catch (e) {
                // ignore
            }
        }

        if (!mapData) {
            const sources = [
                'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json',
                'https://geo.datav.aliyun.com/areas/bound/100000_full.json'
            ];

            for (const source of sources) {
                try {
                    const response = await fetch(source, { mode: 'cors', headers: { 'Accept': 'application/json' } });
                    if (response.ok) {
                        mapData = await response.json();
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }
        }

        if (!mapData) {
            showMapError(new Error('无法加载地图数据'));
            return;
        }

        chinaJson = mapData;
        echarts.registerMap('china', chinaJson);

        // 等待容器获得正确尺寸
        for (let i = 0; i < 30; i++) {
            if (mapContainer.clientWidth >= 200 && mapContainer.clientHeight >= 300) {
                break;
            }
            await new Promise(r => setTimeout(r, 100));
        }

        // 强制修正容器尺寸
        if (mapContainer.clientWidth < 200) {
            var pw = mapContainer.parentElement.clientWidth;
            if (pw > 200) mapContainer.style.width = pw + 'px';
            else mapContainer.style.width = (window.innerWidth - 560) + 'px';
        }

        if (mapContainer.clientHeight < 300) {
            mapContainer.style.minHeight = '400px';
            mapContainer.style.height = '400px';
        }

        mapChart = echarts.init(mapContainer);

        // 无论 UI 是否有数据，都先尝试渲染一次
        if (window.UI && UI.state && UI.state.cityData.length > 0) {
            render(UI.state.cityData, UI.state.mapViewMode);
        } else {
            // 设置一个监听器，当数据可用时自动渲染
            window.addEventListener('cityDataLoaded', function(e) {
                render(e.detail.cityData, 'adi');
            });
        }

        hideMapLoading();

        window.addEventListener('resize', () => {
            if (mapChart) mapChart.resize();
        });
    }

    function showMapLoading() {
        const el = document.getElementById('china-map');
        if (el && !el.querySelector('.map-loading')) {
            const div = document.createElement('div');
            div.className = 'map-loading';
            div.innerHTML = '<div>加载地图数据中...</div>';
            el.appendChild(div);
        }
    }

    function hideMapLoading() {
        const el = document.getElementById('china-map');
        if (el) {
            const loading = el.querySelector('.map-loading');
            if (loading) loading.remove();
        }
    }

    function showMapError(error) {
        const el = document.getElementById('china-map');
        if (el) {
            el.innerHTML = `
                <div class="map-error">
                    <div class="error-icon">⚠️</div>
                    <div class="error-message">地图数据加载失败<br><small>${error.message}</small></div>
                    <button class="error-retry" onclick="location.reload()">重新加载</button>
                </div>
            `;
        }
    }

    function render(cityData, viewMode = 'adi') {
        console.log('MapModule.render 调用, viewMode:', viewMode);
        if (!mapChart || !chinaJson) {
            console.error('无法渲染地图 - mapChart:', !!mapChart, 'chinaJson:', !!chinaJson);
            return;
        }

        if (!cityData || cityData.length === 0) {
            console.error('cityData 为空或长度为0');
            return;
        }

        mapChart.resize();

        const geoCoordMap = {};
        cityData.forEach(city => {
            geoCoordMap[city.cityName] = [city.lng, city.lat];
        });

        const data = cityData.map(city => {
            const value = getCityValue(city, viewMode);
            return {
                name: city.cityName,
                value: [geoCoordMap[city.cityName][0], geoCoordMap[city.cityName][1], value],
                cityData: city
            };
        });

        const modeLabels = {
            adi: 'ADI指数',
            nightTemp: '夜间温度',
            feelsLike: '体感温度',
            dayMax: '白天最高温'
        };

        const getRange = () => {
            switch (viewMode) {
                case 'adi': return { min: 0, max: 100 };
                case 'nightTemp': return { min: 15, max: 35 };
                case 'feelsLike': return { min: 20, max: 50 };
                case 'dayMax': return { min: 20, max: 45 };
                default: return { min: 0, max: 100 };
            }
        };

        const range = getRange();

        // 归一化数值到 0-100 范围，用于计算圆点大小
        const normalizeValue = (value, mode) => {
            switch (mode) {
                case 'adi':
                    return value; // ADI 本身就是 0-100
                case 'nightTemp':
                    // 15-35 范围映射到 0-100
                    return Math.max(0, Math.min(100, (value - 15) / 20 * 100));
                case 'feelsLike':
                    // 20-50 范围映射到 0-100
                    return Math.max(0, Math.min(100, (value - 20) / 30 * 100));
                case 'dayMax':
                    // 20-45 范围映射到 0-100
                    return Math.max(0, Math.min(100, (value - 20) / 25 * 100));
                default:
                    return value;
            }
        };

        const getSplitListForMode = (mode) => {
            switch (mode) {
                case 'adi':
                    return [
                        { start: 85, end: 100, label: '≥85 爆发级' },
                        { start: 75, end: 84, label: '75-84 行动级' },
                        { start: 65, end: 74, label: '65-74 机会级' },
                        { start: 55, end: 64, label: '55-64 观察级' },
                        { start: 0, end: 54, label: '<55 普通' }
                    ];
                case 'nightTemp':
                    return [
                        { start: 28, end: 40, label: '≥28℃ 极热夜' },
                        { start: 26, end: 27, label: '26-27℃ 热夜' },
                        { start: 24, end: 25, label: '24-25℃ 温暖夜' },
                        { start: 22, end: 23, label: '22-23℃ 微热夜' },
                        { start: 10, end: 21, label: '<22℃ 凉爽夜' }
                    ];
                case 'feelsLike':
                    return [
                        { start: 40, end: 55, label: '≥40℃ 极闷热' },
                        { start: 37, end: 39, label: '37-39℃ 闷热' },
                        { start: 34, end: 36, label: '34-36℃ 炎热' },
                        { start: 30, end: 33, label: '30-33℃ 较热' },
                        { start: 15, end: 29, label: '<30℃ 舒适' }
                    ];
                case 'dayMax':
                    return [
                        { start: 37, end: 50, label: '≥37℃ 酷热' },
                        { start: 35, end: 36, label: '35-36℃ 高温' },
                        { start: 33, end: 34, label: '33-34℃ 炎热' },
                        { start: 30, end: 32, label: '30-32℃ 较热' },
                        { start: 15, end: 29, label: '<30℃ 温和' }
                    ];
                default:
                    return [
                        { start: 85, end: 100, label: '≥85 爆发级' },
                        { start: 75, end: 84, label: '75-84 行动级' },
                        { start: 65, end: 74, label: '65-74 机会级' },
                        { start: 55, end: 64, label: '55-64 观察级' },
                        { start: 0, end: 54, label: '<55 普通' }
                    ];
            }
        };

        const option = {
            tooltip: {
                trigger: 'item',
                formatter: (params) => {
                    if (!params.data || !params.data.cityData) return '';
                    const city = params.data.cityData;
                    const levelInfo = Core.getLevelInfo(city.level);

                    if (!levelInfo) {
                        console.warn('未找到 level 信息:', city.level, '城市:', city.cityName);
                        return `<div class="map-tooltip" style="border-left: 3px solid #666; padding: 8px;"><strong>${city.cityName}</strong><br/>数据加载中</div>`;
                    }

                    const nightFeels = Math.round(city.nightMinTemp + (city.humidity - 50) * 0.08);

                    const getValueColor = (value, mode) => {
                        switch (mode) {
                            case 'adi': return levelInfo.color;
                            case 'nightTemp': return value >= 28 ? '#D0021B' : value >= 26 ? '#F57C00' : value >= 24 ? '#F5A623' : '#00D4FF';
                            case 'feelsLike': return value >= 40 ? '#D0021B' : value >= 37 ? '#F57C00' : value >= 34 ? '#F5A623' : '#00D4FF';
                            case 'dayMax': return value >= 37 ? '#D0021B' : value >= 35 ? '#F57C00' : value >= 33 ? '#F5A623' : '#4A90E2';
                            default: return '#fff';
                        }
                    };

                    const getPrimaryValue = () => {
                        switch (viewMode) {
                            case 'adi': return { label: 'ADI', value: city.adiScore, color: getValueColor(city.adiScore, 'adi') };
                            case 'nightTemp': return { label: '夜间最低温', value: city.nightMinTemp + '℃', color: getValueColor(city.nightMinTemp, 'nightTemp') };
                            case 'feelsLike': return { label: '体感温度', value: city.feelsLike + '℃', color: getValueColor(city.feelsLike, 'feelsLike') };
                            case 'dayMax': return { label: '白天最高温', value: city.maxTemp + '℃', color: getValueColor(city.maxTemp, 'dayMax') };
                            default: return { label: 'ADI', value: city.adiScore, color: levelInfo.color };
                        }
                    };

                    const primary = getPrimaryValue();
                    const legendConfig = getLegendConfig(viewMode);

                    return `
                        <div class="map-tooltip" style="border-left: 3px solid ${levelInfo.color}">
                            <div class="tooltip-header">
                                <strong>${city.cityName}</strong>
                                <span class="tooltip-badge" style="background: ${levelInfo.color}">${levelInfo.name}</span>
                                ${viewMode !== 'adi' ? `<span class="tooltip-mode-badge">${legendConfig.title}</span>` : ''}
                            </div>
                            <div class="tooltip-body">
                                <div class="tooltip-primary-row">
                                    <span>${primary.label}:</span>
                                    <span style="color: ${primary.color}; font-weight: 700; font-size: 1.1em">${primary.value}</span>
                                </div>
                                ${viewMode !== 'adi' ? `<div style="margin: 6px 0; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1)">
                                    <div style="font-size: 0.9em; opacity: 0.8">ADI: <span style="color: ${levelInfo.color}">${city.adiScore} [${levelInfo.name}]</span></div>
                                </div>` : `
                                <div>白天最高温: <span style="color: ${getColorForTemp(city.maxTemp)}">${city.maxTemp}℃</span></div>
                                <div>夜间最低温: <span style="color: ${city.nightMinTemp >= 28 ? '#D0021B' : '#00D4FF'}">${city.nightMinTemp}℃</span></div>
                                <div>体感温度: <span style="color: ${getColorForTemp(city.feelsLike)}">${city.feelsLike}℃</span></div>
                                `}
                                <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.9em; opacity: 0.8">
                                    湿度: ${city.humidity}% ${city.continuousHotNightDays > 0 ? `<span style="color: #D0021B; margin-left: 8px">🌙 连续热夜 ${city.continuousHotNightDays}天</span>` : ''}
                                </div>
                            </div>
                            ${city.triggeredRules && city.triggeredRules.length > 0 ? `
                                <div class="tooltip-reason">判断原因: ${city.triggeredRules.join('、')}</div>
                            ` : ''}
                        </div>
                    `;
                }
            },
            geo: {
                map: 'china', roam: true,
                layoutCenter: ['50%', '45%'], layoutSize: '90%',
                itemStyle: { areaColor: '#141b3d', borderColor: '#2a3558' },
                emphasis: { itemStyle: { areaColor: '#1a2347' } },
                label: { show: false },
                regions: [{ name: '南海诸岛', itemStyle: { opacity: 0 } }]
            },
            visualMap: {
                min: range.min, max: range.max,
                left: '20', bottom: '20',
                text: ['高', '低'],
                calculable: true,
                inRange: {
                    color: viewMode === 'adi'
                        ? ['#333355', '#4A90E2', '#F5A623', '#F57C00', '#D0021B']
                        : ['#00D4FF', '#4A90E2', '#F5A623', '#F57C00', '#D0021B']
                },
                textStyle: { color: '#8b9dc3' },
                splitList: getSplitListForMode(viewMode)
            },
            series: [{
                type: 'scatter',
                coordinateSystem: 'geo',
                data: data,
                symbolSize: (val) => {
                    // 使用归一化值计算圆点大小，所有模式保持一致的视觉效果
                    const normalized = normalizeValue(val[2], viewMode);
                    return Math.max(normalized * 0.2, 6);
                },
                itemStyle: {
                    shadowBlur: 10,
                    shadowColor: 'rgba(0, 212, 255, 0.5)'
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 20,
                        shadowColor: 'rgba(0, 212, 255, 0.8)'
                    }
                }
            }]
        };

        mapChart.setOption(option, true);
        mapChart.resize();

        // Update view description
        updateViewDescription(viewMode);

        mapChart.off('click');
        mapChart.on('click', (params) => {
            if (params.componentType === 'series' && params.data) {
                UI.selectCity(params.data.name);
            }
        });
    }

    function highlightCity(cityName) {
        if (!mapChart) return;
        const option = mapChart.getOption();
        const data = option.series[0].data;

        data.forEach(item => {
            if (item.name === cityName) {
                item.itemStyle = {
                    shadowBlur: 30,
                    shadowColor: 'rgba(255, 53, 94, 0.9)',
                    borderColor: '#D0021B',
                    borderWidth: 2
                };
                item.symbolSize = 25;
            }
        });

        mapChart.setOption({ series: [{ data: data }] });
    }

    function clearHighlight() {
        if (!mapChart) return;
        if (window.UI && UI.state && UI.state.cityData) {
            render(UI.state.cityData, UI.state.mapViewMode);
        }
    }

    function getColorForTemp(temp) {
        if (temp >= 42) return '#D0021B';
        if (temp >= 38) return '#F57C00';
        if (temp >= 32) return '#F5A623';
        if (temp >= 28) return '#4A90E2';
        return '#00D4FF';
    }

    window.MapModule = {
        init: init,
        render: render,
        highlightCity: highlightCity,
        clearHighlight: clearHighlight,
        getLegendConfig: getLegendConfig
    };

})();
