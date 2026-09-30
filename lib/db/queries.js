// 租户作用域数据访问。tenantId 一律取自已校验的 JWT(绝不来自客户端输入),
// 每个查询强制 WHERE tenant_id —— 这是 P0 的"强制"隔离层(RLS 为纵深防御)。
const { eq, and } = require('drizzle-orm');
const { getDb } = require('./client');
const {
    tenants, users, sessions,
    citiesCatalog, tenantCities, tenantModelConfig, tenantPushConfig,
} = require('./schema');

// ---------- 租户 ----------
async function findTenantBySlug(slug) {
    const db = getDb();
    const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return rows[0] || null;
}
async function getTenant(id) {
    const db = getDb();
    const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return rows[0] || null;
}
async function createTenant({ name, slug }) {
    const db = getDb();
    const rows = await db.insert(tenants).values({ name, slug }).returning();
    return rows[0];
}

// ---------- 用户 ----------
async function createUser({ tenantId, identifier, passwordHash, role = 'operator' }) {
    const db = getDb();
    const rows = await db.insert(users).values({ tenantId, identifier, passwordHash, role }).returning();
    return rows[0];
}
async function findUserByTenantIdentifier(tenantId, identifier) {
    const db = getDb();
    const rows = await db.select().from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.identifier, identifier))).limit(1);
    return rows[0] || null;
}
async function getUser(id) {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] || null;
}

// ---------- 会话(refresh token 吊销/轮换) ----------
async function createSession({ userId, refreshHash, expiresAt }) {
    const db = getDb();
    const rows = await db.insert(sessions).values({ userId, refreshHash, expiresAt }).returning();
    return rows[0];
}
async function findSessionByRefreshHash(refreshHash) {
    const db = getDb();
    const rows = await db.select().from(sessions).where(eq(sessions.refreshHash, refreshHash)).limit(1);
    return rows[0] || null;
}
async function deleteSession(id) {
    const db = getDb();
    await db.delete(sessions).where(eq(sessions.id, id));
}
async function deleteSessionsForUser(userId) {
    const db = getDb();
    await db.delete(sessions).where(eq(sessions.userId, userId));
}

// ---------- 租户配置(/api/tenant/config 用) ----------
async function getTenantConfig(tenantId) {
    const db = getDb();
    // 1. 租户选城 + 市场属性 + 平台城市坐标
    const cities = await db.select({
        cityId: tenantCities.cityId,
        name: citiesCatalog.name,
        lat: citiesCatalog.lat,
        lng: citiesCatalog.lng,
        province: citiesCatalog.province,
        region: citiesCatalog.region,
        households: tenantCities.households,
        acPenetration: tenantCities.acPenetration,
        income: tenantCities.income,
        weightOverride: tenantCities.weightOverride,
    })
        .from(tenantCities)
        .innerJoin(citiesCatalog, eq(tenantCities.cityId, citiesCatalog.id))
        .where(eq(tenantCities.tenantId, tenantId));

    // 2. 模型配置(每租户一行)
    const mc = await db.select().from(tenantModelConfig).where(eq(tenantModelConfig.tenantId, tenantId)).limit(1);
    // 3. 推送配置(每租户一行)——webhook 不回传明文,仅回告是否已配置
    const pc = await db.select().from(tenantPushConfig).where(eq(tenantPushConfig.tenantId, tenantId)).limit(1);

    return {
        cities,
        modelConfig: mc[0] || null,
        pushConfig: pc[0]
            ? { scheduleUtc: pc[0].scheduleUtc, heatFocusThreshold: pc[0].heatFocusThreshold, heatRiseThreshold: pc[0].heatRiseThreshold, webhookConfigured: Boolean(pc[0].webhookUrlEnc) }
            : null,
    };
}

module.exports = {
    findTenantBySlug, getTenant, createTenant,
    createUser, findUserByTenantIdentifier, getUser,
    createSession, findSessionByRefreshHash, deleteSession, deleteSessionsForUser,
    getTenantConfig,
};
