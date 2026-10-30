-- 产品知识库：把详情页里的外观、卖点、参数、售后口径，结构化存下来。
--
-- 为什么要单独一张表：质检与洞察回答「客服答得好不好」，但要说出「应该怎么答」，
-- 必须有一份可核对的商品事实。这份事实只从详情页来，不靠模型记忆，也不靠人凭印象填。
--
-- data 结构（JSON）：
--   group       分组 id：gree-ac / haier-ac / haier-fridge
--   model       型号（唯一键的一半，另一个是 group）
--   name        商品标题
--   appearance  外观：[{label,value}]
--   features    卖点：[{title,detail,keywords[],stage,evidence,needsReview}]
--   params      参数：[{name,value,unit,evidence,needsReview}]
--   service     售后口径：[{name,value}]
--   source      来源：{type,name,chars,importedAt,aiUsed}
CREATE TABLE IF NOT EXISTS product_knowledge (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- 同一分组下型号唯一：同型号重复导入走合并，不再多建一条。
-- 型号统一大写、去掉空格，写成表达式索引，导入时用 ON CONFLICT 兜底防并发。
CREATE UNIQUE INDEX IF NOT EXISTS product_knowledge_model_uq
  ON product_knowledge (tenant_id, (data->>'group'), upper(regexp_replace(coalesce(data->>'model',''), '\s+', '', 'g')));

CREATE INDEX IF NOT EXISTS product_knowledge_group_idx
  ON product_knowledge (tenant_id, (data->>'group'), updated_at DESC);

CREATE INDEX IF NOT EXISTS product_knowledge_updated_idx
  ON product_knowledge (tenant_id, updated_at DESC);

-- 会话级修正建议：一个「会话 × 产品」一份。
-- 同一对重复生成直接覆盖（口径升级后重跑就是新版），按 version 判断是否过期。
CREATE TABLE IF NOT EXISTS product_advice (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  product_id uuid NOT NULL,
  version text NOT NULL,
  data jsonb NOT NULL,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES quality_sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_id) REFERENCES product_knowledge(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS product_advice_pair_uq
  ON product_advice (tenant_id, session_id, product_id);

CREATE INDEX IF NOT EXISTS product_advice_product_idx
  ON product_advice (tenant_id, product_id, updated_at DESC);
