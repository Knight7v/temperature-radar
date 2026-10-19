// 登录:按租户 slug + 账号 + 密码,校验后签发 token。
const { apiHandler, requireMethod } = require('../../lib/http');
const { verifyPassword, signAccessToken, generateRefreshToken, hashRefreshToken, refreshExpiry, ACCESS_TTL_SEC, AuthError } = require('../../lib/auth');
const { findTenantBySlug, findUserByTenantIdentifier, createSession } = require('../../lib/db/queries');

module.exports = apiHandler(async (req, res) => {
    if (!requireMethod(req, res, 'POST')) return;

    const { slug, identifier, password } = req.body || {};
    if (!slug || !identifier || !password) {
        throw new AuthError('缺少必填字段(slug/identifier/password)', 400);
    }

    const tenant = await findTenantBySlug(slug);
    // 统一返回"凭据错误",避免租户枚举
    if (!tenant || tenant.status !== 'active') throw new AuthError('凭据错误', 401);

    const user = await findUserByTenantIdentifier(tenant.id, identifier);
    if (!user || user.status !== 'active' || !verifyPassword(password, user.passwordHash)) {
        throw new AuthError('凭据错误', 401);
    }

    const refreshToken = generateRefreshToken();
    await createSession({ userId: user.id, refreshHash: hashRefreshToken(refreshToken), expiresAt: refreshExpiry() });
    const accessToken = await signAccessToken({ id: user.id, tenantId: tenant.id, role: user.role });

    return res.status(200).json({
        success: true,
        data: {
            user: { id: user.id, identifier: user.identifier, role: user.role },
            tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
            accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC,
        },
    });
});
