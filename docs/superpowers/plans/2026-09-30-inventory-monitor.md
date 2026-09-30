# Inventory Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在公司工作台交付京东分仓库存导入、成套／SKU双口径预警、历史与Excel导出，以及每天10:00的企业微信摘要和附件日报。

**Architecture:** 服务端拥有报表校验、计算与不可变计算版本。数据库原子更新有效快照，页面、导出、推送消费同一版本。独立库存cron和推送状态机复用企业微信传输思想，不混入天气调度逻辑。

**Tech Stack:** 现有 Node >=20／CommonJS、Neon Postgres／Drizzle，新增 `pg`用于交互事务、`exceljs`用于产品运行时XLSX读写、`papaparse`用于CSV、`yauzl`用于XLSX解压体积预检；node:test与Playwright。使用原生fetch／FormData／Blob发送企微消息。

**Spec:** [已确认规格](../specs/2026-09-30-inventory-monitor-design.md)。前置：[工作台计划](2026-09-30-company-workbench.md)W1–W3。

## Global Constraints

- 每天一次导入全部仓库；同日期先预览新增、变更、缺失记录，确认后替换完整快照，保留操作记录。
- 同时保留独立 SKU 和整套商品；空调仅同仓配套，冰箱独立计算。
- 同仓内外机在同一统计周期的销售出库量取较小值；不等时提示异常。
- 默认近 7 天，可按商品切换近 15／30 天。
- 显示待配置，不判定对应风险，不计入正常。
- 只提示风险，不计算建议补货数量。
- 保留每日快照及当时预警结果，支持按日期查询和导出；首期不做趋势图。
- 每天北京时间 10:00，固定企业微信群，前一天摘要＋完整 Excel。
- 只发送未更新提醒及最后数据日期，不发旧日报冒充最新数据。
- 未配置数据库／调度或未实际完成企微附件验证，不能声称完整上线。
- 产品依赖在实施时核实兼容性并锁定版本，计划阶段不安装。这里的ExcelJS是应用运行时依赖，并非用开发工具生成一次性用户工作簿。
- 仅使用本模块需要的已有账号／数据库地基，保留所有用户未提交工作；每次提交检查暂存范围。

## Review Focus

- Excel数字型编码丢前导零、日期含时间、BOM和重复列：准确保留文本标识；不能恢复的源信息明确报错，I2。
- 多人同时确认快照、配对、规则：版本冲突拒绝旧预览，失败回滚，I1/I5。
- 最新JWT仍带旧角色、停用公司或其他租户对象ID：库存端点读取真实身份状态并拒绝越权，I1/I6。
- 7天零出库但30天有出库、缺行与零混用、不同周期汇总：不触发错误滞销、不伪造套数，I3/I7。
- 企业微信已接收但超时、摘要成功附件失败、进程退出：未知状态不自动盲重发、冻结内容不变，I8/I9。

## 前置与交付顺序

顺序 I1→I2→I3→I4→I5→I6→I7→I8→I9→I10。各任务可独立验证，但首期验收要求全部完成。依赖紧密，建议本会话顺序实施；独立最终复核在完整分支完成后进行。

任务中的代码段是可执行的关键契约／算法，不是允许忽略已确认规格的最小演示。每个任务都先落其实际失败测试，再实现；纯视觉／静态文案使用浏览器检查，不写镜像HTML的断言。

### 共用类型

以下字段在所有任务统一使用，不以页面中文列名充当数据库字段：

```js
// NormalizedRow：数值字段为非负安全整数，原始周转允许null。
const exampleRow = {
  date:'2026-09-29', warehouse:'甲仓', jdSku:'JD-I',
  merchantCode:'000123', merchantLabel:'内机A', name:'内机A', region:'上海',
  stock:16, good:16, bad:0, available:16,
  sales:{1:2, 7:14, 15:24, 30:40},
  sourceTurnover:{mtd:null, days30:null}, extra:{}
};
// RuleValues：null是继承／未配置，0是合法已配置值（积压上限除外）。
const exampleRule = {period:7, leadDays:5, safetyDays:3, maxDays:null};
// Entity事实由I3构建；pair输入缺行则 available/sales 为null。
const exampleFact = {
  key:'甲仓/product/p1', warehouse:'甲仓', entityId:'p1', kind:'product',
  unit:'套', available:16, sales:{1:2,7:14,15:24,30:40}, sourceSkus:['JD-I','JD-O'],
  issues:[]
};
// Result保留以上事实，加rule/ruleSources/dailySales/daysCover/businessAlerts/issues。
// Calculation保存：id, tenantId, date, snapshotRevision, configRevision,
// formulaVersion, createdAt, rows（原始规范化明细）, products, pairings,
// rules（当次副本）, results, summary。写入后不可变。
```

