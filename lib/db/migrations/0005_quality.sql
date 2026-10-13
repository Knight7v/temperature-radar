CREATE TABLE IF NOT EXISTS quality_previews (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_hash text NOT NULL,
  filename text NOT NULL,
  data jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id)
);
CREATE TABLE IF NOT EXISTS quality_imports (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_hash text NOT NULL,
  filename text NOT NULL,
  summary jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,source_hash)
);
CREATE TABLE IF NOT EXISTS quality_sessions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL,
  ordinal integer NOT NULL,
  agent text NOT NULL,
  started_at text NOT NULL,
  ended_at text NOT NULL,
  data jsonb NOT NULL,
  review jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','draft','reviewed')),
  revision integer NOT NULL DEFAULT 0,
  reviewed_by uuid,
  reviewed_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,import_id,ordinal),
  FOREIGN KEY (tenant_id,import_id) REFERENCES quality_imports(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS quality_sessions_recent ON quality_sessions (tenant_id,started_at DESC);
CREATE TABLE IF NOT EXISTS quality_review_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  review jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,session_id) REFERENCES quality_sessions(tenant_id,id)
);
