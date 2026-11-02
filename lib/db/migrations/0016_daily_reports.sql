-- 每日经营日报：定时生成 + 推送记录（幂等，一天最多推一次）
CREATE TABLE IF NOT EXISTS daily_reports (
  tenant_id uuid NOT NULL,
  report_date date NOT NULL,
  data jsonb NOT NULL,
  pushed_at timestamptz,
  push_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, report_date)
);
