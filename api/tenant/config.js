// 租户配置端点(GET,需 access token)。返回该租户的城市集 + 模型配置 + 推送配置。
// 查询在 lib/db/queries.getTenantConfig 内强制按 tenant_id 过滤 —— P0 的隔离保证。
// 前端在 P1 才消费它;P0 用它证明端到端租户隔离(两租户返回各自不同数据)。
const { apiHandler, requireMethod } = require('../../lib/http');
const { requireUser } = require('../../lib/auth');
const { getTenantConfig } = require('../../lib/db/queries');

module.exports = apiHandler(async (req, res) => {
    if (!requireMethod(req, res, 'GET')) return;
    const u = await requireUser(req);
    const config = await getTenantConfig(u.tenantId);
    return res.status(200).json({
        success: true,
        data: { tenantId: u.tenantId, ...config },
    });
});
