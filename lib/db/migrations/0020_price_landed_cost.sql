-- 比价助手 · 到手价口径改造（2026-11-02 用户拍板）
--
-- 为什么加新列而不是改 p0/p1/p2：
--   p0/p1/p2 的旧语义是「标价 / 最低可得价 / 新客价」，而新口径要的是
--   「标价 → 券后 → 到手」这条链，中间多了一个「国补」环节，且国补不是抓来的、
--   是按规则算出来的。语义变了就换列名，别让半年后的人猜 p1 到底是券后价还是到手价。
--   旧列保留写入（p0=标价, p1=到手价）作为兼容冗余，页面与判价一律读新列。
--
-- 口径链（每一步都必须能单独对账）：
--   listed_price（页面 jdPrice）
--     − promo_amount（可叠加的直减券合计）
--     = after_promo_price（券后价）
--     − subsidy_amount（min(券后价 × 比例, 上限)）
--     = landed_price（到手价 = 主告警口径）
--   恒等式：listed_price >= after_promo_price >= landed_price >= 0

ALTER TABLE price_observations
  ADD COLUMN IF NOT EXISTS listed_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS promo_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS after_promo_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS subsidy_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS subsidy_rate numeric(5, 4),
  ADD COLUMN IF NOT EXISTS landed_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS promo_text text,
  ADD COLUMN IF NOT EXISTS promo_expire_at timestamptz,
  ADD COLUMN IF NOT EXISTS subsidy_flag text,
  ADD COLUMN IF NOT EXISTS landed_confidence text;

-- 趋势图与「当日最低到手价」都按 captured_on + landed_price 扫，单列索引不够用
CREATE INDEX IF NOT EXISTS price_obs_landed_idx
  ON price_observations (tenant_id, captured_on DESC, landed_price);

-- 国补规则：本期用户定「所有机型统一 15% / 上限 1500」，但必须可配——
-- 大促期间国补比例会变（20% 的品类也出现过），写死在代码里就得改一版才能跟。
ALTER TABLE price_settings
  ADD COLUMN IF NOT EXISTS subsidy_rate numeric(5, 4) NOT NULL DEFAULT 0.15,
  ADD COLUMN IF NOT EXISTS subsidy_cap numeric(10, 2) NOT NULL DEFAULT 1500;
