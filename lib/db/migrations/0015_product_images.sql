-- 产品详情图片（2026-10-28）：格力系统导出的详情图 / 详情头图压缩包导入。
--
-- 命名规则：主数据编码(序号).jpg，序号即图片顺序。
-- 主数据编码 → 型号的对应关系存在 product_knowledge.data.masterCode 里
-- （官方主数据表导入时带上，存量数据用 scripts/backfill-master-code.js 补）。
--
-- 一台机器可能多颜色多个主数据编码（知识库按型号合并颜色），所以键里带 master_code，
-- 展示时按 编码+序号 排。重复导入 = 覆盖（ON CONFLICT 走主键）。

CREATE TABLE IF NOT EXISTS product_images (
  tenant_id uuid NOT NULL,
  product_key text NOT NULL,      -- matchKey(型号)：大写、去空格、剥颜色括号
  master_code text NOT NULL,      -- 主数据编码（格力系统里的数字编码）
  kind text NOT NULL,             -- main = 商品主图（详情头图）/ detail = 商品详情
  idx integer NOT NULL,           -- 文件名括号里的序号
  name text NOT NULL,
  mime text NOT NULL,
  bytes integer NOT NULL,
  data text NOT NULL,             -- base64
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_key, master_code, kind, idx)
);

CREATE INDEX IF NOT EXISTS product_images_key_idx
  ON product_images (tenant_id, product_key);
