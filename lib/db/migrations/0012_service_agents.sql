-- 客服档案：把聊天记录里的昵称，对上真人、店铺和品牌组。
--
-- 质检表 quality_sessions.agent 存的是一串昵称（如「格力旗舰店售前-阿伟」），
-- 同一客服换昵称就会变成两个人，离职了也看不出来。档案表是唯一能把昵称翻译成「谁」的地方，
-- 所以 agent_name 在同一租户内必须唯一——一个昵称只能对应一个人。
CREATE TABLE IF NOT EXISTS service_agents (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- 昵称唯一：空昵称不参与（建表时可能先存草稿），大小写与前后空格视为同一个
CREATE UNIQUE INDEX IF NOT EXISTS service_agents_name_uq
  ON service_agents (tenant_id, lower(btrim(data->>'agentName')));

CREATE INDEX IF NOT EXISTS service_agents_shop_idx
  ON service_agents (tenant_id, (data->>'shop'));

CREATE INDEX IF NOT EXISTS service_agents_created_idx
  ON service_agents (tenant_id, created_at DESC);
