# P0 部署与开通指南

P0 落地了多租户数据地基(Neon Postgres + Drizzle)+ 真鉴权(`jose` JWT)。
本文件是需要**你的 Vercel 账号 + 外网**才能完成的步骤(沙箱内无法连通 marketplace/api.vercel.com,
故由你执行)。代码、schema、迁移、种子、测试均已就绪。

## 1. 开通 Neon(自动注入 DATABASE_URL)

项目已 link(`project-cobu3`)。在仓库根目录:

```bash
vercel integration add neon        # 按提示在浏览器完成授权,自动建库并注入 DATABASE_URL
vercel env pull                    # 拉到本地 .env.local
```

> 若偏好 dashboard:https://vercel.com/dashboard/{team}/stores → Neon。

## 2. 配置环境变量

```bash
# 鉴权密钥(≥16 字符)
echo "JWT_SECRET=$(openssl rand -base64 32)"   # 把值写入 .env.local 与 Vercel env
# Vercel 上:vercel env add JWT_SECRET
# 沿用既有:QWEATHER_API_KEY、WECOM_BOT_WEBHOOK、CRON_SECRET(参见 .env.example)
```

模板见 `.env.example`。

## 3. 应用 schema + 种子

```bash
npm install                       # 装依赖(若尚未)
npm run db:push                   # drizzle-kit 把 schema 推到 Neon(建 12 张表)
npm run db:seed                   # 种子:cities_catalog(131城)+ 规则目录 + 默认租户/管理员
```

`db:seed` 会打印默认管理员密码(若未用 `SEED_ADMIN_PASSWORD` 指定)——**立即保存**。

## 4. 跑 DB 集成测试(此前 skip 的 2 个现在应通过)

```bash
node --test tests/*.test.js       # 期望:全 pass(含租户隔离、tenant-config 成功用例),0 skip
```

## 5. 验证现有部署不回归(模块系统)

P0 引入了首个 `package.json`(`"type":"commonjs"`)。现有 `api/weather|push|cron-push.js`
混用 `export default` + `require()`(依赖 Vercel 打包器)。务必确认仍可部署:

```bash
vercel build                      # 本地构建校验;通过后再 vercel deploy / 合并到 main
```

若构建报模块解析错,通常是因为 `"type"` 与既有 api 的 `export default` 冲突——届时统一处理
(把现有 api 也改为 `module.exports`,或按需调整)。

## 6. 端到端冒烟(新鉴权 + 租户隔离)

```bash
# 注册第二个租户(证明多租户)
curl -X POST <url>/api/auth/register -H 'Content-Type: application/json' \
  -d '{"tenantName":"测试B","slug":"tenant-b","identifier":"ops","password":"12345678"}'
# 登录默认租户,拿 accessToken
curl -X POST <url>/api/auth/login -H 'Content-Type: application/json' \
  -d '{"slug":"default","identifier":"admin","password":"<种子密码>"}'
# 用各自 token 命中配置端点,确认返回各自不同数据、互不可见
curl <url>/api/tenant/config -H 'Authorization: Bearer <token>'
```

## 7.(可选)RLS 纵深加固

P0 的强制隔离是应用层 `WHERE tenant_id`。`lib/db/rls-hardening.sql` 是 RLS 加固脚本(enable 级;
当前 owner 角色会绕过,故不影响应用)。**待**将来引入非 owner 受限角色 + 每请求
`SET LOCAL app.tenant_id` 接线后,手动执行该 SQL 并改 `FORCE`,RLS 即生效:

```bash
psql "$DATABASE_URL" -f lib/db/rls-hardening.sql
```

---

## 本次(P0)交付物清单
- `package.json`、`drizzle.config.js`、`.env.example`、`.gitignore`(+node_modules)
- `lib/db/`:`schema.js`(12 表)、`client.js`(懒 getDb)、`queries.js`(租户作用域)、`migrations/0000_init.sql`、`rls-hardening.sql`
- `lib/auth.js`(scrypt + jose JWT + refresh)、`lib/http.js`
- `api/auth/{register,login,refresh,logout,me}.js`、`api/tenant/config.js`
- `scripts/seed.js`
- `tests/{auth,tenant-isolation,tenant-config}.test.js`

## 不在 P0(P1+,见 PRD §7)
`createADICore` 参数化、前端启动改 `/api/tenant/config`、多租户 cron-push、模型增强(市场加权/异常基线)、计费。
