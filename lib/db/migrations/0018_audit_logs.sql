-- 操作日志（P2，借鉴 ruoyi-vue-pro / JeecgBoot 的操作日志）：
-- 关键写操作留痕：谁、什么时候、改了什么、改成了什么样。只加不改，删除不级联。
CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_id uuid,
  actor_name text,
  role text,
  action text NOT NULL,
  target_type text,
  target_id text,
  target_label text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_time_idx ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (tenant_id, action, created_at DESC);
