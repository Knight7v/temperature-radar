'use strict';

// 客服档案接口。
//
// 设计要点：
// 1. 一个 list 请求把页面要的全部数据一次给全（档案 + 质检统计 + 未建档昵称 + 店铺下拉 + 枚举），
//    避免为了一张表打四五个接口。
// 2. 昵称唯一性先在应用层查一次，给出「已存在（店铺｜员工）」这种能直接定位的报错；
//    数据库上还有表达式唯一索引兜底，防并发重复。
// 3. 质检统计只读 quality_sessions 与最新一条 AI 结果，不写任何质检表。

const { apiHandler } = require('../lib/http');
const { requireInventoryUser } = require('../lib/inventory/access');
const { getInventoryPool, transact } = require('../lib/db/inventory-client');
const {
  STATUSES,
  ROLES,
  BRAND_GROUPS,
  isRobot,
  normalize,
  validate,
  inferProfile,
  mergeStats,
  summarize,
  ensureServiceAgentSchema,
  key
} = require('../lib/service/agents');

const fail = (message, status = 422) => {
  throw Object.assign(Error(message), { status });
};

const uuid = value => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))) fail('ID 无效');
  return value;
};

async function loadShops(db, tenant) {
  const rows = (
    await db.query(
      `SELECT id,data->>'name' AS name,data->>'brand' AS brand,data->>'platform' AS platform,data->>'status' AS status
         FROM sales_shops WHERE tenant_id=$1 AND coalesce(data->>'name','')<>'' ORDER BY data->>'name'`,
      [tenant]
    )
  ).rows;
  return rows.map(row => ({ id: row.id, name: row.name, brand: row.brand || '', platform: row.platform || '', status: row.status || '' }));
}

/* 每个昵称的会话量、已分析量、平均 AI 分、最近一次会话时间。
   用 LATERAL 取最新一条结果：同一会话重跑过多次时只认最后一版，避免平均分被旧模型拉低。 */
async function loadAgentStats(db, tenant) {
  return (
    await db.query(
      `SELECT s.agent,
              count(*)::int AS sessions,
              count(r.score)::int AS analyzed,
              avg(r.score) AS avg_score,
              max(s.started_at) AS last_at
         FROM quality_sessions s
         LEFT JOIN LATERAL (
              SELECT score FROM quality_ai_results a
               WHERE a.tenant_id=s.tenant_id AND a.session_id=s.id
               ORDER BY a.created_at DESC LIMIT 1
         ) r ON true
        WHERE s.tenant_id=$1 AND coalesce(s.agent,'')<>''
        GROUP BY s.agent`,
      [tenant]
    )
  ).rows;
}

