const assert = require('node:assert/strict');
const path = require('node:path');

const WecomMessage = require(path.join(__dirname, '..', 'lib', 'wecom-message.js'));

function run(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        throw error;
    }
}

function sampleSummary(overrides) {
    return {
        updateTime: '07/31 08:00',
        intensity: '偏强',
        totalCities: 130,
        stats: { outbreak: 5, action: 12, opportunity: 20, observe: 30 },
        outbreakCities: [
            { name: '武汉', adi: 88, maxTemp: 37, nightMin: 29, feelsLike: 40 },
            { name: '长沙', adi: 86, maxTemp: 36, nightMin: 28, feelsLike: 39 }
        ],
        actionCities: ['南昌', '杭州', '合肥'],
        risingCities: [
            { name: '合肥', adiNow: 62, adiFuture3: 78, adiChange: 16, maxTempChange: 3 },
            { name: '南京', adiNow: 58, adiFuture3: 71, adiChange: 13, maxTempChange: 0 }
        ],
        activeRegions: [
            { name: '华中', level: '强', explosive: 3, action: 5, reps: ['武汉', '长沙'] },
            { name: '华东', level: '偏强', explosive: 2, action: 4, reps: ['杭州', '南京'] }
        ],
        ...overrides
    };
}

run('正常摘要包含全部关键段落', () => {
    const md = WecomMessage.buildMarkdown(sampleSummary());
    assert.match(md, /空调销售机会简报/);
    assert.match(md, /销售机会强度/);
    assert.match(md, /高温重点关注/);
    assert.match(md, /武汉 ADI88/);
    assert.match(md, /行动级 · 重点关注/);
    assert.match(md, /即将升温/);
    assert.match(md, /合肥 62→78/);
    assert.match(md, /重点大区/);
    assert.match(md, /华中\(强\)/);
    assert.match(md, /数据来源:和风天气/);
});

run('空数据不报错且保留标题与脚注', () => {
    const md = WecomMessage.buildMarkdown({});
    assert.match(md, /空调销售机会简报/);
    assert.match(md, /数据来源:和风天气/);
    // 无城市时不应出现重点段落标题
    assert.doesNotMatch(md, /高温重点关注/);
});

run('爆热城市列表被截断到上限', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
        name: '城' + i, adi: 90 - i, maxTemp: 37, nightMin: 29, feelsLike: 40
    }));
    const md = WecomMessage.buildMarkdown(sampleSummary({ outbreakCities: many }));
    const listed = (md.match(/^\d+\. /gm) || []).length;
    assert.equal(listed, WecomMessage.LIMITS.outbreak, '爆热列表应截断到 LIMITS.outbreak');
});

run('生成内容字节长度小于 4096', () => {
    const md = WecomMessage.buildMarkdown(sampleSummary());
    assert.ok(Buffer.byteLength(md, 'utf8') < WecomMessage.MAX_BYTES, '应小于 4096 字节');
});

run('极端超长输入仍不超字节上限(靠列表上限)', () => {
    const huge = Array.from({ length: 500 }, (_, i) => ({
        name: '超长城市名称测试' + i, adi: 88, maxTemp: 37, nightMin: 29, feelsLike: 40
    }));
    const md = WecomMessage.buildMarkdown(sampleSummary({ outbreakCities: huge }));
    const bytes = Buffer.byteLength(md, 'utf8');
    assert.ok(bytes <= WecomMessage.MAX_BYTES, '应 ≤ 4096 字节,实际 ' + bytes);
    // 列表上限是主防线,只应显示 LIMITS.outbreak 条
    const listed = (md.match(/^\d+\. /gm) || []).length;
    assert.equal(listed, WecomMessage.LIMITS.outbreak);
});

run('_trimToBytes 字节安全网正确截断', () => {
    // 构造一条超过 4096 字节的字符串,直接验证兜底截断逻辑
    const big = '## 标题\n' + 'x'.repeat(6000);
    const trimmed = WecomMessage._trimToBytes(big, WecomMessage.MAX_BYTES);
    const bytes = Buffer.byteLength(trimmed, 'utf8');
    assert.ok(bytes <= WecomMessage.MAX_BYTES, '截断后应 ≤ 4096 字节,实际 ' + bytes);
    assert.match(trimmed, /内容过长已截断/);
});

run('缺失字段安全不抛错', () => {
    const md = WecomMessage.buildMarkdown({
        outbreakCities: [{ name: '武汉' }],           // 缺 adi/温度
        risingCities: [{ name: '合肥', adiChange: 5 }], // 缺 adiNow/adiFuture3
        activeRegions: [{ name: '华中' }]               // 缺 level/计数
    });
    assert.match(md, /武汉/);
    assert.match(md, /合肥/);
    assert.match(md, /华中/);
});

run('高温重点关注消息只含爆热/行动/大区', () => {
    const md = WecomMessage.buildHeatFocusMarkdown(sampleSummary());
    assert.match(md, /高温重点关注/);
    assert.match(md, /爆热级 · 立即跟进/);
    assert.match(md, /武汉 ADI88/);
    assert.match(md, /行动级 · 重点关注/);
    assert.match(md, /重点大区/);
    // 高温重点关注不应包含升温段
    assert.doesNotMatch(md, /即将升温/);
});

run('升温预报消息含显著升温城市且不含高温重点', () => {
    const md = WecomMessage.buildHeatRiseMarkdown(sampleSummary());
    assert.match(md, /升温预报/);
    assert.match(md, /合肥 62→78/);
    assert.match(md, /建议提前跟进/);
    // 升温预报不应包含高温重点关注段
    assert.doesNotMatch(md, /高温重点关注/);
});

run('buildForType 按类型分发', () => {
    assert.match(WecomMessage.buildForType('brief', sampleSummary()), /空调销售机会简报/);
    assert.match(WecomMessage.buildForType('heatFocus', sampleSummary()), /高温重点关注/);
    assert.match(WecomMessage.buildForType('heatRise', sampleSummary()), /升温预报/);
    // 未知类型回退到完整简报
    assert.match(WecomMessage.buildForType('unknown', sampleSummary()), /空调销售机会简报/);
});

run('高温重点关注无城市时仍安全输出', () => {
    const md = WecomMessage.buildHeatFocusMarkdown({
        updateTime: '07/31 08:00',
        stats: { outbreak: 0, action: 0 }
    });
    assert.match(md, /高温重点关注/);
    assert.doesNotMatch(md, /爆热级/);
});

run('升温预报无城市时仍安全输出', () => {
    const md = WecomMessage.buildHeatRiseMarkdown({ updateTime: '07/31 08:00', risingCities: [] });
    assert.match(md, /升温预报/);
    assert.doesNotMatch(md, /建议提前跟进/);
});

run('buildPayload 按类型生成企业微信所需结构', () => {
    const payload = WecomMessage.buildPayload('heatFocus', sampleSummary());
    assert.equal(payload.msgtype, 'markdown');
    assert.ok(payload.markdown.content.includes('高温重点关注'));
});
