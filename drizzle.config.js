// drizzle-kit 配置。generate 离线读 schema 产 SQL;push/seed/studio 需真实 DATABASE_URL。
const { defineConfig } = require('drizzle-kit');

module.exports = defineConfig({
    schema: './lib/db/schema.js',
    out: './lib/db/migrations',
    dialect: 'postgresql',
    dbCredentials: { url: process.env.DATABASE_URL || 'postgresql://placeholder' },
});
