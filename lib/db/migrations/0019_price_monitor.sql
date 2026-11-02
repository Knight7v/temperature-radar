-- 竞品到手价监控（价格监控 / 比价助手）
--
-- 为什么不用「一张表一个 jsonb data」的老约定：
-- 这个模块的核心操作是「同一机型下取最低价」「连续 N 天取中位数」「价差与比例比较」，
-- 全是对数字做 min/排序/区间筛选。数字塞进 jsonb 就变成字符串比较、用不上索引、
-- 还得把整表拉回 Node 再算。所以这里用真实列（numeric/timestamptz），
-- 只在 observations.raw 里留一份原始报文（排查改版用）。
--
-- 结构是「机型 → 链接 → 快照」三层：
--   price_models        一个机型（如 格力云锦Ⅲ 1.5匹），判价和告警都以它为单位
--   price_links         机型下的具体链接，side 区分我方(own)/竞品(competitor)
--   price_observations  每次采集一条快照，含 P0/P1/P2 三价与采集状态
-- 判价不按链接做：同一个机型 5 家竞店都便宜只报一条告警（见 lib/price/evaluate.js）。

-- ① 配置：阈值、采样时点、推送口径。一个租户一行。
CREATE TABLE IF NOT EXISTS price_settings (
  tenant_id uuid PRIMARY KEY,
  amount_threshold numeric(10, 2) NOT NULL DEFAULT 3,
  rate_threshold numeric(8, 5) NOT NULL DEFAULT 0.003,
  full_time text NOT NULL DEFAULT '10:00',
  focus_time text NOT NULL DEFAULT '20:00',
  notify_mode text NOT NULL DEFAULT 'major',
  new_user_mode text NOT NULL DEFAULT 'separate',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ② 机型：判价与告警的单位
CREATE TABLE IF NOT EXISTS price_models (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  model_key text NOT NULL,
  brand text NOT NULL,
  series text,
  code text,
  capacity text,
  name text,
  priority boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- 同一租户内一个归一型号只能有一条机型记录，否则同一台机器会被拆成两条告警
CREATE UNIQUE INDEX IF NOT EXISTS price_models_key_uq
  ON price_models (tenant_id, model_key);
CREATE INDEX IF NOT EXISTS price_models_brand_idx
  ON price_models (tenant_id, brand, status);

-- ③ 链接：我方和竞品共用一张表，靠 side 区分
CREATE TABLE IF NOT EXISTS price_links (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL,
  side text NOT NULL,
  jd_sku text,
  url text NOT NULL,
  shop_id text,
  shop_name text,
  title text,
  priority boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  verify_state text NOT NULL DEFAULT 'confirmed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT price_links_side_ck CHECK (side IN ('own', 'competitor')),
  CONSTRAINT price_links_verify_ck CHECK (verify_state IN ('pending', 'confirmed')),
  CONSTRAINT price_links_model_fk FOREIGN KEY (tenant_id, model_id)
    REFERENCES price_models (tenant_id, id) ON DELETE CASCADE
);

-- 同一个链接不能重复挂（批量粘贴去重靠这条）
CREATE UNIQUE INDEX IF NOT EXISTS price_links_url_uq
  ON price_links (tenant_id, url);
CREATE INDEX IF NOT EXISTS price_links_model_idx
  ON price_links (tenant_id, model_id, side, status);

-- ④ 采集快照：每采一次写一条。失败的也写，否则无法区分「今天没采」和「采了但没采到」
CREATE TABLE IF NOT EXISTS price_observations (
  tenant_id uuid NOT NULL,
  id bigserial,
  link_id uuid NOT NULL,
  run_id uuid,
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_on date NOT NULL,
  status text NOT NULL,
  p0 numeric(10, 2),
  p1 numeric(10, 2),
  p2 numeric(10, 2),
  confidence text,
  source text,
  reason text,
  raw jsonb,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT price_obs_status_ck CHECK (status IN ('ok', 'failed', 'blocked', 'delisted')),
  CONSTRAINT price_obs_link_fk FOREIGN KEY (tenant_id, link_id)
    REFERENCES price_links (tenant_id, id) ON DELETE CASCADE
);

-- 取「每条链接今天最后一次快照」走这个
CREATE INDEX IF NOT EXISTS price_obs_link_time_idx
  ON price_observations (tenant_id, link_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS price_obs_day_idx
  ON price_observations (tenant_id, captured_on DESC);

-- ⑤ 采集轮次：一轮一行。页面顶部的「最近采集 / 部分失败 / 被风控中断」都来自这里
CREATE TABLE IF NOT EXISTS price_runs (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slot text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  total_links integer NOT NULL DEFAULT 0,
  ok_links integer NOT NULL DEFAULT 0,
  failed_links integer NOT NULL DEFAULT 0,
  login_state text,
  catchup boolean NOT NULL DEFAULT false,
  note text,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT price_runs_status_ck
    CHECK (status IN ('running', 'success', 'partial', 'failed', 'blocked', 'degraded'))
);

CREATE INDEX IF NOT EXISTS price_runs_time_idx
  ON price_runs (tenant_id, started_at DESC);

-- ⑥ 告警：一个机型同一时间只允许一条「进行中」的记录
-- status: open 待处理 / ignored 人工忽略 / handled 已处理 / recovered 已回升
CREATE TABLE IF NOT EXISTS price_alerts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  own_price numeric(10, 2),
  competitor_price numeric(10, 2),
  gap numeric(10, 2),
  gap_rate numeric(8, 5),
  competitor_shop text,
  competitor_link_id uuid,
  other_lower integer NOT NULL DEFAULT 0,
  confidence text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  resolved_at timestamptz,
  note text,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT price_alerts_status_ck
    CHECK (status IN ('open', 'ignored', 'handled', 'recovered')),
  CONSTRAINT price_alerts_model_fk FOREIGN KEY (tenant_id, model_id)
    REFERENCES price_models (tenant_id, id) ON DELETE CASCADE
);

-- 一个机型只能有一条未结束的告警（open/ignored/handled），回升后才允许再开新的一条。
-- 这是「同一机型不重复打扰」的最后一道防线：即使程序判断错了，数据库也不让写第二条。
CREATE UNIQUE INDEX IF NOT EXISTS price_alerts_active_uq
  ON price_alerts (tenant_id, model_id)
  WHERE status IN ('open', 'ignored', 'handled');

CREATE INDEX IF NOT EXISTS price_alerts_time_idx
  ON price_alerts (tenant_id, first_seen_at DESC);
