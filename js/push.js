/**
 * Push Module - 企业微信群机器人推送(前端手动触发)
 * 读取 UI.state.cityData(已含全部算好的 ADI/level/趋势字段),按所选类型组装紧凑摘要,
 * POST 到 /api/push 由服务端格式化为 markdown 并转发到企业微信。
 *
 * 三类推送:
 *  - brief    完整简报(强度+重点+升温+大区)
 *  - heatFocus 高温重点关注(爆热+行动级城市+大区;达标才推)
 *  - heatRise  升温预报(未来3天 ADI 显著上升城市;达标才推)
 *
 * 摘要构造逻辑委派给共享模块 ADICore.buildSummary,与即将到来的服务端 cron 推送共用同一份事实源。
 */

const Push = (function () {
    'use strict';

    // ===== 推送规则阈值(业务可调;值与 adi-core.js 保持一致)=====
    const RULES = {
        heatRise: {
            minAdiChange: 10   // 未来3天 ADI 上升 ≥ 此值,视为"显著升温"
        }
        // 高温重点关注固定取 爆热级 + 行动级
    };

    function getCityData() {
        return (window.UI && window.UI.state && window.UI.state.cityData) || [];
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

    // 委派给共享模块 ADICore.buildSummary,与 cron 推送同源。
    // ADICore.buildSummary 对 heatFocus/heatRise 返回 hasContent,brief 不返回,匹配下方 pushBrief 的门控判断。
    function buildSummary(type) {
        const cityData = getCityData();
        return window.ADICore.buildSummary(type, cityData, { updateTime: fmtDate(new Date()) });
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
