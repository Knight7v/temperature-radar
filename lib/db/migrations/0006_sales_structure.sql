CREATE TABLE IF NOT EXISTS sales_structure_models(
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 category text NOT NULL CHECK(category IN ('gree-ac','haier-ac','haier-fridge')),
 sku text NOT NULL,
 tier text CHECK(tier IS NULL OR tier IN ('引流机','普通机','中端机','高端机')),
 is_cabinet boolean,
 PRIMARY KEY(tenant_id,category,sku)
);
CREATE TABLE IF NOT EXISTS sales_structure_daily(
 tenant_id uuid NOT NULL,
 category text NOT NULL CHECK(category IN ('gree-ac','haier-ac','haier-fridge')),
 shop_id uuid NOT NULL,
 date date NOT NULL,
 sku text NOT NULL,
 units bigint NOT NULL CHECK(units>=0),
 PRIMARY KEY(tenant_id,category,shop_id,date,sku),
 FOREIGN KEY(tenant_id,shop_id) REFERENCES sales_shops(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS sales_structure_daily_period ON sales_structure_daily(tenant_id,category,date,shop_id);
CREATE TABLE IF NOT EXISTS sales_structure_previews(
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS sales_structure_imports(
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 category text NOT NULL,
 filename text NOT NULL,
 row_count integer NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
