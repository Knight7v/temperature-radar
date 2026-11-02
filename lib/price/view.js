'use strict';
/* 价格监控 —— 展示层整形（纯函数：不连数据库）。
 * store.js 负责查库，这里负责把「库里的行」变成「页面要的 JSON」。
 * 单独拆出来的原因：告警列表怎么拼、缺数据怎么写，是业务判断，
 * 必须能脱离数据库用单测固定住，否则接口一改就悄悄变形。 */

const BRAND_LABEL = { gree: '格力', haier: '海尔' };

/* pg 的 numeric 取回来是字符串（"3299.00"），不转成数字会让 gap 变成字符串拼接 */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtDateTime(value) {
  if (!value) return '—';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function fmtDay(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${get('month')}-${get('day')}`;
}

function modelLabel(model) {
  const brand = BRAND_LABEL[model.brand] || model.brand || '';
  const tail = model.series || model.code || model.name || '';
  return `${brand} ${tail} ${model.capacity || ''}`.replace(/\s+/g, ' ').trim() || model.modelKey;
}

/* 机型 + 今日快照 → 判价模块要的入参。
 * 今天没有快照的链接显式标 'not_collected'，绝不拿昨天的价格顶上（见规格 §4.5）。
 * 三个价格字段一起传：判价只用到手价，但恒等式自检需要标价和券后价做对照。 */
function toEvalModel(model, obsMap) {
  const pick = (side) =>
    (model.links || [])
      .filter((l) => l.side === side && l.status === 'active')
      .map((l) => {
        const o = obsMap.get(l.id);
        return {
          linkId: l.id,
          shopId: l.shopId,
          shopName: l.shopName,
          status: o ? o.status : 'not_collected',
          listed: o ? num(o.listed_price) : null,
          afterPromo: o ? num(o.after_promo_price) : null,
          landed: o ? num(o.landed_price) : null,
          subsidyFlag: (o && o.subsidy_flag) || null,
          promoText: (o && o.promo_text) || null,
          confidence: (o && o.landed_confidence) || null
        };
      });
  return {
    modelKey: model.modelKey,
    name: modelLabel(model),
    brand: model.brand,
    priority: !!model.priority,
    ownLinks: pick('own'),
    competitorLinks: pick('competitor')
  };
}

const FAIL_REASON = {
  blocked: '被风控/验证码拦截',
  failed: '连续失败（超时或未识别）',
  delisted: '商品已下架',
  not_collected: '今日尚未采集'
};

function reasonText(obs) {
  if (!obs) return FAIL_REASON.not_collected;
  if (obs.reason) return obs.reason;
  return FAIL_REASON[obs.status] || '采集失败';
}

/* 一条命中 = 页面表格的一行。判价结果来自 evaluate.js，这里只负责翻译成人话：
 * 谁更低、低多少、还有几家更低、能不能点开看全部链接。 */
function buildHits(entries, ctx) {
  const { alertByModel, obsMap, trendByModel } = ctx;
  const out = [];

  for (const { model, row } of entries) {
    const alert = alertByModel.get(model.id) || null;
    const alertStatus = alert ? alert.status : null;

    // 进列表的三种情况：今天采集成功（不管命中与否）、曾经报过需要留痕、刚回升。
    // 为什么"没命中"也要展示：改到手价口径后，很多机型我们其实是便宜的，
    // 只显示命中会让页面一片空白——而"我们比对手便宜多少"同样是经营决策要看的信息。
    const keep = row.status === 'ok' || (alert && alertStatus !== 'recovered') || (alert && alertStatus === 'recovered' && row.status === 'ok');
    if (!keep) continue;

    // 只列还在用的链接：被停用的（多规格合一、下架换款）不采集，列出来只会显示成"采集失败"
    const links = (model.links || []).filter((l) => l.status === 'active').map((l) => {
      const o = obsMap.get(l.id);
      const ok = o && o.status === 'ok';
      const landed = ok ? num(o.landed_price) : null;
      return {
        shop: l.shopName || '—',
        side: l.side === 'own' ? 'own' : 'comp',
        price: landed, // 到手价（下钻表的主列）
        listed: ok ? num(o.listed_price) : null,
        afterPromo: ok ? num(o.after_promo_price) : null,
        subsidy: ok ? num(o.subsidy_amount) : null,
        promoText: (o && o.promo_text) || '',
        subsidyFlag: (o && o.subsidy_flag) || 'unknown',
        confidence: (o && o.landed_confidence) || null,
        status: o ? o.status : 'not_collected',
        at: o ? fmtDateTime(o.capturedAt) : '—',
        reason: o && o.status !== 'ok' ? reasonText(o) : ''
      };
    });

    const own = row.status === 'ok' ? row.own : null;
    const comp = row.status === 'ok' ? row.competitor : null;
    const trend = trendByModel.get(model.id) || null;

    out.push({
      id: model.id,
      brand: model.brand,
      series: model.series || model.code || '',
      code: model.code || '',
      cap: model.capacity || '',
      my: own ? own.price : alert ? num(alert.ownPrice) : null,
      comp: comp ? comp.price : alert ? num(alert.competitorPrice) : null,
      myListed: own ? own.listed : null,
      compListed: comp ? comp.listed : null,
      shop: comp ? comp.shopName || '—' : (alert && alert.competitorShop) || '—',
      lowerCount: comp ? comp.otherLower : (alert ? alert.otherLower : 0),
      confidence: row.confidence || (alert && alert.confidence) || 'low',
      status: alertStatus || (row.hit ? 'open' : 'normal'),
      hit: !!row.hit,
      firstSeen: alert ? fmtDateTime(alert.firstSeenAt) : fmtDateTime(new Date()),
      alertId: alert ? alert.id : null,
      trendLabels: trend ? trend.labels : [],
      trendMy: trend ? trend.my : [],
      trendComp: trend ? trend.comp : [],
      links
    });
  }

  // 差得最多的排最前面，运营先看最疼的；我们更便宜的排在后面，但不是不显示
  const gapOf = (h) => (h.my == null || h.comp == null ? -1e9 : Number(h.my) - Number(h.comp));
  return out.sort((a, b) => gapOf(b) - gapOf(a));
}

/* 缺失清单：今天没采到、但历史上采到过的链接。
 * 从没采过的链接不进这个表（新加的链接还没轮到它跑），否则第一次打开页面会有几百条"缺失"。 */
function buildMissing(models, obsMap, lastOkByLink) {
  const out = [];
  for (const model of models) {
    for (const l of model.links || []) {
      if (l.status !== 'active') continue;
      const o = obsMap.get(l.id);
      const ok = o && o.status === 'ok';
      if (ok) continue;
      const last = lastOkByLink.get(l.id);
      if (!o && !last) continue; // 从未采集过，不算缺失
      out.push({
        model: modelLabel(model),
        shop: l.shopName || '—',
        url: l.url,
        reason: reasonText(o),
        last: last ? num(last.landed_price) : null,
        lastAt: last ? fmtDateTime(last.capturedAt) : '—'
      });
    }
  }
  return out;
}

/* 「查看链接」用的整形：按商品（机型）分组，把每个机型下挂的链接全列出来。
 *
 * 为什么要单独一个函数：今日对比只显示「今天采到的」机型，没采的、刚挂上还没轮到的
 * 都看不见——用户会以为链接没导进去。这里不走判价，只要「我到底在监控哪些链接」，
 * 所以每条链接都列，包括已停用的（灰掉），否则运营找不到那条被暂停的链接。
 *
 * latestByLink: Map<linkId, { last_status, last_reason, last_at, ok_landed, ok_listed, ok_at }>
 */
function buildLinkGroups(models, latestByLink) {
  const groups = [];

  for (const model of models) {
    const links = (model.links || []).map((l) => {
      const m = (latestByLink && latestByLink.get(l.id)) || {};
      const sku = l.sku || (String(l.url || '').match(/(\d{6,})/) || [])[1] || '';
      return {
        id: l.id,
        side: l.side === 'own' ? 'own' : 'comp',
        url: l.url,
        sku,
        shop: l.shopName || '—',
        title: l.title || '',
        status: l.status || 'active',
        // 价格取「最近一次成功」，不取今天：查看链接是盘点清单，不是今天的比价
        price: num(m.ok_landed),
        listed: num(m.ok_listed),
        at: m.ok_at ? fmtDateTime(m.ok_at) : '—',
        obsStatus: m.last_status || null,
        lastAt: m.last_at ? fmtDateTime(m.last_at) : '—',
        reason: m.last_reason || ''
      };
    });
    const own = links.filter((l) => l.side === 'own');
    const comp = links.filter((l) => l.side === 'comp');

    groups.push({
      id: model.id,
      label: modelLabel(model),
      brand: model.brand,
      series: model.series || model.code || '',
      code: model.code || '',
      cap: model.capacity || '',
      priority: !!model.priority,
      modelStatus: model.status || 'active',
      ownCount: own.length,
      compCount: comp.length,
      activeCount: links.filter((l) => l.status === 'active').length,
      pausedCount: links.filter((l) => l.status !== 'active').length,
      links
    });
  }

  // 重点机型排最前，其余按系列名排，运营扫一眼就能找到自己在看的那台
  groups.sort((a, b) => {
    const p = (b.priority ? 1 : 0) - (a.priority ? 1 : 0);
    if (p) return p;
    const brand = String(a.brand).localeCompare(String(b.brand));
    if (brand) return brand;
    return String(a.label).localeCompare(String(b.label), 'zh-Hans-CN');
  });

  const all = groups.reduce((acc, g) => acc.concat(g.links), []);
  return {
    groups,
    summary: {
      models: groups.length,
      links: all.length,
      own: all.filter((l) => l.side === 'own').length,
      comp: all.filter((l) => l.side === 'comp').length,
      paused: all.filter((l) => l.status !== 'active').length
    }
  };
}

/* 下一次采集时点：把 10:00 / 20:00 和当前时间比一下，取最近的那个（跨天回到第一个） */
function nextRunAt(now, fullTime, focusTime) {
  const base = new Date(now);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(base);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '00';
  const nowMin = Number(get('hour')) * 60 + Number(get('minute'));
  const toMin = (s) => {
    const [h, m] = String(s || '0:0').split(':');
    return Number(h) * 60 + Number(m || 0);
  };
  const slots = [fullTime || '10:00', focusTime || '20:00'].map((s) => ({ label: s, min: toMin(s) }));
  const next = slots.filter((s) => s.min > nowMin).sort((a, b) => a.min - b.min)[0];
  return next ? `今天 ${next.label}` : `明天 ${slots.sort((a, b) => a.min - b.min)[0].label}`;
}

module.exports = {
  num,
  fmtDateTime,
  fmtDay,
  modelLabel,
  toEvalModel,
  buildHits,
  buildMissing,
  buildLinkGroups,
  nextRunAt,
  reasonText
};
