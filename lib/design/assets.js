'use strict';

// 素材库：把"出过的图"变成可检索的记录。
//
// 三条设计原则：
// 1. 图存磁盘、元数据存库。图片体积大，塞进 jsonb 会让每次列表查询都拖着几十 MB；
//    库里只记路径，前端直接 <img src> 预览，还吃得上浏览器缓存。
// 2. 内容相同不重复存。同一张图连点两次"存进素材库"，用 sha1 指纹命中已有记录直接返回。
// 3. 生成背景本身就落盘了（assets/design/generated），入库时只登记不复制，
//    靠 managed 标记区分"这张文件归素材库管"还是"归生成目录管"。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../assets/design/library');
const URL_PREFIX = '/assets/design/library';
const GENERATED_PREFIX = '/assets/design/generated';
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_ZIP_BYTES = 40 * 1024 * 1024;
const MAX_ZIP_ITEMS = 40;
const PAGE_SIZE = 24;

const PURPOSES = Object.freeze([
  { id: 'first', name: '京东首图' },
  { id: 'scene', name: '场景副图' },
  { id: 'promo', name: '活动图' },
  { id: 'deal', name: '大促主图' },
  { id: 'background', name: 'AI 背景' }
]);

const STATUSES = Object.freeze([
  { id: 'draft', name: '草稿' },
  { id: 'review', name: '待审' },
  { id: 'approved', name: '通过' },
  { id: 'archived', name: '归档' }
]);

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function fail(message, status = 422, code) {
  throw Object.assign(Error(message), { status, code });
}

function meta() {
  return {
    purposes: PURPOSES,
    statuses: STATUSES,
    maxBytes: MAX_BYTES,
    pageSize: PAGE_SIZE,
    zipMaxItems: MAX_ZIP_ITEMS
  };
}

function stamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function monthDir(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}`;
}

// data:image/png;base64,xxx → { buffer, mime }
function decodeDataUrl(input, maxBytes = MAX_BYTES) {
  const raw = String(input || '');
  const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.*)$/);
  if (!match) fail('图片格式不支持，请用 PNG、JPG 或 WebP');
  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const payload = match[2].replace(/\s/g, '');
  if (!payload) fail('图片内容为空，请重新导出后再存');
  if (!/^[A-Za-z0-9+/=]+$/.test(payload)) fail('图片内容不是标准的 base64，请重新导出');
  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length) fail('图片内容为空，请重新导出后再存');
  if (buffer.length > maxBytes) fail(`图片超过 ${Math.round(maxBytes / 1024 / 1024)} MB，请压缩后再处理`);
  return { buffer, mime };
}

function writeFile(buffer, mime) {
  const dir = path.join(ROOT, monthDir());
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 10);
  const name = `${stamp()}-${hash}.${MIME_EXT[mime] || 'png'}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  return { url: `${URL_PREFIX}/${monthDir()}/${name}`, file: `${monthDir()}/${name}` };
}

function removeFile(file) {
  if (!file) return;
  const full = path.resolve(ROOT, file);
  // 只允许删素材库目录内的文件，防止脏数据把别处的图删掉
  if (!full.startsWith(ROOT)) return;
  try {
    fs.rmSync(full, { force: true });
  } catch {
    // 文件已不在也不该阻断删记录
  }
}

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

// 入库前的清洗：非法用途回落到"场景副图"，状态只认四种，成本按元收两位小数。
function normalize(input = {}) {
  const purpose = PURPOSES.some(item => item.id === input.purpose) ? input.purpose : 'scene';
  const status = STATUSES.some(item => item.id === input.status) ? input.status : 'draft';
  const cost = Number(input.cost);
  return {
    sku: text(input.sku, 40).toUpperCase(),
    title: text(input.title, 60),
    purpose,
    status,
    width: Math.max(0, Math.min(20000, Number(input.width) || 0)),
    height: Math.max(0, Math.min(20000, Number(input.height) || 0)),
    model: text(input.model, 80),
    prompt: text(input.prompt, 1500),
    scene: text(input.scene, 40),
    size: text(input.size, 20),
    cost: Number.isFinite(cost) ? Math.max(0, Math.min(1000, Math.round(cost * 100) / 100)) : 0,
    source: input.source === 'ai' ? 'ai' : 'local',
    note: text(input.note, 200)
  };
}

