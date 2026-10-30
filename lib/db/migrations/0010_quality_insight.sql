-- 消费者洞察：每条会话一份结构化提炼（顾客问了什么 + 客服答得哪里不够）
-- 与 quality_ai_results 刻意分开：质检是“这一单该打几分”，洞察是“顾客在想什么、我们哪里没答好”。
-- 两者互不覆盖，可各自重跑。

CREATE TABLE IF NOT EXISTS quality_insights (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  version text NOT NULL,
  model text,
  stage text NOT NULL DEFAULT 'none',
  topics text[] NOT NULL DEFAULT '{}',
  gaps text[] NOT NULL DEFAULT '{}',
  question_count integer NOT NULL DEFAULT 0,
  unresolved_count integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES quality_sessions(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS quality_insights_session_uidx
  ON quality_insights (tenant_id, session_id);

CREATE INDEX IF NOT EXISTS quality_insights_recent_idx
  ON quality_insights (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS quality_insights_stage_idx
  ON quality_insights (tenant_id, stage);

-- 洞察总结（AI 根据聚合统计写的一段结论 + 行动建议），按筛选范围缓存
CREATE TABLE IF NOT EXISTS quality_insight_reports (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  signature text NOT NULL,
  data jsonb NOT NULL,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS quality_insight_reports_scope_idx
  ON quality_insight_reports (tenant_id, scope, created_at DESC);
