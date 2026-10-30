'use strict';

// 产品参数「标准字段表」。
//
// 目的只有一个：打开任何一个型号，同一个参数字段永远落在同一个位置。
//
// 为什么需要这张表：参数是从详情页 / 参数表里自由抓下来的数组，一台机器抓到几条就存几条。
// 直接遍历渲染，字段数不同的机器（有的 17 条、有的 40 条）位置就全乱了 ——
// 主管上下对比两台机器时，眼睛得重新找一遍「制冷量在哪」。
//
// 三条铁律：
//   1. key 是「库里的标准写法」。改它等于改数据口径，会牵连导入映射（gree-table.js 的 ROWS）
//      和 PK 取值（pk-fields.js）。改之前先跑 tests/product-fields.test.js。
//   2. 单位统一到 unit 上。同一字段在库里有时写进 unit、有时塞在 value 尾部（"35/42kg"），
//      展示前先剥掉再拼，否则会出现「35/42kg kg」。
//   3. 库里从来没有单位记录的字段（如适用面积）不许擅自补单位 —— 事实底座只搬运，不发明。
//
// extra 标记说明：这些字段来自客服主管提供的主力机型精细参数表，只有 2%~8% 的机型有。
// 空白不是「数据缺损」，是那台机器本来就没写，且都不是分销主销机型 —— 所以页面显示「待补充」，
// 不当成错误去催补录。
//
// pk 标记说明：pk.html「机型性能PK」作图 / 选购指南要取值的字段（共 11 个）。
// 和 extra 是两回事 —— extra 空白「认了」，pk 空白会直接影响出图（那一行只能是「—」），
// 所以列表行展开和详情抽屉要把这些格子标出来催填「请尽快填写」。
// 与 pk-fields.js 的一致性由 tests/product-fields.test.js 反向校验：把 45 个字段全填一遍，
// PK 取值里除了「节能模式 / 电量查询」（知识库暂无对应字段）不该再剩下「—」。改 pk-fields.js 要留意。

const SECTIONS = Object.freeze([
  { id: 'core', label: '核心性能', hint: '匹数、能效、冷热量 —— 顾客第一个会问的' },
  { id: 'power', label: '功率耗电', hint: '算电费、看线路带不带得动' },
  { id: 'air', label: '风量与噪音', hint: '风多大、吵不吵' },
  { id: 'comfort', label: '舒适功能', hint: '送风方式、睡眠、除湿这些体感配置' },
  { id: 'hardware', label: '硬件用料', hint: '铜管、节流、冷媒 —— 比硬件时用' },
  { id: 'size', label: '尺寸重量', hint: '安装位置够不够、挂不挂得住' },
  { id: 'misc', label: '智能 · 外观 · 随箱', hint: '能不能连手机、什么颜色、箱子里有什么' }
]);

