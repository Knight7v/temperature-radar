'use strict';

// 客服档案的业务规则：字段口径、必填校验、从昵称反推店铺与岗位。
// 纯函数都放在这里（不碰数据库），便于单测；建表与查询在 handlers/service-agents.js。

const fs = require('node:fs');
const path = require('node:path');
const { getInventoryPool } = require('../db/inventory-client');

const STATUSES = Object.freeze(['在职', '离职']);
const ROLES = Object.freeze(['售前', '售后', '客服主管', '其他']);
const BRAND_GROUPS = Object.freeze(['格力', '海尔', '美的', '华凌', 'TCL', '其他']);

const LIMITS = Object.freeze({
  agentName: 40,
  employeeName: 30,
  shop: 60,
  shopId: 40,
  brandGroup: 20,
  role: 20,
  status: 10,
  joinDate: 10,
  note: 200
});

/* 机器人不算人：京东的叫京小智，账号形如 jimi_vender_22950829。
   档案里给它建档只会污染「人均会话数」这类口径，所以带入时直接跳过。 */
const ROBOT_PATTERN = /^(京小智|京东小智|智能客服|机器人|小智|店小蜜)$|^jimi[_-]/i;

function isRobot(agentName) {
  return ROBOT_PATTERN.test(String(agentName || '').trim());
}

function clean(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

function fail(message) {
  throw Object.assign(Error(message), { status: 422 });
}

function normalize(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    agentName: clean(source.agentName),
    employeeName: clean(source.employeeName),
    shop: clean(source.shop),
    shopId: clean(source.shopId),
    brandGroup: clean(source.brandGroup),
    role: clean(source.role),
    status: clean(source.status) || '在职',
    joinDate: clean(source.joinDate),
    note: clean(source.note)
  };
}

function validate(data) {
  if (!data.agentName) fail('客服名称必填——就是聊天记录里显示的那个名字');
  for (const [key, max] of Object.entries(LIMITS)) {
    if (String(data[key] || '').length > max) fail(`${key} 超过 ${max} 个字符`);
  }
  if (isRobot(data.agentName)) fail('「' + data.agentName + '」是平台机器人，不用建档');
  if (data.status && !STATUSES.includes(data.status)) fail('状态只能是：' + STATUSES.join(' / '));
  if (data.role && !ROLES.includes(data.role)) fail('岗位只能是：' + ROLES.join(' / '));
  if (data.brandGroup && !BRAND_GROUPS.includes(data.brandGroup)) fail('品牌组别只能是：' + BRAND_GROUPS.join(' / '));
  if (data.joinDate && !/^20\d{2}-\d{2}-\d{2}$/.test(data.joinDate)) fail('入职日期格式应为 YYYY-MM-DD');
  if (data.joinDate && Number.isNaN(Date.parse(data.joinDate + 'T00:00:00Z'))) fail('入职日期不存在');
  return data;
}

/* 从昵称反推店铺与岗位。
   昵称是「店铺名 + 岗位 + 昵称」拼出来的（如 格力旗舰店售前-阿伟、格力旗舰店售后-鹿鹿），
   取最长匹配，避免「格力旗舰店」把「格力空调换新旗舰店售前-小星」抢走。 */
function inferProfile(agentName, shops) {
  const name = clean(agentName);
  const list = (Array.isArray(shops) ? shops : []).filter(item => item && item.name);
  const hit = list
    .filter(item => name.startsWith(item.name) || name.includes(item.name))
    .sort((a, b) => b.name.length - a.name.length)[0] || null;
  const role = /售后/.test(name) ? '售后' : /售前/.test(name) ? '售前' : /主管/.test(name) ? '客服主管' : '';
  return {
    shop: hit ? hit.name : '',
    shopId: hit ? String(hit.id || '') : '',
    brandGroup: hit && hit.brand ? hit.brand : '',
    role
  };
}

function key(name) {
  return String(name || '').trim().toLowerCase();
}

/* 把质检会话统计贴到档案上；同时找出「质检里有、档案里没有」的昵称。 */
function mergeStats(agents, statRows) {
  const stats = new Map();
  for (const row of Array.isArray(statRows) ? statRows : []) {
    stats.set(key(row.agent), {
      agent: row.agent,
      sessions: Number(row.sessions || 0),
      analyzed: Number(row.analyzed || 0),
      avgScore: row.avg_score == null ? null : Math.round(Number(row.avg_score) * 10) / 10,
      lastAt: row.last_at || null
    });
  }
  const rows = (Array.isArray(agents) ? agents : []).map(agent => {
    const stat = stats.get(key(agent.data && agent.data.agentName)) || null;
    return { ...agent, stat };
  });
  const known = new Set(rows.map(row => key(row.data && row.data.agentName)));
  const orphans = [...stats.values()]
    .filter(item => !known.has(key(item.agent)) && !isRobot(item.agent))
    .sort((a, b) => b.sessions - a.sessions);
  return { rows, orphans };
}

function summarize(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const active = list.filter(row => (row.data.status || '在职') === '在职');
  const missing = list.filter(row => !row.data.employeeName || !row.data.shop || !row.data.brandGroup);
  return {
    total: list.length,
    active: active.length,
    left: list.length - active.length,
    missing: missing.length,
    withEmployee: list.filter(row => row.data.employeeName).length
  };
}

let ready;
/* 建表只跑一次；迁移文件即建表语句，避免再出现「journal 没登记、要手动 psql」的老问题。 */
function ensureServiceAgentSchema() {
  if (!ready) {
    ready = getInventoryPool()
      .query(fs.readFileSync(path.join(__dirname, '../db/migrations/0012_service_agents.sql'), 'utf8'))
      .catch(error => {
        ready = null;
        throw error;
      });
  }
  return ready;
}

module.exports = {
  STATUSES,
  ROLES,
  BRAND_GROUPS,
  LIMITS,
  isRobot,
  normalize,
  validate,
  inferProfile,
  mergeStats,
  summarize,
  ensureServiceAgentSchema,
  key
};