function shape(row) {
  const data = row.data || {};
  return {
    id: row.id,
    sku: data.sku || '',
    title: data.title || '',
    purpose: data.purpose || 'scene',
    status: data.status || 'draft',
    width: data.width || 0,
    height: data.height || 0,
    model: data.model || '',
    prompt: data.prompt || '',
    scene: data.scene || '',
    size: data.size || '',
    cost: Number(data.cost || 0),
    source: data.source || 'local',
    note: data.note || '',
    url: data.url || '',
    bytes: Number(data.bytes || 0),
    hash: data.hash || '',
    createdBy: data.createdByName || '',
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function list(db, tenant, query = {}) {
  const purpose = PURPOSES.some(item => item.id === query.purpose) ? query.purpose : '';
  const status = STATUSES.some(item => item.id === query.status) ? query.status : '';
  const from = DATE_RE.test(String(query.from || '')) ? query.from : '';
  const to = DATE_RE.test(String(query.to || '')) ? query.to : '';
  const keyword = text(query.q, 60);
  const pageSize = Math.min(60, Math.max(1, Number(query.pageSize) || PAGE_SIZE));
  const page = Math.max(1, Number(query.page) || 1);
  const offset = (page - 1) * pageSize;
  const like = keyword ? `%${keyword}%` : '';

  const where = `tenant_id=$1
    AND ($2='' OR data->>'purpose'=$2)
    AND ($3='' OR coalesce(data->>'status','draft')=$3)
    AND ($4='' OR created_at >= $4::date)
    AND ($5='' OR created_at < ($5::date + interval '1 day'))
    AND ($6='' OR coalesce(data->>'sku','') ILIKE $6
                 OR coalesce(data->>'title','') ILIKE $6
                 OR coalesce(data->>'model','') ILIKE $6
                 OR coalesce(data->>'prompt','') ILIKE $6)`;
  const params = [tenant, purpose, status, from, to, like];

  const [rows, counted, summary] = await Promise.all([
    db.query(
      `SELECT id,data,revision,created_at,updated_at FROM design_assets
        WHERE ${where} ORDER BY created_at DESC LIMIT $7 OFFSET $8`,
      [...params, pageSize, offset]
    ),
    db.query(`SELECT count(*)::int AS total FROM design_assets WHERE ${where}`, params),
    db.query(
      `SELECT count(*)::int AS total,
              coalesce(sum((data->>'bytes')::bigint),0)::bigint AS bytes,
              coalesce(sum((data->>'cost')::numeric),0) AS cost,
              count(*) FILTER (WHERE data->>'purpose'='background')::int AS backgrounds,
              count(*) FILTER (WHERE data->>'sku'<>'')::int AS with_sku
         FROM design_assets WHERE tenant_id=$1`,
      [tenant]
    )
  ]);

  const total = counted.rows[0]?.total || 0;
  return {
    items: rows.rows.map(shape),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      total: summary.rows[0]?.total || 0,
      bytes: Number(summary.rows[0]?.bytes || 0),
      cost: Number(summary.rows[0]?.cost || 0),
      backgrounds: summary.rows[0]?.backgrounds || 0,
      withSku: summary.rows[0]?.with_sku || 0
    },
    meta: meta()
  };
}

// 去重口径：内容相同 + 型号相同 + 用途相同才算重复。
// 只看内容会把「同一张图既有首图用途、又有场景用途」这种情况误判成重复，
// 只按型号又会把改过文案的新图挡掉。
async function findDuplicate(db, tenant, data) {
  const hit = await db.query(
    `SELECT id,data,revision,created_at,updated_at FROM design_assets
      WHERE tenant_id=$1 AND data->>'hash'=$2
        AND coalesce(data->>'sku','')=coalesce($3,'')
        AND coalesce(data->>'purpose','')=coalesce($4,'')
      ORDER BY created_at LIMIT 1`,
    [tenant, data.hash, data.sku, data.purpose]
  );
  return hit.rowCount ? shape(hit.rows[0]) : null;
}

// 前端直接传 base64（画布产物拿不到服务器路径），或传一张已落盘的 AI 背景 url。
async function save(db, tenant, user, payload = {}) {
  const data = normalize(payload);
  if (!data.sku && !data.title) fail('请先填型号或商品名称，否则以后搜不到这张图');

  let buffer = null;
  let file = '';
  let url = '';
  let managed = false;

  const incoming = String(payload.dataUrl || '');
  if (incoming) {
    const decoded = decodeDataUrl(incoming);
    buffer = decoded.buffer;
    data.hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
    const dup = await findDuplicate(db, tenant, data);
    if (dup) return { asset: dup, duplicate: true };

    const saved = writeFile(buffer, decoded.mime);
    file = saved.file;
    url = saved.url;
    managed = true;
  } else {
    // 复用已有的生成结果：只登记，不复制文件
    const sourceUrl = String(payload.url || '');
    if (!sourceUrl.startsWith(GENERATED_PREFIX) && !sourceUrl.startsWith(URL_PREFIX)) {
      fail('缺少图片内容，无法入库');
    }
    url = sourceUrl;
    data.hash = crypto.createHash('sha1').update(sourceUrl).digest('hex').slice(0, 16);
    const dup = await findDuplicate(db, tenant, data);
    if (dup) return { asset: dup, duplicate: true };
  }

  if (buffer) data.bytes = buffer.length;
  else data.bytes = Number(payload.bytes) || 0;
  data.url = url;
  data.file = file;
  data.managed = managed;
  // 鉴权上下文只带 userId，没有昵称；存图时补查一次，方便以后追"这张图谁出的"
  try {
    const owner = await db.query('SELECT identifier FROM users WHERE id=$1 AND tenant_id=$2', [
      (user && user.userId) || null,
      tenant
    ]);
    data.createdByName = text(owner.rows[0] && owner.rows[0].identifier, 40);
  } catch {
    data.createdByName = '';
  }

  const inserted = await db.query(
    'INSERT INTO design_assets(tenant_id,data,created_by) VALUES($1,$2,$3) RETURNING id,data,revision,created_at,updated_at',
    [tenant, data, (user && user.userId) || null]
  );
  return { asset: shape(inserted.rows[0]), duplicate: false };
}

async function update(db, tenant, id, patch = {}) {
  const hit = await db.query('SELECT id,data,revision,created_at,updated_at FROM design_assets WHERE tenant_id=$1 AND id=$2', [
    tenant,
    id
  ]);
  if (!hit.rowCount) fail('这张图不在素材库里，可能已被删除', 404);
  const current = hit.rows[0].data || {};
  const next = { ...current };
  if (patch.status !== undefined) {
    if (!STATUSES.some(item => item.id === patch.status)) fail('状态不合法');
    next.status = patch.status;
  }
  if (patch.title !== undefined) next.title = text(patch.title, 60);
  if (patch.sku !== undefined) next.sku = text(patch.sku, 40).toUpperCase();
  if (patch.note !== undefined) next.note = text(patch.note, 200);
  if (patch.purpose !== undefined) {
    if (!PURPOSES.some(item => item.id === patch.purpose)) fail('用途不合法');
    next.purpose = patch.purpose;
  }
  const updated = await db.query(
    'UPDATE design_assets SET data=$1,revision=revision+1,updated_at=now() WHERE tenant_id=$2 AND id=$3 RETURNING id,data,revision,created_at,updated_at',
    [next, tenant, id]
  );
  return shape(updated.rows[0]);
}

// 删记录 + 删文件。只删自己管的文件：AI 背景仍归生成目录的轮转清理管，
// 这里若顺手删掉，别的记录（或页面上正在预览的图）会突然 404。
async function remove(db, tenant, id) {
  const hit = await db.query('SELECT data FROM design_assets WHERE tenant_id=$1 AND id=$2', [tenant, id]);
  if (!hit.rowCount) fail('这张图不在素材库里', 404);
  const data = hit.rows[0].data || {};
  await db.query('DELETE FROM design_assets WHERE tenant_id=$1 AND id=$2', [tenant, id]);
  if (data.managed) removeFile(data.file);
  return { deleted: true, file: data.file || '' };
}

async function zipMany(db, tenant, { sku = '', ids = [] } = {}) {
  const picked = Array.isArray(ids) ? ids.filter(id => /^[0-9a-f-]{36}$/i.test(String(id))).slice(0, MAX_ZIP_ITEMS) : [];
  const rows = picked.length
    ? (
        await db.query(
          `SELECT id,data FROM design_assets WHERE tenant_id=$1 AND id = ANY($2::uuid[]) ORDER BY created_at`,
          [tenant, picked]
        )
      ).rows
    : (
        await db.query(
          `SELECT id,data FROM design_assets
            WHERE tenant_id=$1 AND ($2='' OR data->>'sku'=$2)
            ORDER BY created_at LIMIT $3`,
          [tenant, text(sku, 40).toUpperCase(), MAX_ZIP_ITEMS]
        )
      ).rows;

  const entries = [];
  let bytes = 0;
  const missing = [];
  for (const row of rows) {
    const data = row.data || {};
    const rel = String(data.url || '');
    const full = rel.startsWith(URL_PREFIX)
      ? path.resolve(ROOT, rel.slice(URL_PREFIX.length + 1))
      : rel.startsWith(GENERATED_PREFIX)
        ? path.resolve(__dirname, '../../assets/design/generated', rel.slice(GENERATED_PREFIX.length + 1))
        : '';
    if (!full || !fs.existsSync(full)) {
      missing.push(row.id);
      continue;
    }
    const buffer = fs.readFileSync(full);
    if (bytes + buffer.length > MAX_ZIP_BYTES) {
      missing.push(row.id);
      continue;
    }
    bytes += buffer.length;
    const ext = path.extname(full) || '.png';
    // 压缩包里的文件名只用 ASCII：中文名在不同解压软件里编码不一致，
    // Windows 自带解压、部分老版 WinRAR 会把 UTF-8 名字显示成乱码。
    // 型号本身就是最好的标识，中文用途放在库页面里看。
    const label = [data.sku || 'asset', data.purpose || 'image', row.id.slice(0, 6)].join('-');
    entries.push({ name: `${label}${ext}`, data: buffer, date: new Date(row.created_at || Date.now()) });
  }
  if (!entries.length) fail('这些图在服务器上找不到文件，可能已被清理', 404);
  return { entries, missing, bytes };
}

module.exports = {
  ROOT,
  URL_PREFIX,
  PURPOSES,
  STATUSES,
  MAX_BYTES,
  meta,
  normalize,
  decodeDataUrl,
  shape,
  list,
  save,
  update,
  remove,
  zipMany
};
