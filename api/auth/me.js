// 当前用户信息(校验 access token)。
const { apiHandler, requireMethod } = require('../../lib/http');
const { requireUser, AuthError } = require('../../lib/auth');
const {requireInventoryUser}=require('../../lib/inventory/access');
const { getUser, getTenant } = require('../../lib/db/queries');

module.exports = apiHandler(async (req, res) => {
    if (!requireMethod(req, res, 'GET')) return;
    const u = await requireInventoryUser(req);
    const user = await getUser(u.userId);
    const tenant = await getTenant(u.tenantId);
    if (!user) throw new AuthError('用户不存在', 404);
    return res.status(200).json({
        success: true,
        data: {
            user: { id: user.id, identifier: user.identifier, role: user.role },
            tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name } : null,
        },
    });
});