错误统一 `InventoryError(code,message,status=400,details=[])`；身份不合法401、角色不足403、对象不属于本租户404、版本冲突409、格式错误422、体积413、服务配置缺失503。错误详情不得包含凭据、SQL或连接串。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `lib/inventory/errors.js`, `access.js` | 结构化错误、实时角色与租户检查 |
| `lib/db/inventory-schema.js`, `inventory-client.js` | 库存表定义工厂、独立pg事务连接 |
| `lib/inventory/repository.js`, `config-service.js`, `snapshot-service.js` | 租户查询、配对规则配置、导入和历史原子持久化 |
| `lib/inventory/import-parser.js`, `import-validation.js`, `xlsx-guard.js` | 格式解析、字段校验、压缩包边界 |
| `lib/inventory/rules.js`, `pairing.js`, `calculate.js`, `dates.js` | 不依赖DOM／网络的领域计算 |
| `lib/inventory/query.js`, `export.js` | 公用筛选、Excel工作簿生成 |
| `lib/inventory/wecom.js`, `push-service.js`, `secrets.js` | 企微协议、任务状态机、配置加密 |
| `api/inventory/*.js`, `api/cron-inventory.js` | HTTP方法／鉴权和服务调用，禁止复制计算逻辑 |
| `inventory.html`, `css/inventory.css`, `js/inventory/*.js` | 页面和按职责划分的视图／API客户端 |
| `tests/inventory-*.test.js`, `tests/helpers/inventory-db.js` | 单元、契约、隔离和真实事务测试 |
| `tests/browser/inventory.spec.js`, `tests/fixtures/inventory/*` | 浏览器流程和人工构造脱敏数据 |
| `docs/INVENTORY-OPERATIONS.md`, `scripts/check-inventory-readiness.js` | 配置、迁移、数据补发和上线状态检查 |

## Task I1：库存数据库、迁移与实时权限

**Files:** Create `lib/db/inventory-schema.js`, `lib/db/inventory-client.js`, `lib/inventory/errors.js`, `lib/inventory/access.js`, `lib/inventory/repository.js`, `tests/helpers/inventory-db.js`, `tests/inventory-db.test.js`, `tests/inventory-access.test.js`, `scripts/migrate.js`；Modify `lib/db/schema.js`, `lib/db/migrations/0000_init.sql`, migration metadata, `package.json`, `package-lock.json`；Generate `lib/db/migrations/0001_inventory_monitor.sql`。

**Interfaces:**
- `createInventorySchema({tenants,users})`返回表对象，由schema.js在既有定义之后展开导出，避免循环require。
- `withInventoryTransaction(fn)`使用同一个pg client执行BEGIN／COMMIT／ROLLBACK，fn消费参数化`client.query`；懒建Pool，构建时不要求DATABASE_URL。
- `requireInventoryUser(req, allowedRoles)`重新读取user/tenant并检查active、租户匹配及当前role，返回`{userId,tenantId,role}`。不得只相信旧JWT内role。
- 同模块导出纯函数`assertInventoryIdentity(tokenContext,user,tenant,allowedRoles)`，校验后返回真实身份，失败抛InventoryError；requireInventoryUser负责读取数据库并调用它。
- `createRepository(client)`的所有方法第一参数tenantId。供后续任务使用的原子操作按任务增加，不能提供无租户全表查询给HTTP处理器。
- 测试helper导出`inventoryDbTest(name,fn)`：无隔离库配置时调用test.skip，有配置时创建两测试租户并调用`fn({ctxA,ctxB,repository,withTransaction,now,validCsv})`，结束清理本次租户；ctxA默认admin，validCsv为I2合成fixture，now固定2026-09-30T02:00:00Z。连接和事务注入服务，不能复用生产Pool。

