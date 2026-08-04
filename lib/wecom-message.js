// 企业微信群机器人消息格式化(纯函数)
// UMD:服务端 /api/push.js 用 require();Node 测试用 require()。
// 输入为前端 js/push.js 组装的紧凑摘要对象,按 type 输出对应企业微信 markdown。
// type:'brief'(完整简报)/ 'heatFocus'(高温重点关注)/ 'heatRise'(升温预报)

(function (root, factory) {
    const mod = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = mod;
    }
    if (typeof window !== 'undefined') {
        root.WecomMessage = mod;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 各列表显示上限(防止超过企业微信 markdown 4096 字节限制)
    const LIMITS = {
        outbreak: 6,
        action: 10,
        rising: 5,        // 完整简报里的升温条目
        risingFocus: 8,   // 升温预报专题里的条目
        region: 3,
        regionReps: 2
    };

    // 企业微信 markdown 单条内容字节上限
    const MAX_BYTES = 4096;

    function take(list, n) {
        return Array.isArray(list) ? list.slice(0, n) : [];
    }

    // 取安全值:undefined/null/NaN 一律视为缺失,回退到 fallback
    function safe(v, fallback) {
        return (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))) ? fallback : v;
    }

    function has(v) {
        return safe(v, '') !== '';
    }

    function colorForIntensity(level) {
        // 仅用企业微信支持的三色:warning(橙红)/info(绿)/comment(灰)
        if (level === '强' || level === '偏强') return 'warning';
        if (level === '中') return 'info';
        return 'comment';
    }

    function outbreakLines(outbreak) {
        return take(outbreak, LIMITS.outbreak).map((c, i) => {
            const name = safe(typeof c === 'object' ? c.name : c, '?');
            const adi = safe(c.adi, '');
            const max = safe(c.maxTemp, '');
            const night = safe(c.nightMin, '');
            const feels = safe(c.feelsLike, '');
            let seg = (i + 1) + '. ' + name;
            if (has(adi)) seg += ' ADI' + adi;
            const paren = [];
            if (has(max)) paren.push('最高' + max);
            if (has(night)) paren.push('夜' + night);
            if (has(feels)) paren.push('体感' + feels);
            if (paren.length) seg += '(' + paren.join('·') + ')';
            return seg;
        });
    }

    function actionNames(action) {
        return take(action, LIMITS.action).map(c => (typeof c === 'object' ? safe(c.name, '?') : safe(c, '?')));
    }

    function risingLines(rising, limit) {
        return take(rising, limit || LIMITS.rising).map(c => {
            const name = safe(c.name, '?');
            const now = safe(c.adiNow, '');
            const fut = safe(c.adiFuture3, '');
            const chg = safe(c.adiChange, '');
            const maxChg = safe(c.maxTempChange, '');
            let seg = '- ' + name;
            if (has(now) && has(fut)) seg += ' ' + now + '→' + fut;
            const extras = [];
            if (has(chg) && chg > 0) extras.push('+' + chg);
            if (has(maxChg) && maxChg > 0) extras.push('最高+' + maxChg + '℃');
            if (extras.length) seg += '(' + extras.join(',') + ')';
            return seg;
        });
    }

    function regionLines(regions) {
        return take(regions, LIMITS.region).map(r => {
            const name = safe(r.name, '?');
            const lvl = safe(r.level, '');
            const exp = safe(r.explosive, 0);
            const act = safe(r.action, 0);
            const reps = take(r.reps, LIMITS.regionReps).map(x => safe(x, '')).filter(Boolean).join('/');
            let seg = '- ' + name + (has(lvl) ? '(' + lvl + ')' : '') + ':爆热' + exp + '·行动' + act;
            if (reps) seg += ',代表 ' + reps;
            return seg;
        });
    }

    function statLine(s) {
        const stats = s.stats || {};
        const parts = [];
        if (has(stats.outbreak)) parts.push('爆热 ' + stats.outbreak);
        if (has(stats.action)) parts.push('行动 ' + stats.action);
        if (has(stats.opportunity)) parts.push('机会 ' + stats.opportunity);
        if (has(s.totalCities)) parts.push('监控 ' + s.totalCities + ' 城');
        return parts.join(' · ');
    }

    // 把若干「段落(行数组)」用空行分隔拼成内容
    function compose(blocks) {
        const lines = [];
        blocks.forEach(block => {
            if (block && block.length) {
                lines.push(...block);
                lines.push(''); // 段落间空行
            }
        });
        // 末尾多余的空行去掉
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
        return lines.join('\n');
    }

    const FOOTER = '<font color="comment">数据来源:和风天气|完整分析见「空调热销区域雷达」</font>';

    // ===== 完整简报 =====
    function buildMarkdown(summary) {
        const s = summary || {};
        const blocks = [];

        blocks.push([
            '## 📊 空调销售机会简报',
            has(s.updateTime) ? '更新于 ' + s.updateTime : ''
        ].filter(Boolean));

        const intensity = safe(s.intensity, '—');
        const headBlock = ['**销售机会强度:<font color="' + colorForIntensity(intensity) + '">' + intensity + '</font>**'];
        const sl = statLine(s);
        if (sl) headBlock.push(sl);
        blocks.push(headBlock);

        const ob = outbreakLines(s.outbreakCities);
        const ac = actionNames(s.actionCities);
        if (ob.length || ac.length) {
            const focus = ['### 🔥 高温重点关注'];
            if (ob.length) { focus.push('【爆热级 · 立即跟进】'); focus.push(...ob); }
            if (ac.length) { focus.push('【行动级 · 重点关注】'); focus.push(ac.join('、')); }
            blocks.push(focus);
        }

        const ri = risingLines(s.risingCities);
        if (ri.length) {
            blocks.push(['### 📈 即将升温(未来3天 ADI 上升)', ...ri]);
        }

        const rg = regionLines(s.activeRegions);
        if (rg.length) {
            blocks.push(['### 🌏 重点大区', ...rg]);
        }

        blocks.push([FOOTER]);

        return capBytes(compose(blocks));
    }

    // ===== 高温重点关注(只含爆热+行动级 + 大区)=====
    function buildHeatFocusMarkdown(summary) {
        const s = summary || {};
        const blocks = [];

        blocks.push([
            '## 🔥 高温重点关注',
            has(s.updateTime) ? '更新于 ' + s.updateTime : ''
        ].filter(Boolean));

        const stats = s.stats || {};
        const cnt = [];
        if (has(stats.outbreak)) cnt.push('爆热 ' + stats.outbreak);
        if (has(stats.action)) cnt.push('行动 ' + stats.action);
        if (cnt.length) blocks.push([cnt.join(' · ') + ' 城']);

        const ob = outbreakLines(s.outbreakCities);
        const ac = actionNames(s.actionCities);
        if (ob.length) { blocks.push(['【爆热级 · 立即跟进】', ...ob]); }
        if (ac.length) { blocks.push(['【行动级 · 重点关注】', ac.join('、')]); }

        const rg = regionLines(s.activeRegions);
        if (rg.length) { blocks.push(['### 重点大区', ...rg]); }

        blocks.push([FOOTER]);
        return capBytes(compose(blocks));
    }

    // ===== 升温预报(只含未来3天 ADI 显著上升城市)=====
    function buildHeatRiseMarkdown(summary) {
        const s = summary || {};
        const blocks = [];

        blocks.push([
            '## 📈 升温预报',
            has(s.updateTime) ? '更新于 ' + s.updateTime : ''
        ].filter(Boolean));

        const ri = risingLines(s.risingCities, LIMITS.risingFocus);
        if (ri.length) {
            // 改为带序号的列表,更醒目
            const numbered = ri.map((line, i) => line.replace(/^- /, (i + 1) + '. '));
            blocks.push(['未来3天 ADI 显著上升城市:', ...numbered]);
            blocks.push(['<font color="warning">建议提前跟进上述城市</font>']);
        }

        blocks.push([FOOTER]);
        return capBytes(compose(blocks));
    }

    function buildForType(type, summary) {
        if (type === 'heatFocus') return buildHeatFocusMarkdown(summary);
        if (type === 'heatRise') return buildHeatRiseMarkdown(summary);
        return buildMarkdown(summary);
    }

    // 字节安全:超过上限则按字符截断并追加提示
    function capBytes(content) {
        if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
            content = trimToBytes(content, MAX_BYTES);
        }
        return content;
    }

    function trimToBytes(content, maxBytes) {
        const note = '\n\n<font color="comment">(内容过长已截断)</font>';
        const budget = maxBytes - Buffer.byteLength(note, 'utf8');
        let out = '';
        for (const ch of content) {
            if (Buffer.byteLength(out + ch, 'utf8') > budget) break;
            out += ch;
        }
        return out + note;
    }

    return {
        buildMarkdown,
        buildHeatFocusMarkdown,
        buildHeatRiseMarkdown,
        buildForType,
        buildPayload(type, summary) {
            return { msgtype: 'markdown', markdown: { content: buildForType(type || 'brief', summary) } };
        },
        LIMITS,
        MAX_BYTES,
        // 暴露给测试
        _take: take,
        _trimToBytes: trimToBytes
    };
});
