CREATE TABLE IF NOT EXISTS sales_structure_settlement_batches(
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 category text NOT NULL CHECK(category='gree-ac'),
 batch_key text NOT NULL CHECK(batch_key ~ '^20[0-9]{4}$'),
 platform text NOT NULL CHECK(platform IN ('京东','天猫')),
 filename text NOT NULL,
 row_count integer NOT NULL,
 positive_units bigint NOT NULL,
 ignored_negative integer NOT NULL,
 ignored_zero integer NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,category,batch_key,platform)
);
CREATE TABLE IF NOT EXISTS sales_structure_settlement_items(
 tenant_id uuid NOT NULL,
 category text NOT NULL,
 batch_key text NOT NULL,
 platform text NOT NULL,
 source_row integer NOT NULL,
 shop_id uuid NOT NULL,
 date date NOT NULL,
 sku text NOT NULL,
 units bigint NOT NULL CHECK(units>0),
 PRIMARY KEY(tenant_id,category,batch_key,platform,source_row),
 FOREIGN KEY(tenant_id,category,batch_key,platform) REFERENCES sales_structure_settlement_batches(tenant_id,category,batch_key,platform) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,shop_id) REFERENCES sales_shops(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS sales_structure_settlement_period ON sales_structure_settlement_items(tenant_id,category,date,shop_id);
CREATE TABLE IF NOT EXISTS sales_structure_shop_aliases(
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 category text NOT NULL CHECK(category='gree-ac'),
 platform text NOT NULL,
 source_name text NOT NULL,
 shop_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,category,platform,source_name),
 FOREIGN KEY(tenant_id,shop_id) REFERENCES sales_shops(tenant_id,id)
);