async function listAgents(db, tenant) {
  const [agents, stats, shops] = await Promise.all([
    db.query('SELECT id,data,revision,created_at,updated_at FROM service_agents WHERE tenant_id=$1 ORDER BY created_at', [tenant]),
    loadAgentStats(db, tenant),
    loadShops(db, tenant)
  ]);
  const rows = agents.rows.map(row => ({
    id: row.id,
    data: row.data || {},
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  const merged = mergeStats(rows, stats);
  /* 列表默认按「在职优先 + 店铺 + 昵称」排：主管找人时是照店铺顺序看的 */
  merged.rows.sort((a, b) => {
    const sa = (a.data.status || '在职') === '在职' ? 0 : 1;
    const sb = (b.data.status || '在职') === '在职' ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const shop = String(a.data.shop || '').localeCompare(String(b.data.shop || ''), 'zh-Hans-CN');
    if (shop) return shop;
    return String(a.data.agentName || '').localeCompare(String(b.data.agentName || ''), 'zh-Hans-CN');
  });
  return {
    agents: merged.rows,
    orphans: merged.orphans,
    shops,
    summary: summarize(merged.rows),
    meta: { statuses: STATUSES, roles: ROLES, brandGroups: BRAND_GROUPS }
  };
}

async function assertUniqueName(db, tenant, agentName, exceptId) {
  const hit = (
    await db.query(
      `SELECT id,data FROM service_agents
        WHERE tenant_id=$1 AND lower(btrim(data->>'agentName'))=lower(btrim($2))
          AND ($3::uuid IS NULL OR id<>$3::uuid)`,
      [tenant, agentName, exceptId || null]
    )
  ).rows[0];
  if (!hit) return;
  const data = hit.data || {};
  const where = [data.shop, data.employeeName].filter(Boolean).join(' ｜ ');
  fail('客服名称「' + agentName + '」已经在档案里' + (where ? '（' + where + '）' : '') + '，同一个昵称只能对应一个人');
}

function csvCell(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}

module.exports = apiHandler(async (req, res) => {
  const write = req.method === 'POST';
  const user = await requireInventoryUser(req, write ? ['admin', 'operator'] : ['admin', 'operator', 'viewer']);
  await ensureServiceAgentSchema();
  const db = getInventoryPool();
  const tenant = user.tenantId;
  const action = String(req.query.action || 'list');
  const body = req.body || {};

  if (!write) {
    if (action === 'list') return res.json({ data: await listAgents(db, tenant) });

    if (action === 'export') {
      const { agents } = await listAgents(db, tenant);
      const head = ['客服名称', '员工姓名', '店铺', '品牌组别', '岗位', '状态', '入职日期', '质检会话', '平均AI分', '备注'];
      const lines = [head];
      for (const row of agents) {
        const d = row.data;
        lines.push([
          d.agentName,
          d.employeeName,
          d.shop,
          d.brandGroup,
          d.role,
          d.status || '在职',
          d.joinDate,
          row.stat ? row.stat.sessions : 0,
          row.stat && row.stat.avgScore != null ? row.stat.avgScore : '',
          d.note
        ]);
      }
      /* 加 BOM，Excel 直接双击打开不乱码 */
      const csv = '\ufeff' + lines.map(line => line.map(csvCell).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="service-agents.csv"');
      return res.end(csv);
    }

    fail('操作不存在', 404);
  }

  if (action === 'save') {
    const data = validate(normalize(body));
    const id = body.id ? uuid(body.id) : null;
    return res.json({
      data: await transact(db, async c => {
        await assertUniqueName(c, tenant, data.agentName, id);
        if (id) {
          const updated = await c.query(
            'UPDATE service_agents SET data=$1,revision=revision+1,updated_at=now() WHERE tenant_id=$2 AND id=$3 RETURNING id,revision',
            [data, tenant, id]
          );
          if (!updated.rowCount) fail('这条档案不存在，可能已被删除', 404);
          return { id, revision: updated.rows[0].revision, created: false };
        }
        const inserted = await c.query(
          'INSERT INTO service_agents(tenant_id,data,created_by) VALUES($1,$2,$3) RETURNING id,revision',
          [tenant, data, user.userId]
        );
        return { id: inserted.rows[0].id, revision: inserted.rows[0].revision, created: true };
      })
    });
  }

  if (action === 'delete') {
    const id = uuid(body.id);
    return res.json({
      data: await transact(db, async c => {
        const hit = await c.query('SELECT data FROM service_agents WHERE tenant_id=$1 AND id=$2', [tenant, id]);
        if (!hit.rowCount) fail('这条档案不存在', 404);
        await c.query('DELETE FROM service_agents WHERE tenant_id=$1 AND id=$2', [tenant, id]);
        /* 质检记录按昵称字符串关联，删档案不会动它们，只是这些会话重新变成「未建档」 */
        return { deleted: true, agentName: (hit.rows[0].data || {}).agentName || '' };
      })
    });
  }

  /* 从质检记录带入：把还没建档的昵称先建成草稿，店铺/品牌/岗位能猜的自动填上，人脸和姓名留给主管补 */
  if (action === 'from-quality') {
    const shops = await loadShops(db, tenant);
    const stats = await loadAgentStats(db, tenant);
    const existing = (await db.query("SELECT data->>'agentName' AS name FROM service_agents WHERE tenant_id=$1", [tenant])).rows;
    const known = new Set(existing.map(row => key(row.name)));
    const created = [];
    const skipped = [];
    return res.json({
      data: await transact(db, async c => {
        for (const row of stats) {
          const agentName = String(row.agent || '').trim();
          if (!agentName) continue;
          if (isRobot(agentName)) {
            skipped.push({ agentName, reason: '平台机器人' });
            continue;
          }
          if (known.has(key(agentName))) {
            skipped.push({ agentName, reason: '已有档案' });
            continue;
          }
          const guess = inferProfile(agentName, shops);
          const data = {
            agentName,
            employeeName: '',
            shop: guess.shop,
            shopId: guess.shopId,
            brandGroup: guess.brandGroup,
            role: guess.role,
            status: '在职',
            joinDate: '',
            note: ''
          };
          const inserted = await c.query(
            'INSERT INTO service_agents(tenant_id,data,created_by) VALUES($1,$2,$3) RETURNING id',
            [tenant, data, user.userId]
          );
          known.add(key(agentName));
          created.push({ id: inserted.rows[0].id, ...data, sessions: Number(row.sessions || 0) });
        }
        return { created, skipped };
      })
    });
  }

  fail('操作不存在', 404);
});