- [ ] 写事务回滚与越权失败测试；数据库helper仅接受`INVENTORY_TEST_DATABASE_URL`及显式`INVENTORY_TEST_ALLOW_WRITE=1`，无配置时单元测试继续、集成标记SKIP。绝不回退到生产DATABASE_URL。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertInventoryIdentity } = require('../lib/inventory/access');
test('JWT中的旧admin角色不能覆盖数据库viewer', () => {
  assert.throws(() => assertInventoryIdentity(
    {userId:'u',tenantId:'t',role:'admin'},
    {id:'u',tenantId:'t',role:'viewer',status:'active'},
    {id:'t',status:'active'}, ['admin']), e => e.status === 403);
});
```

- [ ] 运行 `node --test tests/inventory-access.test.js tests/inventory-db.test.js`，确认未实现导致失败；身份测试不依赖数据库。
- [ ] 新增pg及锁文件，实现连接事务；测试中提供独立数据库Pool，不通过修改全局生产环境变量切换数据库。

```js
async function transact(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally { c.release(); }
}
```

- [ ] 建表：规格第6节所有实体，增加`inventory_state(tenant_id PK, config_revision, latest_date)`作为租户写入锁及`inventory_import_previews`作为15分钟预览保存。配对组成使用`inventory_pairing_members`，约束`UNIQUE(tenant_id,sku_id)`只覆盖已确认组合成员；草稿独立JSON不占用唯一键。表关联使用包含tenant_id的复合外键／相应唯一索引，防止跨租户关系。
- [ ] snapshot唯一键`(tenant_id,date)`，row唯一键`(snapshot_id,warehouse_id,sku_id)`；所有更新包含tenant_id。calculation保存完整不可变输入／结果JSONB；push run包括execution_date、target_date、delivery_kind、request_id、冻结payload、lease_token、lease_until、各分项状态和attempts。默认日报唯一`(tenant_id,execution_date)`通过delivery_kind='daily'部分索引实现；手动补发独立request_id唯一。
- [ ] 在空测试库重放现有0000，验证缺少enum导致的失败。当前未跟踪初始迁移缺少`user_role`、`entity_status`、`tenant_status`声明：先核查是否曾应用到共享环境；从未应用时在0000前部补下列SQL并核对Drizzle快照／journal。若已应用则不改历史迁移，在迁移脚本的空库初始化步骤创建类型，保留原账本；已存在类型须验证枚举值一致。对线上库先读取迁移账本及schema，禁止盲目重跑0000。

```sql
CREATE TYPE user_role AS ENUM ('admin','operator','viewer');
CREATE TYPE entity_status AS ENUM ('active','disabled');
CREATE TYPE tenant_status AS ENUM ('active','suspended','disabled');
```

- [ ] 生成库存迁移并审查SQL。迁移脚本用现有迁移账本，单次连接执行；已由db:push初始化但无账本的库必须先做结构比对和基线登记，不能以“表已存在”忽略失败。记录空库与已有地基库两条迁移路径到运维文档。
- [ ] 测试空库完整迁移、二次运行无新增变更、回滚不留半批、两租户对象外键拒绝、viewer拒绝写、operator不能改规则、停用用户／公司拒绝。执行 `node --test tests/inventory-db.test.js tests/inventory-access.test.js`。
- [ ] 提交 `feat: add tenant scoped inventory storage and access`；仅包含本任务差异，迁移不对生产执行。

## Task I2：京东XLSX／CSV解析与校验

**Files:** Create `lib/inventory/import-parser.js`, `import-validation.js`, `xlsx-guard.js`, `dates.js`, `tests/inventory-import.test.js`, `tests/fixtures/inventory/valid.csv`；Modify依赖清单和锁文件。

**Interfaces:** `parseInventoryFile({buffer,filename,now}) -> Promise<{date,rows,warnings,contentHash}>`；`validateRows(rows,{today}) -> {rows,errors}`；`businessDate(now)`和`previousBusinessDate(now)`返回北京时间YYYY-MM-DD。

- [ ] 安装并锁定exceljs、papaparse、yauzl。测试fixture使用人工构造内外机／冰箱，不将用户真实报表提交到git。源样例路径仅作为本地手动验收输入。
- [ ] 写失败测试：UTF-8 BOM、带逗号商品名、前导零、重复列、空数值、公式、混合日期、未来日期、重复行、行数限制和单张表约束。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRows } = require('../lib/inventory/import-validation');
test('数量空白不能转成零', () => {
  const row={date:'2026-09-29',warehouse:'甲',jdSku:'01',stock:1,good:1,bad:0,
    available:null,sales:{1:0,7:0,15:0,30:0}};
  const r=validateRows([row],{today:'2026-09-30'});
  assert.ok(r.errors.some(e => e.field === 'available' && e.code === 'REQUIRED'));
});
```

- [ ] 运行 `node --test tests/inventory-import.test.js`，预期失败。
- [ ] 解析 `.csv` 时 TextDecoder('utf-8',{fatal:true})拒绝无效编码；Papaparse关闭dynamicTyping，header按原文本解析；重复表头和不完整引号报错。XLSX先校验文件签名和ZIP目录，拒绝宏、加密文件、多数据表、重复重要XML项；设置最大条目2000、展开总量64MiB及实际读取限额，防压缩炸弹；单个上传3MiB、10000行。
- [ ] ExcelJS读取时拒绝必填公式／错误单元格；日期值仅接受合法日期／可识别的Excel日期，UTC序列值按日期字段解码，不从文件名推断。标识字符串保留原值；数字型ID仅对安全整数按明确数字格式恢复，超出安全精度或无法确认前导零则报错要求文本导出，不能假装恢复丢失位数。
- [ ] 映射规格17列，允许顺序变化和额外列，首尾空白去除但不模糊合并SKU／仓库；空白行跳过，有内容的汇总行按普通数据报错，不静默计入。
- [ ] 数值校验执行`Number.isSafeInteger`、非负、stock=good+bad、available<=good、sales[7]<=sales[15]<=sales[30]。类型不合法先记录错误，不用Number('')。contentHash由规范化且按日期／仓库／SKU排序的原始数据生成，跨CSV/XLSX相同内容可识别；不能仅哈希ZIP字节。
- [ ] 测试生成Excel数值、字符串、公式、序列日期，往返后数量不变；本地检查用户样例58行／12仓／10SKU及22个空周转值。通过后提交 `feat: parse and validate JD inventory imports`。

## Task I3：双口径计算与规则求值

