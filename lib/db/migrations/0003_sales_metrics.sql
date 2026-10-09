ALTER TABLE sales_daily ADD COLUMN IF NOT EXISTS visitors bigint CHECK(visitors IS NULL OR visitors>=0);
ALTER TABLE sales_daily ADD COLUMN IF NOT EXISTS views bigint CHECK(views IS NULL OR views>=0);
ALTER TABLE sales_daily ADD COLUMN IF NOT EXISTS conversion_rate numeric(10,8) CHECK(conversion_rate IS NULL OR (conversion_rate>=0 AND conversion_rate<=1));
ALTER TABLE sales_daily ADD COLUMN IF NOT EXISTS customers bigint CHECK(customers IS NULL OR customers>=0);
ALTER TABLE sales_daily ADD COLUMN IF NOT EXISTS avg_order_cents bigint CHECK(avg_order_cents IS NULL OR avg_order_cents>=0);
