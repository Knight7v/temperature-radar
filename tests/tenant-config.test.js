// /api/tenant/config 端点测试。
// - 无 token → 401:无需 DB,始终运行。
// - 有 token → 200 + 租户配置:需 DB(DATABASE_URL),未配置时 skip。
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'tenant-config-test-secret-16+';
const auth = require('../lib/auth');
const handler = require('../handlers/tenant/config');

const dbTest = process.env.DATABASE_URL ? test : test.skip;

function callHandler(req) {
    return new Promise((resolve) => {
        const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve({ status: this.statusCode, body: b }); } };
        handler(req, res);
    });
}

test('GET /api/tenant/config 无 Authorization → 401', async () => {
    const { status, body } = await callHandler({ method: 'GET', headers: {} });
    assert.equal(status, 401);
    assert.ok(body.error);
});

test('GET /api/tenant/config 错误方法 → 405', async () => {
    const { status } = await callHandler({ method: 'POST', headers: {} });
    assert.equal(status, 405);
});

dbTest('GET /api/tenant/config 有效 token → 200 + 该租户配置', async () => {
    const { createUser, getTenant } = require('../lib/db/queries');
    const { getDb } = require('../lib/db/client');
    const schema = require('../lib/db/schema');
    const { eq } = require('drizzle-orm');
    const stamp = Date.now().toString(36);
    const db = getDb();
    const tenant = (await db.insert(schema.tenants).values({ name: `cfg_${stamp}`, slug: `cfg_${stamp}` }).returning())[0];
    try {
        const tok = await auth.signAccessToken({ id: 'fake-user', tenantId: tenant.id, role: 'operator' });
        const { status, body } = await callHandler({ method: 'GET', headers: { authorization: `Bearer ${tok}` } });
        assert.equal(status, 200);
        assert.equal(body.data.tenantId, tenant.id);
        assert.ok(Array.isArray(body.data.cities));
    } finally {
        await db.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id));
    }
});