**Files:** Create `lib/inventory/rules.js`, `pairing.js`, `calculate.js`, `tests/inventory-calculate.test.js`。

**Interfaces:**
- `resolveRule({global,warehouse,product,warehouseProduct}) -> {values,sources}`字段逐层覆盖，null继承，period默认7。
- `buildFacts({rows,products,pairings}) -> Fact[]`同时产出SKU事实和已确认单品／组合事实。
- `calculateFact(fact,rule) -> Result`；`calculateInventory({rows,products,pairings,rules,date}) -> {results,summary,formulaVersion}`；formulaVersion首版`inventory-v1`。
- `suggestPairings(skus) -> [{innerSku,outerSku,reason,status:'draft'}]`；有冲突只返回候选，不自动确认。

- [ ] 写阈值边界、跨仓、缺行、零销量和统计口径失败测试。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFact } = require('../lib/inventory/calculate');
test('8天边界不缺货，7.5天缺货', () => {
  const fact={key:'甲/product/p',warehouse:'甲',entityId:'p',kind:'product',unit:'套',
    available:16,sales:{1:2,7:14,15:24,30:40},sourceSkus:['I','O'],issues:[]};
  const rule={values:{period:7,leadDays:5,safetyDays:3,maxDays:null},sources:{}};
  assert.equal(calculateFact(fact,rule).daysCover,8);
  assert.ok(!calculateFact(fact,rule).businessAlerts.includes('LOW_STOCK'));
  assert.ok(calculateFact({...fact,available:15},rule).businessAlerts.includes('LOW_STOCK'));
});
```

- [ ] 运行 `node --test tests/inventory-calculate.test.js`确认失败。
- [ ] 实现规则解析并校验周期集合、非负lead/safety、maxDays>0。组合只在同仓两条原始数据存在时取min；缺行设null及MISSING_COMPONENT，实际0保留。

```js
const required = [rule.values.leadDays, rule.values.safetyDays];
const sales = fact.sales?.[rule.values.period];
const dailySales = sales == null ? null : sales / rule.values.period;
const daysCover = dailySales > 0 && fact.available != null
  ? fact.available / dailySales : null;
const lowStock = daysCover != null && required.every(v => v != null)
  && daysCover < required[0] + required[1];
