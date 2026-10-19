// 刷新:用 refresh token 换新的 access + refresh(轮换 + 旧 token 失效)。
const { apiHandler, requireMethod } = require('../../lib/http');
const { signAccessToken, generateRefreshToken, hashRefreshToken, refreshExpiry, ACCESS_TTL_SEC, AuthError } = require('../../lib/auth');
const { findSessionByRefreshHash, deleteSession, getUser, createSession } = require('../../lib/db/queries');

module.exports = apiHandler(async (req, res) => {
    if (!requireMethod(req, res, 'POST')) return;

    const { refreshToken } = req.body || {};
    if (!refreshToken) throw new AuthError('缺少 refreshToken', 400);

    const hash = hashRefreshToken(refreshToken);
    const session = await findSessionByRefreshHash(hash);
    if (!session || new Date(session.expiresAt) < new Date()) {
        throw new AuthError('refresh token 无效或已过期', 401);
    }

    const user = await getUser(session.userId);
    if (!user || user.status !== 'active') throw new AuthError('用户不可用', 401);

    // 轮换:删除旧 session,建新 session
    await deleteSession(session.id);
    const newRefresh = generateRefreshToken();
    await createSession({ userId: user.id, refreshHash: hashRefreshToken(newRefresh), expiresAt: refreshExpiry() });
    const accessToken = await signAccessToken({ id: user.id, tenantId: user.tenantId, role: user.role });

    return res.status(200).json({
        success: true,
        data: { accessToken, refreshToken: newRefresh, expiresIn: ACCESS_TTL_SEC },
    });
});