// 顺序 = 页面展示顺序。同一个字段在所有型号里位置固定，靠的就是这个数组不变。
const FIELDS = Object.freeze([
  /* ---- 核心性能 ---- */
  { key: '匹数', section: 'core', unit: '' },
  { key: '冷暖类型', section: 'core', unit: '' },
  { key: '变频类型', section: 'core', unit: '' },
  { key: '能效等级', section: 'core', unit: '' },
  { key: 'APF 能效比', section: 'core', unit: '', pk: true, aliases: ['APF能效比', 'APF 值', 'APF值', 'APF'] },
  { key: '制冷量', section: 'core', unit: 'W' },
  { key: '制热量', section: 'core', unit: 'W' },
  { key: '适用面积', section: 'core', unit: '' },

  /* ---- 功率耗电 ---- */
  { key: '制冷功率', section: 'power', unit: 'W' },
  { key: '制热功率', section: 'power', unit: 'W' },
  { key: '电辅热', section: 'power', unit: '', aliases: ['电辅热功能'] },
  { key: '电辅热功率', section: 'power', unit: 'W' },

  /* ---- 风量与噪音 ---- */
  { key: '循环风量', section: 'air', unit: 'm³/h', pk: true, aliases: ['风量', '风量m³/h', '循环风量m³/h'] },
  { key: '内机噪音', section: 'air', unit: 'dB(A)', aliases: ['室内噪音', '内机噪声'] },
  { key: '外机噪音', section: 'air', unit: 'dB(A)', aliases: ['室外噪音', '外机噪声'] },

  /* ---- 舒适功能 ---- */
  { key: '风速档位', section: 'comfort', unit: '', aliases: ['风速'], extra: true },
  { key: '温度调节', section: 'comfort', unit: '', pk: true, aliases: ['调温', '温度控制'], extra: true },
  { key: '独立除湿', section: 'comfort', unit: '', extra: true },
  { key: '睡眠模式', section: 'comfort', unit: '', pk: true, extra: true },
  { key: '导风板', section: 'comfort', unit: '', pk: true, aliases: ['导风板类型'], extra: true },
  { key: '送风角度', section: 'comfort', unit: '', pk: true, aliases: ['扫风角度'], extra: true },
  { key: '出风口设计', section: 'comfort', unit: '', extra: true },
  { key: '智能光敏', section: 'comfort', unit: '', pk: true, aliases: ['光敏传感', '智能光敏护眠'], extra: true },
  { key: '制热防冷风', section: 'comfort', unit: '', extra: true },
  { key: '保温模式', section: 'comfort', unit: '', extra: true },
  { key: '防直吹', section: 'comfort', unit: '', aliases: ['是否防直吹'], extra: true },
  { key: '自主检测室温', section: 'comfort', unit: '', aliases: ['制冷模式自主检测室温'], extra: true },

  /* ---- 硬件用料 ---- */
  { key: '铜管排数', section: 'hardware', unit: '', pk: true, extra: true },
  { key: '节流部件', section: 'hardware', unit: '', aliases: ['节流部件（电子膨胀阀/毛细管）'], extra: true },
  { key: '制冷剂', section: 'hardware', unit: '', aliases: ['冷媒'], extra: true },
  { key: '外机运行温度', section: 'hardware', unit: '℃', pk: true, aliases: ['运行温度'], extra: true },
  { key: '冷酷外机', section: 'hardware', unit: '', extra: true },

  /* ---- 尺寸重量 ---- */
  {
    key: '内机尺寸(宽x高x深)',
    section: 'size',
    unit: 'mm',
    label: '内机尺寸',
    aliases: ['内机尺寸', '内机尺寸(宽×高×深)', '内机尺寸（宽x高x深）', '内机尺寸（宽×高×深）']
  },
  {
    key: '外机尺寸(宽x高x深)',
    section: 'size',
    unit: 'mm',
    label: '外机尺寸',
    aliases: ['外机尺寸', '外机尺寸(宽×高×深)', '外机尺寸（宽x高x深）', '外机尺寸（宽×高×深）']
  },
  { key: '内机净重', section: 'size', unit: 'kg', aliases: ['室内机净重'] },
  { key: '外机净重', section: 'size', unit: 'kg', aliases: ['室外机净重'] },
  { key: '电压/频率', section: 'size', unit: '', aliases: ['电压频率', '电源'] },

  /* ---- 智能 · 外观 · 随箱 ---- */
  { key: 'WiFi 智控', section: 'misc', unit: '', pk: true, aliases: ['WiFi智控', 'WiFi', '智能WIFI', '智能WiFi', '智能wifi'], extra: true },
  { key: '清洁方式', section: 'misc', unit: '', pk: true, extra: true },
  { key: '定时', section: 'misc', unit: '', aliases: ['定时功能'], extra: true },
  { key: '颜色', section: 'misc', unit: '', aliases: ['外观', '机身颜色'], extra: true },
  { key: '面板工艺', section: 'misc', unit: '', extra: true },
  { key: '内机装箱清单', section: 'misc', unit: '', aliases: ['室内机装箱清单'] },
  { key: '外机装箱清单', section: 'misc', unit: '', aliases: ['室外机装箱清单'] },
  { key: '其他卖点', section: 'misc', unit: '', extra: true }
]);

const MISSING_TEXT = '待补充';

/* 缺了会影响 PK 出图的格子，用这句话催填（前后端同一句，别各写一份） */
const PK_MISSING_TEXT = '请尽快填写';

const FIELD_KEYS = FIELDS.map(item => item.key);

/* PK 作图要取值的字段清单（顺序同字段表） */
const PK_FIELD_KEYS = Object.freeze(FIELDS.filter(field => field.pk).map(field => field.key));

/* 名字 → 字段定义。先认标准写法，再认别名；两边都不中说明是没登记的新字段。 */
const NAME_INDEX = new Map();
for (const field of FIELDS) {
  NAME_INDEX.set(field.key, field);
  for (const alias of field.aliases || []) NAME_INDEX.set(alias, field);
}

function resolveField(name) {
  return NAME_INDEX.get(String(name == null ? '' : name).trim()) || null;
}

/* 值尾部已经写了的单位。只在字段本身有标准单位时才剥，避免把「1.5匹」的匹剥掉。 */
const TAIL_UNIT = /\s*(?:kg|KW|KW\/h|W\/h|W|mm|cm|m³\/h|m3\/h|dB\(A\)|dB|℃|°C|匹|㎡|m2)\s*$/i;