```

- [ ] 实现NO_SALES_30、OVERSTOCK和缺配数量；businessAlerts仅三类风险，issues包括RULES_PENDING、PAIRING_PENDING、MISSING_COMPONENT、OUTFLOW_MISMATCH、NO_SALES_PERIOD、ZERO_AVAILABLE。界面分开统计业务风险、库存缺配和数据／配置状态；正常须无阻断状态，不能用alerts.length===0代替。
- [ ] 汇总按产品与SKU分组，空调套／冰箱台／SKU件分开。风险商品按仓库＋实体去重；不同周期的产品汇总不给混合daysCover。所有趋势或销量合计不累加7／15／30窗口。
- [ ] suggestPairings以明确“外机／内机／对应整机”与型号候选为依据，并返回理由；通用名称不硬匹配。单品也需确认分类，避免将未配对内机当冰箱统计。
- [ ] 添加参数化测试覆盖规格第5节每条边界及缺配／出库不同期；运行单元测试通过，提交 `feat: calculate inventory risks and paired stock`。

## Task I4：商品配对与规则持久化

**Files:** Create `lib/inventory/config-service.js`, `tests/inventory-config.test.js`；Modify `repository.js`。

**Interfaces:** `createConfigService({repository,withTransaction})`返回`readConfig(ctx)`、`savePairing(ctx,{productId,innerSku,outerSku,expectedRevision})`、`saveSingleProduct(ctx,{sku,unit,expectedRevision})`、`saveRule(ctx,{scope,warehouseId,entityId,patch,expectedRevision})`。内部引用I3的calculateInventory；写入返回`{configRevision,latestCalculationId}`。

- [ ] 写数据库行为测试：operator可确认配对但不能改规则；同组成SKU被另一组合使用时409；并发配置只有一个expectedRevision成功；换规则只更新最新日期，过去计算内容不变。

```js
const assert = require('node:assert/strict');
const { inventoryDbTest } = require('./helpers/inventory-db');
const { createConfigService } = require('../lib/inventory/config-service');
inventoryDbTest('配置更新拒绝旧版本', async ({ctxA,repository,withTransaction}) => {
  const service=createConfigService({repository,withTransaction});
  const before=await service.readConfig(ctxA);
  await service.saveRule(ctxA,{scope:'global',patch:{leadDays:0},
    expectedRevision:before.configRevision});
  await assert.rejects(() => service.saveRule(ctxA,{scope:'global',patch:{leadDays:9},
    expectedRevision:before.configRevision}),e => e.status === 409);
});
```

- [ ] 运行 `node --test tests/inventory-config.test.js`确认失败；在隔离测试库运行，未配置时报告未验证。
- [ ] 事务先`SELECT ... FOR UPDATE`锁inventory_state，核对expectedRevision及对象归属；唯一约束保护配对；写新配置、增加revision、保存审计，调用I3重算最新有效快照后写不可变calculation并切换指针。
- [ ] 查询生效规则同时给sources，保存patch中省略字段不修改、显式null恢复继承、0保留。JSON不接受任意字段、原型键或客户端tenantId。
- [ ] 实现`saveSingleProduct`和取消配对后最新结果回到SKU状态；不能删除历史计算中的配对副本。
- [ ] 跑权限与配置测试，检查历史calculation JSON与原值一致；提交 `feat: persist inventory pairings and rule overrides`。

## Task I5：预览、全仓确认与快照替换

**Files:** Create `lib/inventory/snapshot-service.js`, `tests/inventory-snapshots.test.js`；Modify `repository.js`。

**Interfaces:** `createSnapshotService({repository,withTransaction})`返回`previewImport(ctx,{buffer,filename,now}) -> {previewId,expiresAt,date,counts,diff,missingWarehouses,warnings}`、`confirmImport(ctx,{previewId,expectedSnapshotRevision,confirmFullCoverage,confirmMissing,now}) -> {snapshotId,calculationId,revision}`；内部引用I2解析、I3计算。

- [ ] 写失败测试覆盖同文件无变化、新增／变更／缺失、预览过期、租户串用、配置变更、并发替换和事务异常。

```js
const assert = require('node:assert/strict');
const { inventoryDbTest } = require('./helpers/inventory-db');
const { createSnapshotService } = require('../lib/inventory/snapshot-service');
inventoryDbTest('首次导入也需确认全仓', async ({ctxA,repository,withTransaction,validCsv,now}) => {
  const service=createSnapshotService({repository,withTransaction});
  const p=await service.previewImport(ctxA,{buffer:validCsv,filename:'jd.csv',now});
  await assert.rejects(() => service.confirmImport(ctxA,{previewId:p.previewId,
    expectedSnapshotRevision:0,confirmFullCoverage:false,confirmMissing:false,now}),
    e => e.code === 'COVERAGE_CONFIRMATION_REQUIRED');
});
```

- [ ] 运行 `node --test tests/inventory-snapshots.test.js`确认失败。
- [ ] 预览服务调用I2，保存规范化行及文件摘要、目标日期当前revision、configRevision、15分钟expiresAt、操作者及租户。身份主键使用数组序列化或复合字段，不用容易碰撞的文本拼接。失败校验返回行列错误，不持久化成有效快照。
- [ ] 以最近确认的仓库集合计算missingWarehouses；同日期原快照比较diff。所有删除行及缺仓需要confirmMissing=true，首次也必须confirmFullCoverage=true；缺失不自动补零。
- [ ] 确认事务锁租户状态，检查preview属于本租户且未消费／未过期、snapshot与config版本未变，再写仓库／SKU目录、草稿候选、snapshot rows、不可变calculation、导入审计、预览已消费和最新日期。所有步骤同事务。
- [ ] 并发同日期导入仅一方成功，其他409；错误中断验证有效快照与计算指针不变。确认响应丢失再次使用同previewId时返回已生成snapshotId，不重复写。
- [ ] 同日期内容相同返回无变更；历史补报不会把latest_date倒退；替换删除旧有效rows前已保存必要审计差异及原发送依据。
- [ ] 跑 I1/I4/I5集成测试并验证完整性，提交 `feat: preview and atomically replace inventory snapshots`。

## Task I6：库存HTTP接口与操作页面

**Files:** Create `api/inventory/import-preview.js`, `import-confirm.js`, `snapshots.js`, `overview.js`, `pairings.js`, `rules.js`, `lib/inventory/query.js`, `inventory.html`, `css/inventory.css`, `js/inventory/api.js`, `app.js`, `overview.js`, `import.js`, `settings.js`, `tests/inventory-http.test.js`, `tests/browser/inventory.spec.js`；Modify工作台入口取消库存临时开发中状态。

**Interfaces:**
- 导入预览用原始二进制body上传，文件名用经过编码的`X-Inventory-Filename`头；流式计数限制3MiB，避免base64使请求变大；实现时验证Vercel对该路由的body解析配置。
- 普通JSON端点200返回`{success:true,data}`；错误`{success:false,error:{code,message,details}}`，422有行列校验数组。GET提供date、view(product/sku)、warehouseId、search、alert、page/pageSize；pageSize≤100。
- `selectResults(calculation,filters) -> {rows,summary}`是页面、导出和摘要筛选的共用函数；后端不接受客户端传来的计算结果。

- [ ] 写权限／内容类型／参数验证测试，用handler factory注入服务依赖，断言401、403、404、413、422和409能被前端区分。增加两租户猜测calculationId导出／overview都不可读。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectResults } = require('../lib/inventory/query');
test('筛选汇总只覆盖筛选集合', () => {
  const c={results:[
    {key:'A',warehouseId:'w1',kind:'product',unit:'套',available:8,businessAlerts:[],issues:[]},
    {key:'B',warehouseId:'w2',kind:'product',unit:'套',available:50,businessAlerts:[],issues:[]}
  ]};
  const r=selectResults(c,{warehouseId:'w1',view:'product'});
  assert.equal(r.rows.length,1);
  assert.equal(r.summary.availableByUnit['套'],8);
});
```

