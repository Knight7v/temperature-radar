-- 行级安全(RLS):纵深防御层。
-- P0 的"强制"隔离是应用层 WHERE tenant_id(lib/db/queries.js + 鉴权上下文)。
-- 此处仅 ENABLE(不 FORCE):当前 app 以表 owner 身份连接会绕过 RLS,故不影响应用层查询。
-- 后续(非 owner 的受限角色 + 每请求 SET LOCAL app.tenant_id 接线后)改为 FORCE,RLS 即生效。
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users', 'tenant_cities', 'tenant_model_config', 'tenant_push_config',
        'sales_records', 'supply_records', 'predictions', 'push_logs'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format($f$
            DROP POLICY IF EXISTS tenant_isolation ON %I;
            CREATE POLICY tenant_isolation ON %I
            USING (tenant_id::text = current_setting('app.tenant_id', true))
            WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))
        $f$, t, t);
    END LOOP;
END $$;
