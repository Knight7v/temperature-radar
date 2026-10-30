'use strict';
/* 机型性能PK —— 从产品知识库条目提取对比字段 + 推荐理由起草。
   单一事实来源：pk.html 的接口 action=pk-fields 走这里，测试也直接测这里。
   原则：知识库里没有的字段一律返回「—」，不编造数字。 */

const MISSING = '—';

function paramOf(data, names) {
  const params = Array.isArray(data && data.params) ? data.params : [];
  for (const target of names) {
    const hit = params.find(p => p && String(p.name || '').trim() === target);
    if (!hit) continue;
    const value = String(hit.value == null ? '' : hit.value).trim();
    if (value && value !== '无') return value;
  }
  return MISSING;
}

function toNumber(value) {
  const m = String(value == null ? '' : value).match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/* 推荐理由：确定性规则起草（5~15 字），员工可在页面上改 */
function draftReason(data, fields) {
  const f = fields || extractPkFields(data);
  const params = Array.isArray(data && data.params) ? data.params : [];
  const has = name => params.some(p => p && String(p.name || '').trim() === name && String(p.value || '').trim() === '支持');
  if (has('冷酷外机')) return '冷酷外机 更耐候';
  if (/双排/.test(f.copper)) return '双排铜管 硬核高配';
  const apf = toNumber(f.apf);
  if (apf != null && apf >= 5.3) return '高能效 省电之选';
  const air = toNumber(f.air);
  if (air != null && air >= 800) return '大风量 更舒适';
  if (f.apf !== MISSING) return '高效节能 品质之选';
  return '入门实惠 品质之选';
}

function extractPkFields(data) {
  const src = data || {};
  const apf = paramOf(src, ['APF 能效比', 'APF能效比', 'APF']);
  const air = paramOf(src, ['循环风量']);
  const copper = paramOf(src, ['铜管排数']);
  const temp = paramOf(src, ['外机运行温度']);
  const clean = paramOf(src, ['清洁方式']);
  /* 「WiFi 智控：无」是真的没有，不能当成「有值」——参数表里这一格常写「无 / 不支持」 */
  const wifiValue = (() => {
    const params = Array.isArray(src.params) ? src.params : [];
    const hit = params.find(p => p && String(p.name || '').trim() === 'WiFi 智控');
    const value = hit ? String(hit.value || '').trim() : '';
    return /^(无|没有|不支持|否|none|n\/a|-|—|\/)$/i.test(value) ? '' : value;
  })();
  const ctrl = (() => {
    /* 实际取值是「格力+APP」「格力+APP/京东小家/天猫精灵语音」这类，不是「支持」：
       只要写了 WiFi 智控，就是能连 App 的机器 → 遥控 / App */
    return wifiValue ? '遥控 / App' : MISSING;
  })();
  /* 模板二（选购指南）的控制方式：展示真实平台名，「格力+APP/京东小家/天猫精灵语音」→「遥控、格力+、京东小家、天猫精灵语音」 */
  const ctrlText = (() => {
    const value = wifiValue;
    if (!value) return MISSING;
    const parts = value.split(/[\/、,，]/).map(s => s.replace(/APP|app/g, '').trim()).filter(Boolean);
    return ['遥控', ...parts].join('、');
  })();
  const fields = {
    reason: MISSING,
    apf,
    air,
    copper,
    eco: MISSING,
    temp,
    clean,
    ctrl,
    ctrlText,
    kwh: MISSING,
    /* 模板二（选购指南）新增行 */
    vane: paramOf(src, ['导风板']),
    swing: paramOf(src, ['送风模式', '送风角度', '扫风模式']),
    tempctl: paramOf(src, ['温度调节']),
    sleep: paramOf(src, ['睡眠模式']),
    light: paramOf(src, ['智能光敏', '光敏传感'])
  };
  fields.reason = draftReason(src, fields);
  return fields;
}

/* PK 海报的行顺序（与底图行名一致） */
const PK_ROWS = [
  { key: 'reason', label: '推荐理由' },
  { key: 'apf', label: 'APF值' },
  { key: 'air', label: '循环风量' },
  { key: 'copper', label: '铜管排数' },
  { key: 'eco', label: '节能模式' },
  { key: 'temp', label: '运行温度' },
  { key: 'clean', label: '清洁方式' },
  { key: 'ctrl', label: '控制方式' },
  { key: 'kwh', label: '电量查询' }
];

/* 机型结构：挂机跟挂机比、柜机跟柜机比，不许混。
   优先看名称（最可靠），再认型号编码：GW/G=挂机，LW/L=柜机；认不出的返回空串。 */
function machineType(data) {
  const src = data || {};
  const text = String(src.name || '') + String(src.series || '');
  if (/挂机|壁挂/.test(text)) return '挂机';
  if (/柜机|立柜/.test(text)) return '柜机';
  const model = String(src.model || '').toUpperCase();
  if (/GW/.test(model) || /\dG/.test(model)) return '挂机';
  if (/LW/.test(model) || /\dL/.test(model)) return '柜机';
  return '';
}

/* 模板二（选购指南）行顺序：机型(产品图)/型号两行由页面单独画 */
const PK_ROWS2 = [
  { key: 'reason', label: '推荐理由' },
  { key: 'apf', label: 'APF值' },
  { key: 'temp', label: '外机运行温度' },
  { key: 'vane', label: '导风板类型' },
  { key: 'clean', label: '清洁方式' },
  { key: 'air', label: '循环风量' },
  { key: 'swing', label: '送风模式' },
  { key: 'ctrlText', label: '控制方式' },
  { key: 'tempctl', label: '温度控制' },
  { key: 'sleep', label: '睡眠模式' },
  { key: 'light', label: '光敏传感' }
];

module.exports = { extractPkFields, draftReason, paramOf, toNumber, machineType, PK_ROWS, PK_ROWS2, MISSING };