- [ ] 运行 `node --test tests/inventory-http.test.js`确认失败，增加页面端到端失败测试：上传→校验→确认→看板→历史；viewer只读；operator规则按钮缺失但同时测试直接API403。
- [ ] 实现薄HTTP处理器，每次用I1真实权限guard，所有对象按tenantId查；不可向浏览器返回数据库错误栈。统一auth/api客户端沿用W1处理401，普通业务409不自动重试提交。
- [ ] 实现页面：日期／整套SKU切换、单位分组卡片、筛选、分页表格、空／错误／待配置状态；日期来源服务端有效快照。切日期和筛选时使用AbortController或请求序号阻止慢响应覆盖新选择。
- [ ] 导入界面分上传、问题／差异预览、全仓与缺失确认、提交结果。金额／成本不显示。校验错误支持下载UTF-8 CSV，文字以安全字符串导出，不执行公式。
- [ ] 配对页展示候选依据、冲突和人工确认；规则页显示继承来源、0与空白区别，保存后显示新计算版本。所有商品／仓库文本使用textContent，不使用原始HTML。
- [ ] 浏览器用合成数据验证58行规模、长中文名称、390px宽度、空结果、过期预览刷新、快速切换日期、断网重试；运行HTTP及浏览器测试，通过后提交 `feat: add inventory dashboard and import workflows`。

## Task I7：历史与Excel导出

**Files:** Create `lib/inventory/export.js`, `api/inventory/export.js`, `tests/inventory-export.test.js`；Modify `js/inventory/overview.js`。

**Interfaces:** `buildInventoryWorkbook({calculation,filters,generatedAt}) -> Promise<Buffer>`；`readCalculation(ctx,id)`必须验证租户；GET export接收计算版本／筛选条件，返回XLSX及安全Content-Disposition。

- [ ] 写失败测试：生成后用ExcelJS重新读取，断言数据日期、前导零、数字单元格、筛选汇总、空结果和同版本结果一致。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildInventoryWorkbook } = require('../lib/inventory/export');
test('商品文本不变成Excel公式', async () => {
  const calculation={id:'c',date:'2026-09-29',snapshotRevision:1,configRevision:1,
    formulaVersion:'inventory-v1',rows:[],products:[],pairings:[],rules:[],summary:{},
    results:[{key:'k',kind:'sku',entityId:'000123',warehouse:'甲',unit:'件',
      name:'=HYPERLINK("https://example.test")',available:1,sales:{1:0,7:0,15:0,30:0},
      dailySales:0,daysCover:null,rule:{period:7},businessAlerts:['NO_SALES_30'],issues:[]}]};
  const b=await buildInventoryWorkbook({calculation,filters:{view:'sku'},generatedAt:new Date('2026-09-30T02:00:00Z')});
  const wb=new ExcelJS.Workbook(); await wb.xlsx.load(b);
  let formulas=0;
  wb.eachSheet(s => s.eachRow(r => r.eachCell(c => { if(c.type===ExcelJS.ValueType.Formula) formulas++; })));
  assert.equal(formulas,0);
});
```

- [ ] 运行 `node --test tests/inventory-export.test.js`确认失败。
- [ ] 实现五张表：汇总、分仓商品、SKU明细、预警与异常、口径与规则。写入服务端冻结结果作为值，文本标识强制字符串，保留数值格式；表头冻结、筛选、合理列宽、长名称换行，空值写空而非0。
- [ ] 全量导出两种口径分别放表，不混合总量；筛选导出注明view及条件，使用I6同一筛选函数。NO_SALES_PERIOD、RULES_PENDING和缺行原因完整导出，历史日期使用保存的规则副本。
- [ ] API不缓存受保护文件；生成时校验授权及版本，在浏览器下载文件名中包含业务日期。记录生成时刻与数据日期，不把重导时间当快照更新时间。
- [ ] 独立核对甲仓内10外8、乙仓内0外10的套数与SKU库存，并在真实Excel或兼容预览中查看中文、数字、表头、空结果。测试生成物写到临时目录，不提交客户真实文件。
- [ ] 运行导出及历史集成测试、浏览器下载测试，提交 `feat: export immutable inventory reports`。

## Task I8：企业微信配置、加密与附件传输

**Files:** Create `lib/inventory/wecom.js`, `secrets.js`, `api/inventory/push-config.js`, `tests/inventory-wecom.test.js`；Modify `js/inventory/settings.js`, `.env.example`。

**Interfaces:** `validateWebhook(url)`；`encryptWebhook(url,key)` / `decryptWebhook(cipher,key)`；`createWecomClient({fetchImpl,webhook,timeoutMs})`返回`sendMarkdown(content)`, `uploadFile(buffer,filename) -> mediaId`, `sendFile(mediaId)`。

- [ ] 开始实现时读取企业微信群机器人官方文档，核实上传路径、media_id、临时素材有效期、Markdown字节和文件大小限制，写入运维文档及测试常量；外网不可用时完成模拟协议测试，但真实接入验收保持未通过。
- [ ] 写URL及加密失败测试，覆盖非官方host、用户信息、非https、重定向、异常查询参数、篡改密文；不得在测试日志输出真实Webhook。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWebhook } = require('../lib/inventory/wecom');
test('只允许企业微信机器人HTTPS地址', () => {
  assert.throws(() => validateWebhook('https://qyapi.weixin.qq.com.evil.test/cgi-bin/webhook/send?key=x'));
  assert.throws(() => validateWebhook('http://127.0.0.1/cgi-bin/webhook/send?key=x'));
  assert.equal(validateWebhook('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test').hostname,
    'qyapi.weixin.qq.com');
});
```

