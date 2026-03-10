-- =========================================================
-- PRODUCT SALES STATS TABLE
-- Pre-aggregated sales data for optimized trending queries
-- Run this script to create the table and triggers
-- =========================================================

BEGIN;

-- =========================================================
-- CREATE PRODUCT_SALES_STATS TABLE
-- =========================================================

CREATE TABLE IF NOT EXISTS product_sales_stats (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  total_sales INTEGER NOT NULL DEFAULT 0,
  last_30_days_sales INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for trending queries (sorted by sales)
CREATE INDEX IF NOT EXISTS idx_product_sales_stats_total 
ON product_sales_stats (total_sales DESC);

CREATE INDEX IF NOT EXISTS idx_product_sales_stats_30days 
ON product_sales_stats (last_30_days_sales DESC);

-- Composite index for active products with sales
CREATE INDEX IF NOT EXISTS idx_product_sales_stats_updated 
ON product_sales_stats (updated_at DESC);

-- =========================================================
-- INITIALIZE STATS FROM EXISTING ORDER DATA
-- Populates stats from historical order_items
-- =========================================================

INSERT INTO product_sales_stats (product_id, total_sales, last_30_days_sales, updated_at)
SELECT 
  oi.product_id,
  COALESCE(SUM(oi.quantity), 0) AS total_sales,
  COALESCE(SUM(
    CASE 
      WHEN o.created_at >= NOW() - INTERVAL '30 days' THEN oi.quantity 
      ELSE 0 
    END
  ), 0) AS last_30_days_sales,
  NOW()
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
GROUP BY oi.product_id
ON CONFLICT (product_id) DO UPDATE SET
  total_sales = EXCLUDED.total_sales,
  last_30_days_sales = EXCLUDED.last_30_days_sales,
  updated_at = NOW();

-- =========================================================
-- FUNCTION: UPDATE SALES STATS ON ORDER ITEM INSERT
-- =========================================================

CREATE OR REPLACE FUNCTION update_product_sales_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO product_sales_stats (product_id, total_sales, last_30_days_sales, updated_at)
  VALUES (NEW.product_id, NEW.quantity, NEW.quantity, NOW())
  ON CONFLICT (product_id) DO UPDATE SET
    total_sales = product_sales_stats.total_sales + NEW.quantity,
    last_30_days_sales = product_sales_stats.last_30_days_sales + NEW.quantity,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- TRIGGER: AUTO-UPDATE STATS ON ORDER ITEM INSERT
-- =========================================================

DROP TRIGGER IF EXISTS trg_update_product_sales_stats ON order_items;

CREATE TRIGGER trg_update_product_sales_stats
AFTER INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION update_product_sales_stats();

-- =========================================================
-- FUNCTION: REFRESH 30-DAY SALES (RUN DAILY VIA CRON)
-- Recalculates last_30_days_sales for all products
-- =========================================================

CREATE OR REPLACE FUNCTION refresh_30_day_sales()
RETURNS void AS $$
BEGIN
  UPDATE product_sales_stats pss
  SET 
    last_30_days_sales = COALESCE(
      (
        SELECT SUM(oi.quantity)
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = pss.product_id
          AND o.created_at >= NOW() - INTERVAL '30 days'
      ),
      0
    ),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- =========================================================
-- USAGE NOTES
-- =========================================================

/*
To manually refresh 30-day sales (run daily via cron job):
  SELECT refresh_30_day_sales();

To query trending products efficiently:
  SELECT p.id, p.name, p.price, p.main_image_key, p.slug, pss.total_sales
  FROM products p
  JOIN product_sales_stats pss ON pss.product_id = p.id
  WHERE p.is_active = true
  ORDER BY pss.last_30_days_sales DESC, pss.total_sales DESC
  LIMIT 50;
*/
