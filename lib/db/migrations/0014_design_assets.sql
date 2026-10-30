-- 视觉设计 1.0：素材库、批量任务、用量。
--
-- 背景：图纸一直落在磁盘目录里，只能靠文件名找，三个月前的图等于丢了。
-- 这里把「图」变成一条可检索的记录：谁出的、哪个型号、什么用途、花了多少钱、审过没有。
--
-- 沿用项目约定：一张表一个 jsonb data + revision，业务字段放 data 里。
-- 这样加字段不用改表结构，前端拿到什么就能用什么。

-- ① 素材库：一张成品图 / 一张 AI 背景 = 一条记录
CREATE TABLE IF NOT EXISTS design_assets (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- 列表默认按时间倒序翻页
CREATE INDEX IF NOT EXISTS design_assets_created_idx
  ON design_assets (tenant_id, created_at DESC);

-- 按型号找图（客服问「某型号有没有图」时走这个）
CREATE INDEX IF NOT EXISTS design_assets_sku_idx
  ON design_assets (tenant_id, (data->>'sku'));

-- 按用途筛（首图 / 场景 / 活动 / 背景）
CREATE INDEX IF NOT EXISTS design_assets_purpose_idx
  ON design_assets (tenant_id, (data->>'purpose'));

-- 同内容去重：同一张图重复点「存进素材库」不该存两份
CREATE INDEX IF NOT EXISTS design_assets_hash_idx
  ON design_assets (tenant_id, (data->>'hash'));

-- ② 批量任务：1.0-c 的套图排队用，先建好表，避免再开一次迁移
CREATE TABLE IF NOT EXISTS design_jobs (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS design_jobs_status_idx
  ON design_jobs (tenant_id, (data->>'status'), created_at DESC);

-- ③ 用量：每调用一次图像服务写一行，月底算钱靠它
CREATE TABLE IF NOT EXISTS design_usage (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS design_usage_created_idx
  ON design_usage (tenant_id, created_at DESC);
