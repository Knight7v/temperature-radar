// 鉴权层单元测试(无需 DB):密码哈希、JWT 签发/校验/防篡改、refresh token、requireUser。
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'unit-test-secret-at-least-16-chars-long';
const auth = require('../lib/auth');

test('密码:scrypt hash + 随机盐 + 校验', () => {
    const h = auth.hashPassword('correct horse');
    assert.ok(auth.verifyPassword('correct horse', h));
    assert.ok(!auth.verifyPassword('wrong', h));
    assert.ok(!auth.verifyPassword('correct horse', 'malformed'));
    assert.notEqual(h, auth.hashPassword('correct horse'), '盐应随机');
});

test('access JWT:签发/校验携带 sub/tenant_id/role', async () => {
    const tok = await auth.signAccessToken({ id: 'u1', tenantId: 't-A', role: 'admin' });
    const p = await auth.verifyAccessToken(tok);
    assert.equal(p.sub, 'u1');
    assert.equal(p.tenant_id, 't-A');
    assert.equal(p.role, 'admin');
    assert.ok(p.exp > p.iat);
});

test('JWT:篡改被拒 / 错误密钥被拒', async () => {
    const tok = await auth.signAccessToken({ id: 'u1', tenantId: 't', role: 'viewer' });
    await assert.rejects(() => auth.verifyAccessToken(tok + 'x'));
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'another-secret-also-long-enough';
    await assert.rejects(() => auth.verifyAccessToken(tok));
    process.env.JWT_SECRET = prev;
});

test('refresh token:随机且 hash ≠ 原文', () => {
    const a = auth.generateRefreshToken();
    const b = auth.generateRefreshToken();
    assert.notEqual(a, b);
    assert.notEqual(auth.hashRefreshToken(a), a);
    assert.equal(auth.hashRefreshToken(a), auth.hashRefreshToken(a), '同输入 hash 稳定');
});

test('refreshExpiry:约 7 天后', () => {
    const e = auth.refreshExpiry();
    const diffDays = (e.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(diffDays > 6.9 && diffDays < 7.1);
});

test('requireUser:无 header 拒绝;有效 Bearer 返回上下文;无效拒绝', async () => {
    await assert.rejects(() => auth.requireUser({ headers: {} }), /Bearer/i);
    const tok = await auth.signAccessToken({ id: 'u9', tenantId: 't9', role: 'operator' });
    const ctx = await auth.requireUser({ headers: { authorization: `Bearer ${tok}` } });
    assert.equal(ctx.userId, 'u9');
    assert.equal(ctx.tenantId, 't9');
    assert.equal(ctx.role, 'operator');
    await assert.rejects(() => auth.requireUser({ headers: { authorization: 'Bearer not-a-jwt' } }));
});
