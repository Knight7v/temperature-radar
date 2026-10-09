// 真鉴权:HS256 签名的 access JWT(opaque refresh token 轮换,存 sessions 表)。
// 替换 2026-08-06 删除的假 JWT(字面量 'secret'、不校验签名)。
const { SignJWT, jwtVerify } = require('jose');
const { scryptSync, randomBytes, createHash, timingSafeEqual } = require('node:crypto');

const ACCESS_TTL_SEC = 15 * 60;          // access 15 分钟
const REFRESH_TTL_DAYS = 7;              // refresh 7 天
const SCRYPT_KEYLEN = 64;

function getSecret() {
    const s = process.env.JWT_SECRET;
    if (!s || s.length < 16) throw new Error('JWT_SECRET 未配置或过短(需 ≥16 字符)');
    return new TextEncoder().encode(s);
}

// ---------- 密码(node:crypto scrypt,无需 bcrypt 原生依赖) ----------
function hashPassword(plain) {
    const salt = randomBytes(16);
    const hash = scryptSync(plain, salt, SCRYPT_KEYLEN);
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function verifyPassword(plain, stored) {
    const [saltHex, hashHex] = String(stored || '').split(':');
    if (!saltHex || !hashHex) return false;
    try {
        const salt = Buffer.from(saltHex, 'hex');
        const hash = Buffer.from(hashHex, 'hex');
        const test = scryptSync(plain, salt, hash.length);
        return hash.length === test.length && timingSafeEqual(hash, test);
    } catch {
        return false;
    }
}

// ---------- access JWT ----------
async function signAccessToken(user) {
    return new SignJWT({ tenant_id: user.tenantId, role: user.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TTL_SEC}s`)
        .sign(getSecret());
}
async function verifyAccessToken(token) {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    return payload; // { sub, tenant_id, role, iat, exp }
}

// ---------- opaque refresh token ----------
function generateRefreshToken() {
    return randomBytes(48).toString('base64url');
}
function hashRefreshToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
function refreshExpiry() {
    return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ---------- 请求工具 ----------
function getBearerToken(req) {
    const h = req.headers && (req.headers.authorization || req.headers.Authorization);
    if (!h || !h.toLowerCase().startsWith('bearer ')) return null;
    return h.slice(7).trim();
}

/** 从请求解析已校验的 access token,返回用户上下文;失败抛错。 */
async function requireUser(req) {
    const token = getBearerToken(req);
    if (!token) throw new AuthError('缺少 Bearer token', 401);
    let payload;
    try { payload = await verifyAccessToken(token); } catch (e) {
        if (String(e.code || '').startsWith('ERR_J')) throw new AuthError('登录已失效，请重新登录', 401);
        throw e;
    }
    return { userId: payload.sub, tenantId: payload.tenant_id, role: payload.role };
}

class AuthError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

module.exports = {
    ACCESS_TTL_SEC, REFRESH_TTL_DAYS,
    hashPassword, verifyPassword,
    signAccessToken, verifyAccessToken,
    generateRefreshToken, hashRefreshToken, refreshExpiry,
    getBearerToken, requireUser,
    AuthError,
};
