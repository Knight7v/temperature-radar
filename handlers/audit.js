'use strict';
/* 操作日志查询接口（P2，仅 admin）：
 *   GET ?action=list&actionType=&q=&from=&to=&limit=&offset=
 */
const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
const { getInventoryPool } = require('../lib/db/inventory-client');
const Audit = require('../lib/audit');

module.exports = apiHandler(async (req, res) => {
  if (req.method !== 'GET') throw Object.assign(Error('不支持此请求'), { status: 405 });
  const db = getInventoryPool();
  await Audit.ensureAuditSchema(db);

  /* action=mine：任何登录角色可看「自己最近 10 次登录」（账号安全页用），看不到别人的 */
  if (String(req.query.action || '') === 'mine') {
    const self = await requireInventoryUser(req, ['admin', 'operator', 'supply_chain', 'viewer']);
    const rows = await Audit.listAuditLogs(db, self.tenantId, { actorId: self.userId, action: 'auth.login', limit: 10 });
    return res.json({ data: { rows } });
  }

  const user = await requireInventoryUser(req, ['admin']);
  const rows = await Audit.listAuditLogs(db, user.tenantId, {
    action: String(req.query.actionType || '').trim() || null,
    q: String(req.query.q || '').trim() || null,
    from: String(req.query.from || '').trim() || null,
    to: String(req.query.to || '').trim() || null,
    limit: Number(req.query.limit) || 100
  });
  return res.json({ data: { rows } });
});
