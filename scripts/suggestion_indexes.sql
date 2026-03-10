-- =========================================================
-- SUGGESTION SYSTEM INDEXES (ENHANCED)
-- Run this script to optimize product suggestion queries
-- Supports: scoring formula, brand diversity, sales stats
-- =========================================================

BEGIN;

-- =========================================================
-- PRODUCTS TABLE INDEXES
-- =========================================================

-- Index for similar products query (category + active filter)
-- Optimizes: WHERE category_id = X AND is_active = true
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_category_active 
ON products (category_id, is_active) 
WHERE is_active = true;

-- Index for product lookups by ID with active filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_id_active 
ON products (id) 
WHERE is_active = true;

-- Composite index for sorting by created_at within category
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_category_created 
ON products (category_id, created_at DESC) 
WHERE is_active = true;

-- Index for rating-based sorting (scoring formula)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_category_rating 
ON products (category_id, rating DESC) 
WHERE is_active = true;

-- GIN index for tags JSONB (brand/tag matching in cold start)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_tags_gin 
ON products USING GIN (tags jsonb_path_ops) 
WHERE is_active = true;

-- =========================================================
-- ORDER_ITEMS TABLE INDEXES
-- =========================================================

-- Index for finding orders containing a specific product
-- Critical for "frequently bought together" query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_product_id 
ON order_items (product_id);

-- Index for finding products within an order
-- Optimizes the JOIN in co-purchase aggregation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_order_id 
ON order_items (order_id);

-- Composite index for product-order lookups
-- Covers both query patterns in single index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_product_order 
ON order_items (product_id, order_id);

-- =========================================================
-- PRODUCT_SALES_STATS TABLE INDEXES
-- Pre-aggregated sales for trending optimization
-- =========================================================

-- Primary index for trending queries (30-day sales)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_stats_30days 
ON product_sales_stats (last_30_days_sales DESC);

-- Secondary index for total sales fallback
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_stats_total 
ON product_sales_stats (total_sales DESC);

-- Composite index for combined sorting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_stats_combined 
ON product_sales_stats (last_30_days_sales DESC, total_sales DESC);

COMMIT;

-- =========================================================
-- QUERY ANALYSIS (ENHANCED)
-- Run EXPLAIN ANALYZE to verify index usage
-- =========================================================

/*
-- Similar Products with Scoring Formula
EXPLAIN ANALYZE
WITH product_scores AS (
  SELECT 
    p.id, p.name, p.price, p.main_image_key, p.slug, p.category_id, p.created_at,
    COALESCE(p.rating, 0) AS rating,
    COALESCE(pss.total_sales, 0) AS sales_count,
    GREATEST(0, 1.0 - (EXTRACT(EPOCH FROM NOW() - p.created_at) / (90 * 86400))) AS recency_score
  FROM products p
  LEFT JOIN product_sales_stats pss ON pss.product_id = p.id
  WHERE p.category_id = 1 AND p.id != 123 AND p.is_active = true
)
SELECT *, 
  ((LEAST(sales_count, 1000) / 1000.0 * 0.6) + (rating / 5.0 * 0.3) + (recency_score * 0.1)) AS score
FROM product_scores
ORDER BY score DESC, created_at DESC
LIMIT 24;

-- Trending from Pre-aggregated Stats
EXPLAIN ANALYZE
SELECT p.id, p.name, p.price, p.main_image_key, p.slug,
  pss.last_30_days_sales, pss.total_sales
FROM products p
LEFT JOIN product_sales_stats pss ON pss.product_id = p.id
WHERE p.is_active = true
ORDER BY pss.last_30_days_sales DESC, pss.total_sales DESC
LIMIT 100;

-- Cold Start Fallback (Brand Match)
EXPLAIN ANALYZE
SELECT p.id, p.name, p.price, p.main_image_key, p.slug
FROM products p
LEFT JOIN product_sales_stats pss ON pss.product_id = p.id
WHERE p.is_active = true
  AND p.id NOT IN (1, 2, 3)
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p.tags, '[]'::jsonb)) tag_elem
    WHERE tag_elem->>'type' = 'brand' AND tag_elem->>'code' = 'BRAND_CODE'
  )
ORDER BY pss.total_sales DESC, p.created_at DESC
LIMIT 8;
*/
