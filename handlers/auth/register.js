// 注册:创建新租户 + 管理员,签发 token。P0 每次注册 = 一个新租户。
const { apiHandler, requireMethod } = require('../../lib/http');
const { hashPassword, signAccessToken, generateRefreshToken, hashRefreshToken, refreshExpiry, ACCESS_TTL_SEC, AuthError } = require('../../lib/auth');
const { createTenant, createUser, createSession, findTenantBySlug } = require('../../lib/db/queries');

module.exports = apiHandler(async (req, res) => {
    if (!requireMethod(req, res, 'POST')) return;

    const { tenantName, slug, identifier, password } = req.body || {};
    if (!tenantName || !slug || !identifier || !password) {
        throw new AuthError('缺少必填字段(tenantName/slug/identifier/password)', 400);
    }
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) {
        throw new AuthError('slug 仅允许小写字母、数字、连字符(2-31 位)', 400);
    }
    if (String(password).length < 8) {
        throw new AuthError('密码至少 8 位', 400);
    }

    if (await findTenantBySlug(slug)) {
        throw new AuthError('该租户标识已被占用', 409);
    }

    const tenant = await createTenant({ name: tenantName, slug });
    const user = await createUser({
        tenantId: tenant.id,
        identifier,
        passwordHash: hashPassword(password),
        role: 'admin',
    });

    const refreshToken = generateRefreshToken();
    await createSession({ userId: user.id, refreshHash: hashRefreshToken(refreshToken), expiresAt: refreshExpiry() });
    const accessToken = await signAccessToken(user);

    return res.status(201).json({
        success: true,
        data: {
            user: { id: user.id, identifier: user.identifier, role: user.role },
            tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
            accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC,
        },
    });
});
