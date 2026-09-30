// 种子:平台城市库 + 规则目录 + 一个默认租户/管理员。
// 运行需 DATABASE_URL + JWT_SECRET。用法:npm run db:seed(或 node scripts/seed.js)
// 幂等:可重复运行。默认管理员密码:用 SEED_ADMIN_PASSWORD 指定,否则随机生成并打印。
const { randomBytes } = require('node:crypto');
const { eq, and } = require('drizzle-orm');
const { getDb } = require('../lib/db/client');
const schema = require('../lib/db/schema');
const { hashPassword } = require('../lib/auth');
const ADICore = require('../js/adi-core.js');

async function main() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未配置');
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET 未配置(种子需建管理员,涉及密码哈希)');
    const db = getDb();

    // 1. cities_catalog ← 现 131 城(按 name 幂等)
    const cities = ADICore.CITIES_CONFIG.map((c) => ({
        name: c.name, lat: c.lat, lng: c.lng, province: c.province, region: c.region,
    }));
    await db.insert(schema.citiesCatalog).values(cities).onConflictDoNothing({ target: schema.citiesCatalog.name });
    console.log(`✓ cities_catalog(${cities.length})`);

    // 2. force_upgrade_rules 目录 ← 现 ADI_CONFIG.forceUpgrade(按 slug 幂等)
    const rules = ADICore.ADI_CONFIG.forceUpgrade.map((r) => ({
        slug: r.id, name: r.name, targetLevel: r.targetLevel, definition: { desc: r.desc },
    }));
    await db.insert(schema.forceUpgradeRules).values(rules).onConflictDoNothing({ target: schema.forceUpgradeRules.slug });
    console.log(`✓ force_upgrade_rules(${rules.length})`);

    // 3. 默认租户 + 管理员
    const slug = process.env.SEED_TENANT_SLUG || 'default';
    let tenant = (await db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1))[0];
    if (!tenant) {
        tenant = (await db.insert(schema.tenants)
            .values({ name: process.env.SEED_TENANT_NAME || '默认租户', slug }).returning())[0];
    }

    const identifier = process.env.SEED_ADMIN_IDENTIFIER || 'admin';
    let user = (await db.select().from(schema.users)
        .where(and(eq(schema.users.tenantId, tenant.id), eq(schema.users.identifier, identifier))).limit(1))[0];
    if (!user) {
        const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(9).toString('base64url');
        user = (await db.insert(schema.users).values({
            tenantId: tenant.id, identifier, passwordHash: hashPassword(password), role: 'admin',
        }).returning())[0];
        console.log(`✓ 管理员已建 → 租户=${slug} 账号=${identifier} 密码=${password}(请立即妥善保存)`);
    } else {
        console.log(`· 管理员已存在(${identifier}),跳过`);
    }

    // 4. 默认模型配置 = 现 ADI_CONFIG 值(每租户一行,幂等)
    const mc = (await db.select().from(schema.tenantModelConfig).where(eq(schema.tenantModelConfig.tenantId, tenant.id)).limit(1))[0];
    if (!mc) {
        await db.insert(schema.tenantModelConfig).values({
            tenantId: tenant.id,
            weights: ADICore.ADI_CONFIG.weights,
            thresholds: ADICore.ADI_CONFIG.thresholds,
            hotNight: ADICore.ADI_CONFIG.hotNight,
            forceUpgradeRuleIds: ADICore.ADI_CONFIG.forceUpgrade.map((r) => r.id),
        });
        console.log('✓ tenant_model_config(默认=现 ADI_CONFIG)');
    }

    // 5. 默认推送配置(若给了 WECOM_BOT_WEBHOOK)。P0 webhook 明文存储,加密为后续 TODO。
    const pc = (await db.select().from(schema.tenantPushConfig).where(eq(schema.tenantPushConfig.tenantId, tenant.id)).limit(1))[0];
    if (!pc) {
        await db.insert(schema.tenantPushConfig).values({
            tenantId: tenant.id,
            webhookUrlEnc: process.env.WECOM_BOT_WEBHOOK || '',
        });
        console.log('✓ tenant_push_config' + (process.env.WECOM_BOT_WEBHOOK ? '(含 webhook)' : '(webhook 未配)'));
    }

    console.log('种子完成。');
}

main().catch((e) => { console.error('种子失败:', e); process.exit(1); });
