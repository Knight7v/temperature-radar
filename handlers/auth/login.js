// 登录:按租户 slug + 账号 + 密码,校验后签发 token。
const { apiHandler, requireMethod } = require('../../lib/http');
const { verifyPassword, signAccessToken, generateRefreshToken, hashRefreshToken, refreshExpiry, ACCESS_TTL_SEC, AuthError } = require('../../lib/auth');
const { findTenantBySlug, findUserByTenantIdentifier, createSession } = require('../../lib/db/queries');
const { getInventoryPool } = require('../../lib/db/inventory-client');
const Audit = require('../../lib/audit');

/* 登录留痕用：取真实 IP（过 Cloudflare 隧道时看 x-forwarded-for 第一跳）+ 设备/浏览器简述 */
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '');
  const first = xf.split(',')[0].trim();
  return first || (req.socket && req.socket.remoteAddress) || '';
}
function deviceName(ua) {
  const s = String(ua || '');
  const os = /Windows/i.test(s) ? 'Windows' : /Macintosh|Mac OS/i.test(s) ? 'Mac' : /Android/i.test(s) ? 'Android' : /iPhone|iPad|iOS/i.test(s) ? 'iPhone/iPad' : '其他设备';
  const br = /Edg\//.test(s) ? 'Edge' : /MicroMessenger/i.test(s) ? '微信内置' : /Chrome\//i.test(s) ? 'Chrome' : /Firefox\//i.test(s) ? 'Firefox' : /Safari\//i.test(s) ? 'Safari' : '浏览器';
  return os + ' · ' + br;
}

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

    /* 登录成功留痕（P1-4）：失败只吞错，绝不连累登录本身 */
    try {
      const db = getInventoryPool();
      await Audit.ensureAuditSchema(db);
      await Audit.logAudit(db, {
        tenantId: tenant.id, user: { userId: user.id, role: user.role },
        action: 'auth.login', targetType: 'user', targetId: user.id, targetLabel: user.identifier,
        detail: { ip: clientIp(req), browser: deviceName(req.headers['user-agent']) }
      });
    } catch (error) {
      console.error('登录留痕失败:', error.message || error);
    }

    return res.status(200).json({
        success: true,
        data: {
            user: { id: user.id, identifier: user.identifier, role: user.role },
            tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
            accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC,
        },
    });
});
