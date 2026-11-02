'use strict';
/* 操作日志（P2）：关键写操作留痕 + 查询。
 * 铁律：logAudit 自己吞错——日志失败绝不能连累业务操作本身。
 * 纯函数 + db 参数注入，方便 node --test 直接测。
 */
const fs = require('node:fs');
const path = require('node:path');
const { DICTIONARY } = require('./dictionary');

let ready;
function ensureAuditSchema(db) {
  if (!ready) ready = (db || getPool()).query(fs.readFileSync(path.join(__dirname, 'db/migrations/0018_audit_logs.sql'), 'utf8')).catch(error => { ready = null; throw error; });
  return ready;
}
/* 延迟取池子：直接 require db 客户端会把连接池提前建出来，测试（env -u DATABASE_URL）会被卡 */
let poolRef = null;
function getPool() {
  if (!poolRef) poolRef = require('./db/inventory-client').getInventoryPool();
  return poolRef;
}

/* 写一条日志。user = requireInventoryUser 的返回（userId/role）；操作人姓名现查（没有就记「未知」） */
async function logAudit(db, { tenantId, user, action, targetType, targetId, targetLabel, detail }) {
  try {
    if (!tenantId || !action) throw Error('audit: tenantId/action 必填');
    if (!DICTIONARY.auditActions[action]) throw Error('audit: 未知动作 ' + action + '（请先在数据字典登记）');
    let actorName = '未知';
    if (user && user.userId) {
      const row = (await db.query('SELECT display_name,identifier FROM users WHERE id=$1', [user.userId])).rows[0];
      if (row) actorName = row.display_name || row.identifier || actorName;
    }
    await db.query(
      'INSERT INTO audit_logs(tenant_id,actor_id,actor_name,role,action,target_type,target_id,target_label,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tenantId, (user && user.userId) || null, actorName, (user && user.role) || null,
        action, targetType || null, targetId ? String(targetId) : null,
        targetLabel ? String(targetLabel).slice(0, 200) : null, detail ? JSON.stringify(detail) : null]
    );
  } catch (error) {
    console.error('操作日志记录失败:', error.message || error);
  }
}

/* 查询。filters: {action, q, from, to, limit, offset} */
async function listAuditLogs(db, tenant, filters = {}) {
  const args = [tenant];
  const where = ['tenant_id=$1'];
  if (filters.action) { args.push(String(filters.action)); where.push('action=$' + args.length); }
  if (filters.actorId) { args.push(String(filters.actorId)); where.push('actor_id=$' + args.length); }
  if (filters.q) {
    args.push('%' + String(filters.q).slice(0, 100) + '%');
    where.push(`(actor_name ILIKE $${args.length} OR target_label ILIKE $${args.length} OR detail::text ILIKE $${args.length})`);
  }
  if (filters.from) { args.push(String(filters.from)); where.push(`created_at >= $${args.length}::timestamptz`); }
  if (filters.to) { args.push(String(filters.to) + ' 23:59:59+08'); where.push(`created_at <= $${args.length}::timestamptz`); }
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  args.push(limit);
  const rows = (await db.query(
    'SELECT id,actor_name,role,action,target_type,target_id,target_label,detail,created_at AS "createdAt" FROM audit_logs WHERE ' + where.join(' AND ') + ' ORDER BY created_at DESC LIMIT $' + args.length,
    args
  )).rows;
  return rows;
}

/* 把 detail 翻成一句大白话（前端也有同款，js/audit-ui.js；服务端侧仅用于测试对齐） */
function describeDetail(action, detail) {
  const d = detail || {};
  switch (action) {
    case 'sales.import':
      return `新增 ${d.added ?? 0} 行 / 覆盖 ${d.changed ?? 0} 行 · ${d.start || '?'} ~ ${d.end || '?'}`;
    case 'target.year':
      return `年度合计 ${(d.annual == null ? '已清空' : '¥' + (d.annual / 100).toLocaleString('zh-CN'))} · 已填 ${d.months ?? 0}/12 个月`;
    case 'target.update':
      return `目标金额 ¥${d.yuan == null ? '?' : Number(d.yuan).toLocaleString('zh-CN')}`;
    case 'quality.review':
      return `AI 分 ${d.aiScore ?? '?'} → 复核后 ${d.finalScore ?? '?'} · 改判 ${d.overrides ?? 0} 项${d.note ? ' · 备注：' + d.note : ''}`;
    case 'user.create':
      return `账号 ${d.identifier || '?'} · 角色 ${d.role || '?'}`;
    case 'user.update':
      return [d.role ? '角色→' + d.role : '', d.status ? '状态→' + (d.status === 'active' ? '启用' : '停用') : '', d.displayName ? '姓名→' + d.displayName : ''].filter(Boolean).join('，') || '无字段变化';
    case 'agent.import':
      return `带入建档 ${d.created ?? 0} 人，跳过 ${d.skipped ?? 0} 人`;
    case 'auth.login':
      return `IP ${d.ip || '未知'}${d.browser ? ' · ' + d.browser : ''}`;
    default: {
      const parts = Object.entries(d).filter(([, v]) => v != null && v !== '');
      return parts.length ? parts.map(([k, v]) => k + '：' + v).join('，') : '';
    }
  }
}

module.exports = { ensureAuditSchema, logAudit, listAuditLogs, describeDetail };
