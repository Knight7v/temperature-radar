ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'supply_chain';

CREATE TABLE inventory_replenishment_plans (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 date date NOT NULL,
 sku text NOT NULL,
 warehouse text NOT NULL,
 data jsonb NOT NULL DEFAULT '{}'::jsonb,
 revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,date,sku,warehouse)
);

CREATE TABLE inventory_replenishment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 event_key text NOT NULL,
 kind text NOT NULL,
 data jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0,
 attempted_at timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 UNIQUE(tenant_id,event_key)
);
CREATE INDEX inventory_replenishment_events_pending ON inventory_replenishment_events(status,created_at) WHERE status='pending';