- [ ] 运行 `node --test tests/inventory-wecom.test.js`确认失败；实现AES-256-GCM随机12字节nonce、独立`INVENTORY_WEBHOOK_ENCRYPTION_KEY`，版本化密文；GET只返回configured/enabled，不返回可还原地址。未配置key时禁止保存，不静默明文回退。
- [ ] 实现官方host/path白名单及`redirect:'error'`。上传用Blob和FormData，发送文件用media_id；网络响应必须同时验证HTTP状态、JSON及errcode。错误只记录脱敏code/message，限制上游错误正文长度。
- [ ] 消息按UTF-8字节截断，保持完整Unicode码点；概要只列有限重点项，完整数据在附件。上传文件过大提前返回明确错误，不截断工作簿。
- [ ] 用fetch注入测试先上传后文件发送、非JSON上游、HTTP200但errcode非0、超时、限流及失效media。任何测试均不用真实群地址；管理员配置保存不发送，测试发送为单独显式按钮。
- [ ] 更新示例环境变量名称（不填密钥值），运行测试通过，提交 `feat: support secure WeCom inventory attachments`。

## Task I9：每日任务、冻结日报与可恢复推送

**Files:** Create `lib/inventory/push-service.js`, `api/inventory/push-runs.js`, `api/cron-inventory.js`, `tests/inventory-push.test.js`；Modify `repository.js`, `js/inventory/settings.js`, `vercel.json`, `tests/vercel-config.test.js`。

**Interfaces:** `runDailyInventoryPush({tenantId,now,repository,wecom,buildWorkbook})`；`retryInventoryPush(ctx,{runId,requestId,confirmUnknown})`；`resendInventoryReport(ctx,{date,requestId})`。每日默认只允许一个run；手动补发单独requestId，不覆盖原run。

- [ ] 写日期与推送状态测试，now注入，跨月年不依赖系统本地时区。

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { previousBusinessDate } = require('../lib/inventory/dates');
test('北京时间元旦目标为上一年末', () => {
  assert.equal(previousBusinessDate(new Date('2027-01-01T02:00:00Z')), '2026-12-31');
  assert.equal(previousBusinessDate(new Date('2026-09-30T16:05:00Z')), '2026-09-30');
});
```

- [ ] 运行 `node --test tests/inventory-push.test.js`确认缺少状态实现时失败；日期逻辑已有时只新增相应测试。
- [ ] 用租户＋execution_date唯一键及短事务锁创建／领取run，持久化执行日、目标前一天、冻结计算或缺报payload；数据库没有目标有效快照时构造缺报提醒，未初始化数据库是系统失败而非“无库存”。
- [ ] 每个run用lease_token和lease_until控制归属，HTTP外部调用不持有长数据库事务。每个发送步骤先持久化sending，再调用外部平台，收到成功后原子写sent。租约过期的sending分项标记unknown，不默认为failed。任务只更新仍持有该lease_token的记录。

```text
日报：pending → generating → generated → summary:sending → summary:sent
      → upload:sending → upload:ready → file:sending → file:sent → complete
