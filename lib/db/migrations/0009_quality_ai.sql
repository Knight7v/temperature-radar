CREATE TABLE IF NOT EXISTS quality_ai_results (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  rubric_version text NOT NULL,
  model text NOT NULL,
  score numeric(6,2),
  grade text,
  provisional boolean NOT NULL DEFAULT false,
  needs_review boolean NOT NULL DEFAULT false,
  data jsonb NOT NULL,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES quality_sessions(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS quality_ai_results_session_idx
  ON quality_ai_results (tenant_id, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS quality_ai_results_recent_idx
  ON quality_ai_results (tenant_id, created_at DESC);