function formatValue(field, raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return '';
  const unit = field.unit || '';
  if (!unit) return text;
  const body = text.replace(TAIL_UNIT, '').trim() || text;
  /* 值本身就是「不支持 / 待核实」这类话的，后面挂个单位反而怪 */
  if (/^(支持|不支持|有|无|是|否|待核实|不详)$/.test(body)) return body;
  /* 噪音值常写成「18db-45db（超强风档）」—— 单位夹在句子中间，剥不掉就别再挂一个 */
  if (/dB/i.test(unit) && /d\s*b/i.test(body)) return body;
  return `${body} ${unit}`;
}

/**
 * 把一台机器的参数数组对齐到标准字段表。
 * 返回的每个 section 都铺满该段的全部字段：有值的带 value，没值的 missing=true。
 * 库里存在但字段表没登记的名字，收进末尾「未归类参数」段，绝不静默丢弃。
 */
function alignParams(params) {
  const list = Array.isArray(params) ? params : [];
  const byKey = new Map();
  const unknown = [];

  for (const item of list) {
    if (!item) continue;
    const field = resolveField(item.name);
    if (!field) {
      const name = String(item.name == null ? '' : item.name).trim();
      if (name) unknown.push(item);
      continue;
    }
    /* 同名字段重复出现时只认第一条：库里实测为 0 例，留个兜底防将来导入出岔子 */
    if (!byKey.has(field.key)) byKey.set(field.key, item);
  }

  const sections = SECTIONS.map(section => {
    const fields = FIELDS.filter(field => field.section === section.id);
    let filled = 0;
    let pkMissing = 0;
    const items = fields.map(field => {
      const hit = byKey.get(field.key);
      const hasValue = Boolean(hit && String(hit.value == null ? '' : hit.value).trim());
      if (hasValue) filled += 1;
      /* 影响 PK 出图又没值 —— 这一格要标「请尽快填写」，主管才知道该补哪几项 */
      const lacksPk = Boolean(field.pk) && !hasValue;
      if (lacksPk) pkMissing += 1;
      return {
        key: field.key,
        label: field.label || field.key,
        unit: field.unit || '',
        extra: Boolean(field.extra),
        pk: Boolean(field.pk),
        pkMissing: lacksPk,
        missing: !hasValue,
        value: hit && hit.value != null ? String(hit.value) : '',
        display: hasValue ? formatValue(field, hit.value) : MISSING_TEXT,
        needsReview: Boolean(hit && hit.needsReview),
        manual: Boolean(hit && hit.manual),
        evidence: hit && hit.evidence ? String(hit.evidence) : ''
      };
    });
    return { id: section.id, label: section.label, hint: section.hint, total: fields.length, filled, pkMissing, items };
  });

  if (unknown.length) {
    sections.push({
      id: 'unregistered',
      label: '未归类参数',
      hint: '库里存在但标准字段表还没登记，先原样显示，等确认后补进表里',
      total: unknown.length,
      filled: unknown.length,
      items: unknown.map(item => ({
        key: String(item.name || ''),
        label: String(item.name || '（未命名）'),
        unit: String(item.unit || ''),
        extra: false,
        pk: false,
        pkMissing: false,
        missing: false,
        value: String(item.value == null ? '' : item.value),
        display: [item.value, item.unit].filter(Boolean).join(' ') || '—',
        needsReview: Boolean(item.needsReview),
        manual: Boolean(item.manual),
        evidence: item.evidence ? String(item.evidence) : ''
      }))
    });
  }

  const total = FIELDS.length;
  const filled = sections
    .filter(section => section.id !== 'unregistered')
    .reduce((sum, section) => sum + section.filled, 0);
  const pkItems = sections
    .filter(section => section.id !== 'unregistered')
    .flatMap(section => section.items)
    .filter(item => item.pk);
  const pkMissingItems = pkItems.filter(item => item.pkMissing);

  return {
    total,
    filled,
    pending: total - filled,
    extraTotal: FIELDS.filter(field => field.extra).length,
    /* PK 作图涉及的字段：一共几项、还缺几项、缺的是哪几项（页面直接用这几项做提示条） */
    pkTotal: pkItems.length,
    pkMissing: pkMissingItems.length,
    pkMissingLabels: pkMissingItems.map(item => item.label),
    unregistered: unknown.map(item => String(item.name || '')).filter(Boolean),
    sections
  };
}

/* 给前端用的精简定义：只带渲染需要的，别名表也带上，前端不用自己维护一份。 */
function publicFields() {
  return FIELDS.map(field => ({
    key: field.key,
    label: field.label || field.key,
    section: field.section,
    unit: field.unit || '',
    extra: Boolean(field.extra),
    pk: Boolean(field.pk),
    aliases: field.aliases || []
  }));
}

module.exports = {
  SECTIONS,
  FIELDS,
  FIELD_KEYS,
  PK_FIELD_KEYS,
  MISSING_TEXT,
  PK_MISSING_TEXT,
  TIDY_FIELDS: FIELDS,
  resolveField,
  formatValue,
  alignParams,
  publicFields
};
