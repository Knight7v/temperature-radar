/* 产品知识库列表的「排序口径」集中在这里，好处有两个：
   ① 排序规则只有一份，改口径不会漏掉导出的那份；
   ② 不用连数据库就能测——把生成的 SQL 和映射结果拿出来断言，
      将来谁把「零销量排在后面」这条去掉，测试会立刻失败。

口径（2026-10-28 用户拍板）：
- 默认按「累计销量」从多到少，主销型号靠前，符合日常使用习惯；
- 有销量的永远排在零销量之前（不是「0 台混在中间」）；
- 同台数时按分销机型 → 系列 → 型号收口，保证顺序稳定、刷新不乱跳；
- 销量来源是销售结构里那张「免扣款结算表」（店铺×日×物料编码×台数），
  靠物料编码与知识库对上，全部累计、不按月份截断。 */

const SALES_ITEM_TABLE = 'public.sales_structure_settlement_items';
const SALES_SCOPES = new Set(['sales', 'series', 'updated']);

const ORDER_SALES = `CASE WHEN coalesce(s.units,0)>0 THEN 0 ELSE 1 END,
            coalesce(s.units,0) DESC,
            (p.data->>'distribution'='分销机型') DESC NULLS LAST,
            p.data->>'series' NULLS LAST, p.data->>'model'`;
const ORDER_SERIES = `p.data->>'series' NULLS LAST, p.data->>'model'`;
const ORDER_UPDATED = `(p.data->>'distribution'='分销机型') DESC NULLS LAST, p.updated_at DESC`;

function normalizeSort(value) {
  const sort = String(value || '');
  return SALES_SCOPES.has(sort) ? sort : 'sales';
}

/* hasSales：这个环境有没有销量表（单独迁移建的，没跑过迁移的环境要能降级，不能把列表搞挂） */
function buildListQuery({ tenant, group = '', q = '', sort = 'sales', hasSales = false } = {}) {
  const order = normalizeSort(sort);
  const args = [tenant];
  let where = '';
  if (group) {
    args.push(group);
    where += ` AND p.data->>'group'=$${args.length}`;
  }
  if (q) {
    args.push(`%${String(q).slice(0, 40)}%`);
    where += ` AND (p.data->>'model' ILIKE $${args.length} OR p.data->>'name' ILIKE $${args.length}` +
      ` OR p.data->>'shopSeries' ILIKE $${args.length} OR p.data->>'series' ILIKE $${args.length}` +
      ` OR p.data->>'materialCode' ILIKE $${args.length})`;
  }

  const orderBy = hasSales
    ? { sales: ORDER_SALES, series: ORDER_SERIES, updated: ORDER_UPDATED }[order]
    : (order === 'series' ? ORDER_SERIES : ORDER_UPDATED);

  /* 销量列不管按什么排都带上：切到「按系列」时也要看得见每台卖了多少，
     少了这一列主管会以为数据丢了。 */
  const sql = hasSales
    ? `SELECT p.id,p.data,p.revision,p.created_at,p.updated_at,
              coalesce(s.units,0)::bigint AS units, s.last_date
         FROM product_knowledge p
         LEFT JOIN (SELECT sku, sum(units)::bigint AS units, max(date) AS last_date
                      FROM sales_structure_settlement_items
                     WHERE tenant_id=$1 GROUP BY sku) s
                ON s.sku = p.data->>'materialCode'
        WHERE p.tenant_id=$1${where}
        ORDER BY ${orderBy}`
    : `SELECT p.id,p.data,p.revision,p.created_at,p.updated_at
         FROM product_knowledge p
        WHERE p.tenant_id=$1${where}
        ORDER BY ${orderBy}`;

  return { sql, args, order, hasSales };
}

function dateText(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/* units：0 = 没有结算记录（不是「卖不动」的结论）；null = 这个环境压根没有销量表 */
function mapProductRow(row) {
  return {
    id: row.id,
    data: row.data || {},
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    units: row.units == null ? null : Number(row.units),
    lastSaleDate: dateText(row.last_date)
  };
}

function mapSalesTotals(row) {
  const data = row || {};
  return {
    units: Number(data.units || 0),
    from: dateText(data.from_date),
    to: dateText(data.to_date),
    skus: Number(data.skus || 0),
    shops: Number(data.shops || 0)
  };
}

module.exports = {
  SALES_ITEM_TABLE,
  SALES_SCOPES,
  ORDER_SALES,
  ORDER_SERIES,
  ORDER_UPDATED,
  normalizeSort,
  buildListQuery,
  mapProductRow,
  mapSalesTotals
};
