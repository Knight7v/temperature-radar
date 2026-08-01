/**
 * Push Module - 企业微信群机器人推送(前端手动触发)
 * 读取 UI.state.cityData(已含全部算好的 ADI/level/趋势字段),按所选类型组装紧凑摘要,
 * POST 到 /api/push 由服务端格式化为 markdown 并转发到企业微信。
 *
 * 三类推送:
 *  - brief    完整简报(强度+重点+升温+大区)
 *  - heatFocus 高温重点关注(爆热+行动级城市+大区;达标才推)
 *  - heatRise  升温预报(未来3天 ADI 显著上升城市;达标才推)
 */

const Push = (function () {
    'use strict';

    // ===== 推送规则阈值(业务可调)=====
    const RULES = {
        heatRise: {
            minAdiChange: 10   // 未来3天 ADI 上升 ≥ 此值,视为"显著升温"
        }
        // 高温重点关注固定取 爆热级 + 行动级
    };

    function getCityData() {
        return (window.UI && window.UI.state && window.UI.state.cityData) || [];
    }

    function getCore() {
        return window.Core;
    }

    function showToast(msg) {
        if (window.UI && typeof window.UI.showToast === 'function') {
            window.UI.showToast(msg);
        } else {
            console.log('[Push]', msg);
        }
    }

    function fmtDate(d) {
        const pad = (n) => String(n).padStart(2, '0');
        return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function emptyStats() {
        return { outbreak: 0, action: 0, opportunity: 0, observe: 0 };
    }

    function baseSummary() {
        return {
            updateTime: fmtDate(new Date()),
            totalCities: getCityData().length,
            stats: emptyStats()
        };
    }

    // 重点大区(有爆热或行动级城市的大区,按热度取前 3)
    function regionList(Core, cityData) {
        const regionStats = Core.calculateRegionStats(cityData);
        return Object.entries(regionStats)
            .filter(([, st]) => st.explosiveCount > 0 || st.actionCount > 0)
            .sort((a, b) => (b[1].explosiveCount * 2 + b[1].actionCount) - (a[1].explosiveCount * 2 + a[1].actionCount))
            .slice(0, 3)
            .map(([name, st]) => ({
                name,
                level: st.level,
                explosive: st.explosiveCount,
                action: st.actionCount,
                reps: st.representativeCities || []
            }));
    }

    function toOutbreak(c) {
        return { name: c.cityName, adi: c.adiScore, maxTemp: c.maxTemp, nightMin: c.nightMinTemp, feelsLike: c.feelsLike };
    }

    // ===== 完整简报 =====
    function buildBriefSummary() {
        const cityData = getCityData();
        const Core = getCore();
        const summary = baseSummary();
        if (!Core || !cityData.length) return summary;

        summary.intensity = Core.calculateSalesIntensity(cityData);
        const stats = Core.getLevelStats(cityData);
        summary.stats = {
            outbreak: stats.outbreak || 0,
            action: stats.action || 0,
            opportunity: stats.opportunity || 0,
            observe: stats.observe || 0
        };
        summary.outbreakCities = Core.getCitiesByLevel(cityData, 'outbreak').map(toOutbreak);
        summary.actionCities = Core.getCitiesByLevel(cityData, 'action').map((c) => c.cityName);
        summary.risingCities = Core.getTopHeatRise(cityData, 8).map((c) => ({
            name: c.cityName, adiNow: c.adiScore, adiFuture3: c.futureAdi3,
            adiChange: c.adiChange, maxTempChange: c.maxTempChange
        }));
        summary.activeRegions = regionList(Core, cityData);
        return summary;
    }

    // ===== 高温重点关注(爆热+行动级 + 大区;达标才推)=====
    function buildHeatFocusSummary() {
        const cityData = getCityData();
        const Core = getCore();
        const summary = baseSummary();
        if (!Core || !cityData.length) { summary.hasContent = false; return summary; }

        const outbreak = Core.getCitiesByLevel(cityData, 'outbreak');
        const action = Core.getCitiesByLevel(cityData, 'action');
        const stats = Core.getLevelStats(cityData);
        summary.stats = { outbreak: stats.outbreak || 0, action: stats.action || 0 };
        summary.outbreakCities = outbreak.map(toOutbreak);
        summary.actionCities = action.map((c) => c.cityName);
        summary.activeRegions = regionList(Core, cityData);
        summary.hasContent = outbreak.length > 0 || action.length > 0;
        return summary;
    }

    // ===== 升温预报(未来3天 ADI 显著上升城市;达标才推)=====
    function buildHeatRiseSummary() {
        const cityData = getCityData();
        const Core = getCore();
        const summary = baseSummary();
        if (!Core || !cityData.length) { summary.hasContent = false; return summary; }

        const minChg = RULES.heatRise.minAdiChange;
        const rising = Core.getTopHeatRise(cityData, 50)
            .filter((c) => (c.adiChange || 0) >= minChg)
            .sort((a, b) => (b.adiChange || 0) - (a.adiChange || 0))
            .map((c) => ({
                name: c.cityName, adiNow: c.adiScore, adiFuture3: c.futureAdi3,
                adiChange: c.adiChange, maxTempChange: c.maxTempChange
            }));
        summary.risingCities = rising;
        summary.hasContent = rising.length > 0;
        return summary;
    }

    function buildSummary(type) {
        if (type === 'heatFocus') return buildHeatFocusSummary();
        if (type === 'heatRise') return buildHeatRiseSummary();
        return buildBriefSummary();
    }

    function getPushType() {
        const sel = document.getElementById('pushTypeSelect');
        return sel ? sel.value : 'brief';
    }

    /**
     * 一键推送。由简报模态框按钮调用,按所选内容类型推送。
     */
    async function pushBrief() {
        const type = getPushType();
        const btn = document.getElementById('pushWecomBtn');

        if (!getCityData().length) {
            showToast('数据尚未加载完成,请稍后再试');
            return;
        }

        const summary = buildSummary(type);

        // 规则类推送:达标才推,否则提示并中止(不调用 API)
        if (type !== 'brief' && summary.hasContent === false) {
            const msg = type === 'heatFocus'
                ? '今日暂无高温重点城市(无爆热/行动级),无需推送'
                : '今日暂无显著升温城市(未来3天 ADI 上升 < ' + RULES.heatRise.minAdiChange + '),无需推送';
            showToast(msg);
            return;
        }

        summary.type = type;
        const originalText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '推送中…'; }

        try {
            const resp = await fetch('/api/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(summary)
            });
            let data = {};
            try { data = await resp.json(); } catch (_) { /* 忽略非 JSON */ }

            if (resp.ok && data.success) {
                showToast('已推送到企业微信 ✓');
            } else {
                showToast('推送失败:' + (data.error || ('HTTP ' + resp.status)));
            }
        } catch (e) {
            showToast('推送失败:网络异常');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = originalText; }
        }
    }

    return { buildSummary, pushBrief, RULES };
})();

window.Push = Push;
