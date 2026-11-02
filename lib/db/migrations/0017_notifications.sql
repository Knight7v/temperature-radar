-- 站内信/通知中心 + 定时任务运行史（P1）
-- notification_reads：通知是实时算出来的「待办」，这里只存「谁在什么时候读掉了哪条」；
--   alert_key 带日期（如 missing:2026-10-29），第二天生成新键，自然重新提醒。
-- task_runs：三个定时任务每次跑完记一条，供「定时任务」看板显示上次执行时间/结果。
CREATE TABLE IF NOT EXISTS notification_reads (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  alert_key text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, alert_key)
);

CREATE TABLE IF NOT EXISTS task_runs (
  id bigserial PRIMARY KEY,
  task_name text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL DEFAULT true,
  detail text
);
CREATE INDEX IF NOT EXISTS task_runs_name_time_idx ON task_runs (task_name, ran_at DESC);
