// 多租户数据模型(Drizzle,Postgres)。所有租户表带 tenant_id 并由 RLS 隔离。
// 与 docs/PRD.md §6.2 对齐;闭环表(sales/supply/predictions)在首版即纳入(Q1:pilot 有真实数据)。
const {
    pgTable, uuid, text, timestamp, date, integer, real, boolean,
    numeric, jsonb, uniqueIndex, pgEnum,
} = require('drizzle-orm/pg-core');

// ---------- 枚举 ----------
const roleEnum = pgEnum('user_role', ['admin', 'operator', 'viewer']);
const statusEnum = pgEnum('entity_status', ['active', 'disabled']);
const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'disabled']);

// ---------- 租户与账号 ----------
const tenants = pgTable('tenants', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: tenantStatusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    identifier: text('identifier').notNull(),          // 邮箱或手机号(租户内唯一)
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').default('operator').notNull(),
    status: statusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
    tenantIdentifierIdx: uniqueIndex('users_tenant_identifier_uniq').on(t.tenantId, t.identifier),
}));

const sessions = pgTable('sessions', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refreshHash: text('refresh_hash').notNull(),         // refresh token 的哈希,支持吊销
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------- 平台城市库(种子 = 现 131 城) ----------
const citiesCatalog = pgTable('cities_catalog', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull().unique(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    province: text('province').notNull(),
    region: text('region').notNull(),
    climateZone: text('climate_zone'),                   // P1 异常/基线用(华北/华南/西北…)
});

// ---------- 平台规则目录(forceUpgrade,租户按 id 选取;不接受租户 JS) ----------
const forceUpgradeRules = pgTable('force_upgrade_rules', {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull().unique(),                // 与现 ADI_CONFIG.forceUpgrade[].id 对齐
    name: text('name').notNull(),
    targetLevel: text('target_level').notNull(),          // 'outbreak' | 'action'
    definition: jsonb('definition').notNull(),            // 判定参数(由平台代码解释,非任意代码)
    enabled: boolean('enabled').default(true).notNull(),
});

// ---------- 租户配置 ----------
const tenantCities = pgTable('tenant_cities', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    cityId: uuid('city_id').notNull().references(() => citiesCatalog.id, { onDelete: 'cascade' }),
    households: integer('households'),                    // 户数(市场体量)
    acPenetration: real('ac_penetration'),                // AC 百户保有量
    income: integer('income'),                            // 人均可支配收入
    weightOverride: real('weight_override'),              // 手工权重覆盖(P1 市场加权)
}, (t) => ({
    tenantCityIdx: uniqueIndex('tenant_cities_tenant_city_uniq').on(t.tenantId, t.cityId),
}));

const tenantModelConfig = pgTable('tenant_model_config', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().unique().references(() => tenants.id, { onDelete: 'cascade' }),
    weights: jsonb('weights').notNull(),                  // {nightMinTemp,dayMaxTemp,feelsLike,continuousHeat,humidityMuggy}
    thresholds: jsonb('thresholds').notNull(),            // {outbreak:{min},action:{min},...}
    hotNight: jsonb('hot_night').notNull(),               // {minTemp,feelsLike}
    forceUpgradeRuleIds: jsonb('force_upgrade_rule_ids').notNull(), // 选用的规则 id 数组
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

const tenantPushConfig = pgTable('tenant_push_config', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().unique().references(() => tenants.id, { onDelete: 'cascade' }),
    webhookUrlEnc: text('webhook_url_enc').notNull(),     // 企微 webhook(加密存储)
    scheduleUtc: text('schedule_utc').default('01:30').notNull(), // HH:mm UTC
    heatFocusThreshold: text('heat_focus_threshold').default('action').notNull(), // 达到该级才推
    heatRiseThreshold: integer('heat_rise_threshold').default(10).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------- 闭环数据(Q1:pilot 有真实销量/库存) ----------
const salesRecords = pgTable('sales_records', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    cityId: uuid('city_id').notNull().references(() => citiesCatalog.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    sku: text('sku'),
    units: integer('units').notNull().default(0),
    revenue: numeric('revenue', { precision: 12, scale: 2 }),
});

const supplyRecords = pgTable('supply_records', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    cityId: uuid('city_id').notNull().references(() => citiesCatalog.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    stockUnits: integer('stock_units').notNull().default(0),
    installCapacity: integer('install_capacity').notNull().default(0),
});

// ---------- 留痕(供 P2 模型校准 + 推送审计) ----------
const predictions = pgTable('predictions', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    cityId: uuid('city_id').notNull().references(() => citiesCatalog.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    adiScore: integer('adi_score').notNull(),
    level: text('level').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

const pushLogs = pgTable('push_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),                          // 'heatFocus' | 'heatRise' | 'brief'
    status: text('status').notNull(),                      // 'ok' | 'skipped' | 'error'
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

module.exports = {
    tenants, users, sessions,
    citiesCatalog, forceUpgradeRules,
    tenantCities, tenantModelConfig, tenantPushConfig,
    salesRecords, supplyRecords,
    predictions, pushLogs,
};
