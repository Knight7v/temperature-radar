const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// DealKit 是浏览器端 IIFE（挂在 window 上），这里用 vm 造一个最小 window 加载它，
// 再用 Proxy 造一个只记录调用的假 canvas context —— 能验证绘制流程和文案落位，不需要真实浏览器。
const code = fs.readFileSync(path.resolve(__dirname, '../js/design-deal.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const DealKit = sandbox.window.DealKit;

function makeCtx() {
  const calls = [];
  const gradient = { addColorStop() {} };
  const state = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: String(text).length * 8 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      return (...args) => {
        calls.push({ name: key, args });
      };
    },
    set(target, key, value) {
      target[key] = value;
      // 记录属性赋值，用来判断气流有没有真的切到 lighter 混合模式
      calls.push({ name: '@set', args: [key, value] });
      return true;
    }
  });
  return { ctx, calls };
}

// 气流要挂在商品上，测试时给个只有宽高的假商品对象即可（drawImage 是空操作）
const FAKE_PRODUCT = { width: 1024, height: 340 };

function texts(calls) {
  return calls.filter(call => call.name === 'fillText').map(call => String(call.args[0]));
}

test('DealKit 暴露渲染器与四套配色', () => {
  assert.equal(typeof DealKit.render, 'function');
  assert.equal(typeof DealKit.checks, 'function');
  assert.equal(DealKit.BASE, 1080);
  const names = Object.keys(DealKit.THEMES);
  assert.deepEqual(names.sort(), ['crimson', 'gold', 'ice', 'ink']);
  for (const name of names) {
    const theme = DealKit.THEMES[name];
    for (const key of ['top', 'mid', 'low', 'floor', 'brand', 'accent', 'priceBg', 'footerBg', 'serviceInk']) {
      assert.ok(theme[key], `${name} 缺少配色 ${key}`);
    }
  }
});

test('默认配置渲染出全部关键区块的文案', () => {
  const { ctx, calls } = makeCtx();
  DealKit.render(ctx, 1200, DealKit.DEFAULTS, { product: null, portrait: null, whiteBackdrop: false });
  const all = texts(calls);

  assert.ok(all.includes('1.5匹'), '规格胶囊');
  assert.ok(all.includes('适用：16-20m²'), '适用面积');
  assert.ok(all.includes('硬核新品 风量新升级'), '主标题');
  assert.ok(all.includes('新一级能效  |  56℃净菌自洁  |  WiFi智控'), '副标题按 | 拼接');
  assert.ok(all.includes('2124'), '价格整数');
  assert.ok(all.includes('.15'), '价格小数');
  assert.ok(all.includes('10月20日晚8点开抢：'), '开抢时间');
  assert.ok(all.includes('纯铜管'), '印章大字');
  assert.ok(all.includes('免费包修'), '服务承诺');
  assert.ok(all.includes('650') && all.includes('30'), '第二条与第三条承诺');
  assert.ok(all.includes('格力空调官方直营'), '底部左侧');
  assert.ok(all.includes('真材实料格力造·纯铜管·真省电'), '底部右侧');
  assert.ok(all.includes('GREE格力'), '品牌角标');
});

test('价格与标题改动后重新渲染会跟着变', () => {
  const cfg = Object.assign({}, DealKit.DEFAULTS, { priceInt: '899', priceDec: '00', title: '限时秒杀 直降600' });
  const { ctx, calls } = makeCtx();
  DealKit.render(ctx, 800, cfg, {});
  const all = texts(calls);
  assert.ok(all.includes('899'));
  assert.ok(all.includes('.00'));
  assert.ok(all.includes('限时秒杀 直降600'));
  assert.ok(!all.includes('2124'), '旧价格不应该残留');
});

test('关掉印章和气流后不再画对应区块', () => {
  const cfg = Object.assign({}, DealKit.DEFAULTS, { showSeal: false, showAirflow: false });
  const { ctx, calls } = makeCtx();
  DealKit.render(ctx, 1200, cfg, { product: FAKE_PRODUCT });
  assert.ok(!texts(calls).includes('纯铜管'), '印章已关闭');
  // 气流是唯一使用 lighter 混合的区块，关掉后不应该再出现
  const lighter = calls.filter(call => call.name === '@set' && call.args[0] === 'globalCompositeOperation' && call.args[1] === 'lighter');
  assert.equal(lighter.length, 0, '气流已关闭，不应切 lighter');
});

test('没有商品图时画出占位提示而不是崩溃', () => {
  const { ctx, calls } = makeCtx();
  assert.doesNotThrow(() => DealKit.render(ctx, 1200, DealKit.DEFAULTS, { product: null }));
  assert.ok(texts(calls).some(text => text.includes('上传商品图')));
});

test('任意尺寸都能渲染，坐标按 1080 基准等比缩放', () => {
  const { ctx, calls } = makeCtx();
  DealKit.render(ctx, 800, DealKit.DEFAULTS, {});
  const scale = calls.find(call => call.name === 'scale');
  assert.ok(scale, '应该调用过 scale');
  assert.ok(Math.abs(scale.args[0] - 800 / 1080) < 1e-9);
});

test('合规检查：价格缺失与标题过长会被标出来', () => {
  const rows = DealKit.checks(Object.assign({}, DealKit.DEFAULTS, { priceInt: '' }), 1200);
  const price = rows.find(row => row.label === '价格');
  assert.equal(price.ok, false);

  const longTitle = DealKit.checks(
    Object.assign({}, DealKit.DEFAULTS, { title: '这是一个明显超过十四个字的主标题用于测试' }),
    1200
  );
  assert.equal(longTitle.find(row => row.label === '主标题').ok, false);

  const ok = DealKit.checks(DealKit.DEFAULTS, 1200);
  assert.equal(ok.find(row => row.label === '主标题').ok, true);
  assert.equal(ok.find(row => row.label === '尺寸').ok, true);
});

test('合规检查提示大促图不能当京东首图', () => {
  const rows = DealKit.checks(DealKit.DEFAULTS, 1200);
  const tip = rows.find(row => row.label === '投放位置');
  assert.ok(tip, '必须有投放位置提示');
  assert.equal(tip.level, 'warn');
  assert.ok(tip.text.includes('牛皮癣'));
});

test('开启气流时使用 lighter 混合，做出叠光效果', () => {
  const { ctx, calls } = makeCtx();
  DealKit.render(ctx, 1200, DealKit.DEFAULTS, { product: FAKE_PRODUCT });
  const lighter = calls.filter(
    call => call.name === '@set' && call.args[0] === 'globalCompositeOperation' && call.args[1] === 'lighter'
  );
  assert.ok(lighter.length >= 1, '默认应该画气流');
});