缺报：pending → summary:sending → summary:sent → complete
平台明确拒绝：对应分项failed，可人工重试
结果不确定／sending进程退出：对应分项unknown，人工核对后决定
```

- [ ] 先生成附件再发送正常摘要；冻结payload包含完整导出输入与生成时间，重试不能读取后来修改的快照。上传素材失效可重新上传同一冻结文件；摘要sent时只重试附件。明确平台错误可重试，超时未知必须管理员确认后重试并留痕。
- [ ] 未配置／禁用Webhook时记录配置问题，不调用网络；每个租户失败互不影响，批量任务设置有限并发和响应时间预算，未执行租户保留待处理而非假成功。首期按公司实际规模验证函数时限。
- [ ] cron只接受`Authorization: Bearer CRON_SECRET`且secret必配；Vercel cron新增`0 2 * * *`，保留天气`30 1 * * *`。UI固定北京时间10:00并显示上次状态；仅admin可测试／重试／补发，默认定时执行不依赖用户会话。
- [ ] 测试无预警照发两部分、缺昨天仅提醒、只有今天不能替代、并发触发一run、规则更新不改变冻结文件、摘要成功附件失败、HTTP成功未知、进程退出与旧lease写回拒绝、跨租户重试拒绝。晚导入不自动补发。
- [ ] 运行推送、企微、权限与vercel配置测试，提交 `feat: schedule recoverable daily inventory reports`。

## Task I10：完整验收、容量和上线说明

**Files:** Create `scripts/check-inventory-readiness.js`, `docs/INVENTORY-OPERATIONS.md`；Modify `tests/browser/inventory.spec.js`, `docs/WORKBENCH-SETUP.md`, `package.json`（验收命令）。

**Interfaces:** readiness检查不泄露值、不发消息、不修改配置；输出数据库可达、迁移一致、加密key格式、cron secret状态、Webhook配置状态。实际调度精度、消息送达另列需要实测，不能靠环境变量存在判定通过。

- [ ] 增加端到端用例：管理员配置→operator导入及配对→viewer查看与下载→再次导入差异确认→历史查看→模拟日任务→管理员重试文件。用真实隔离数据库和模拟企微完成一轮，不以全mock覆盖代替事务验证。
- [ ] 生成10,000条合成数据，验证上传／解压边界、预览大小、事务耗时、内存、分页及Excel字节数；在目标部署验证二进制上传和文件响应限制。如果已承诺3MiB／10000行无法支持，报告实际瓶颈并修正实现，不静默截断输入。
- [ ] 运行 `env -u DATABASE_URL npm test`，记录通过／失败／跳过；库存数据库集成必须通过独立INVENTORY_TEST_DATABASE_URL完成，既有数据库测试仅在确认隔离库后显式给其DATABASE_URL，SKIP不算数据库验收。运行 `npm run test:browser`，检查工作台、库存和原天气关键流程。仅在发生新修改／失败时补跑受影响部分。
- [ ] 执行Vercel本地构建，检查CommonJS与原天气export default混用；若构建失败，仅修复必要handler导出兼容并跑天气相关回归，不借机重构整个项目。
- [ ] 运维文档给出迁移、回滚、用户角色、全仓导入、配对确认、阈值配置、Webhook保存、测试发送、错误重试及历史修正版补发的操作步骤。回滚先停库存cron／入口，保留新数据表和已发依据，不自动删表。
- [ ] 核实实际Vercel计划。免费计划小时级cron不能通过10:00分钟级目标；列出使用符合条件计划或外部鉴权调度的具体配置路径，由用户明确选择涉及付费的动作，不自动购买。外部调度启用时关闭重复Vercel库存触发，唯一run仍作为防线。
- [ ] 在用户指定测试群完成真实摘要＋真实XLSX附件验证；指定生产Webhook、上线部署和真实群发送使用已有授权范围，缺失必要配置时准确说明剩余步骤，不假造成功。
- [ ] 检查源码、git差异及构建输出无真实Webhook／连接串、无客户样例入库到git、无假数据回退；最终独立代码复核和相关修复测试通过后提交 `docs: document inventory operations and acceptance`。

## 规格覆盖与验收证据

| 规格 | 任务 | 必须保留的证据 |
| --- | --- | --- |
| §1/§2 工作台与首期边界 | 工作台W1–W3 | 可用入口、原气温回归、两模块规划中 |
| §3 导入及全仓确认 | I2/I5/I6 | 样例计数、错误行列、差异预览、并发与回滚测试 |
| §4 配对与规则 | I3/I4/I6 | 人工确认、成员唯一、规则继承与0边界 |
| §5 计算 | I3/I7 | 逐项边界单元测试、导出结果对照 |
| §6 历史与持久化 | I1/I4/I5/I9 | 真实DB事务及跨租户测试、冻结版本重现 |
| §7 页面权限 | W1/I1/I6 | DB角色变化拒绝、HTTP权限、浏览器流程 |
| §8 导出 | I7 | 重读XLSX检查、视觉查看、下载测试 |
| §9 每日推送 | I8/I9/I10 | 模拟状态机、真实测试群附件、调度运行记录 |
| §10 接口与模块 | I1/I6/I9 | 参数校验、复用计算、构建通过 |
| §11 验收16项 | I10及上表任务 | 通过／跳过／环境阻塞清单，不以文档代替实测 |

## 已查技术依据

- [node-postgres事务文档](https://node-postgres.com/features/transactions)：同一事务使用同一个连接。
- [ExcelJS官方仓库](https://github.com/exceljs/exceljs)：实施时以锁定版本文档核对读取／写入及类型API。
- [Vercel Cron计划与精度](https://vercel.com/docs/cron-jobs/usage-and-pricing)：需单独验证上线计划是否满足时间目标。
- [企业微信群机器人文档](https://developer.work.weixin.qq.com/document/path/91770)：实现前核对协议及限制，当前规划不代表已完成真实群验证。

计划自检重点：函数名与共用类型一致，已覆盖规格每节及五类Review Focus；所有真实数据库／第三方验收均单独列明。等待用户审阅计划并选择执行方式后再实施。
