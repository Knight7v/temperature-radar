// 租户隔离集成测试:验证 A 的 getTenantConfig 看不到 B 的数据(应用层 WHERE tenant_id)。
// 需真实 Postgres(DATABASE_URL);未配置时整体 skip,开通 Neon 后自动启用。
const test = require('node:test');
const assert = require('node:assert/strict');
const { eq } = require('drizzle-orm');
const { getDb } = require('../lib/db/client');
const schema = require('../lib/db/schema');
const queries = require('../lib/db/queries');

const dbTest = process.env.DATABASE_URL ? test : test.skip;
const stamp = Date.now().toString(36);

async function makeTenant(slug, cityName) {
    const db = getDb();
    const tenant = (await db.insert(schema.tenants).values({ name: slug, slug }).returning())[0];
    const city = (await db.insert(schema.citiesCatalog)
        .values({ name: cityName, lat: 30, lng: 120, province: '测试', region: '测试' }).returning())[0];
    await db.insert(schema.tenantCities).values({
        tenantId: tenant.id, cityId: city.id, households: 1000, acPenetration: 0.5, income: 50000,
    });
    await db.insert(schema.salesRecords).values({
        tenantId: tenant.id, cityId: city.id, date: '2026-08-07', units: 42,
    });
    return { tenant, city };
}

async function cleanup(ids) {
    const db = getDb();
    for (const { tenant, city } of ids) {
        if (tenant) await db.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id)); // cascade 清租户表
        if (city) await db.delete(schema.citiesCatalog).where(eq(schema.citiesCatalog.id, city.id));
    }
}

dbTest('A 的配置只含 A 的城市,B 的不可见(反之亦然)', async () => {
    const ids = [];
    try {
        const a = await makeTenant(`iso_a_${stamp}`, `ISO_A_${stamp}`);
        const b = await makeTenant(`iso_b_${stamp}`, `ISO_B_${stamp}`);
        ids.push(a, b);

        const cfgA = await queries.getTenantConfig(a.tenant.id);
        const cfgB = await queries.getTenantConfig(b.tenant.id);

        assert.equal(cfgA.cities.length, 1);
        assert.equal(cfgA.cities[0].name, a.city.name);
        assert.equal(cfgB.cities.length, 1);
        assert.equal(cfgB.cities[0].name, b.city.name);

        // A 的城市名集合绝不包含 B 的城市
        const aNames = cfgA.cities.map((c) => c.name);
        assert.ok(!aNames.includes(b.city.name), 'A 不应看到 B 的城市');
    } finally {
        await cleanup(ids);
    }
});
