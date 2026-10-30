-- 质检准确率校准：从已有 AI 结果的会话里抽一批，主管盲评给档位，再和 AI 对照。
-- 目的不是给客服打分，是回答一个问题——「这个分数到底能不能信」。
CREATE TABLE IF NOT EXISTS quality_calibration (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  round_no integer NOT NULL,
  rubric_version text NOT NULL,
  session_id uuid NOT NULL,
  agent text,
  started_at text,
  ai_score numeric(6,2),
  ai_grade text,
  ai_summary text,
  human_grade text,
  human_issue text,
  human_note text,
  marked_by uuid,
  marked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, round_no, session_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES quality_sessions(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS quality_calibration_round_idx
  ON quality_calibration (tenant_id, round_no, created_at);
