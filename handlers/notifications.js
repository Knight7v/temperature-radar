'use strict';
/* 通知中心接口（P1）：
 *   GET  ?action=list            → 当前待办 + 本人已读键（任何登录角色可见）
 *   POST ?action=read    {key}   → 标记单条已读
 *   POST ?action=readAll {keys}  → 批量已读
 *   GET  ?action=tasks           → 定时任务看板（仅 admin）
 */
const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
const { getInventoryPool } = require('../lib/db/inventory-client');
const Notif = require('../lib/notifications');

const fail = (message, status = 422) => { throw Object.assign(Error(message), { status }); };

module.exports = apiHandler(async (req, res) => {
  const action = String(req.query.action || 'list');
  const db = getInventoryPool();
  await Notif.ensureNotifSchema(db);

  if (action === 'tasks') {
    const user = await requireInventoryUser(req, ['admin']);
    const tasks = await Notif.listTasks(db, user.tenantId);
    return res.json({ data: { tasks } });
  }

  const user = await requireInventoryUser(req, ['admin', 'operator', 'viewer']);
  const tenant = user.tenantId;

  if (action === 'list') {
    const alerts = await Notif.buildAlerts(db, tenant);
    const reads = (await db.query(
      'SELECT alert_key FROM notification_reads WHERE tenant_id=$1 AND user_id=$2',
      [tenant, user.userId]
    )).rows.map(r => r.alert_key);
    const readSet = new Set(reads);
    const unread = alerts.filter(a => !readSet.has(a.key)).length;
    return res.json({ data: { alerts, readKeys: reads, unread } });
  }

  if (req.method !== 'POST') fail('不支持此请求', 405);

  if (action === 'read' || action === 'readAll') {
    const body = req.body || {};
    const keys = action === 'read' ? [String(body.key || '').trim()] : (Array.isArray(body.keys) ? body.keys.map(String) : []);
    const valid = keys.filter(k => k && k.length <= 200);
    if (!valid.length) fail('缺少要已读的通知');
    for (const key of valid) {
      await db.query(
        'INSERT INTO notification_reads(tenant_id,user_id,alert_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [tenant, user.userId, key]
      );
    }
    return res.json({ data: { ok: true, read: valid.length } });
  }

  fail('操作不存在', 404);
});
