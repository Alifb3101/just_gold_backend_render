/* =========================================================
   PRODUCT SUGGESTION SERVICE (ENHANCED)
   - Similar products (scoring formula with diversity)
   - Frequently bought together (with cold start fallback)
   - Trending products (pre-aggregated stats table)
   
   Optimizations:
   - Pre-aggregated sales stats table (no runtime aggregation)
   - Scoring formula: sales(0.6) + rating(0.3) + recency(0.1)
   - Brand diversity: max 2 products per brand
   - Redis caching with intelligent invalidation
   - Parallel query execution
   - Cold start fallback for sparse data
========================================================= */

const pool = require("../config/db");
const { getRedisClient } = require("../config/redis");

/* =========================================================
   CONFIGURATION
========================================================= */

const SUGGESTION_LIMIT = 8;
const COLD_START_THRESHOLD = 4;
const MAX_PER_BRAND = 2;
const CACHE_TTL_SECONDS = 300; // 5 minutes
const TRENDING_CACHE_TTL_SECONDS = 600; // 10 minutes
const RECENCY_DAYS = 90; // Products older than this get 0 recency score

/* =========================================================
   SCORING WEIGHTS
========================================================= */

const WEIGHTS = {
  sales: 0.7,
  recency: 0.3,
};

/* =========================================================
   CACHE HELPERS
========================================================= */

const buildCacheKey = (productId, section) => {
  return `suggestions:v2:${productId}:${section}`;
};

const getCachedData = async (key) => {
  try {
    const redis = await getRedisClient();
    if (!redis) return null;
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

const setCachedData = async (key, data, ttl = CACHE_TTL_SECONDS) => {
  try {
    const redis = await getRedisClient();
    if (!redis) return;
    await redis.setEx(key, ttl, JSON.stringify(data));
  } catch {
    // Silently fail - cache is optional
  }
};

/* =========================================================
   PRODUCT FIELD MAPPING
   Returns minimal product fields with transformed image URL
========================================================= */

const mapProductFields = (row) => ({
  id: row.id,
  name: row.name,
  price: parseFloat(row.base_price),
  main_image: row.thumbnail,
  slug: row.slug,
});

/* =========================================================
   BRAND DIVERSITY FILTER
   Limits results to max N products per brand/category combo
========================================================= */

const applyBrandDiversity = (products, maxPerBrand = MAX_PER_BRAND) => {
  const brandCount = new Map();
  const result = [];

  for (const product of products) {
    // Extract brand from tags or use category as fallback
    const brand = product.brand || product.category_id || "unknown";
    const count = brandCount.get(brand) || 0;

    if (count < maxPerBrand) {
      result.push(product);
      brandCount.set(brand, count + 1);
    }

    if (result.length >= SUGGESTION_LIMIT) break;
  }

  return result;
};

/* =========================================================
   1) SIMILAR PRODUCTS (ENHANCED)
   - Scoring: (sales * 0.7) + (recency * 0.3)
   - Recency: 1.0 for new, decreasing to 0 for 90+ days old
   - Brand diversity applied
   - Uses pre-aggregated sales stats
========================================================= */

const getSimilarProducts = async (productId, categoryId) => {
  const cacheKey = buildCacheKey(productId, "similar");
  const cached = await getCachedData(cacheKey);
  if (cached) return cached;

  // Fetch more than limit to allow diversity filtering
  const query = `
    WITH product_scores AS (
      SELECT 
        p.id,
        p.name,
        p.base_price,
        p.thumbnail,
        p.slug,
        p.category_id,
        p.created_at,
        COALESCE(pss.total_sales, 0) AS sales_count,
        COALESCE(p.category_id::text, 'unknown') AS brand,
        -- Recency score: 1.0 for today, decreasing to 0 for 90+ days old
        GREATEST(0, 1.0 - (EXTRACT(EPOCH FROM NOW() - p.created_at) / (${RECENCY_DAYS} * 86400))) AS recency_score
      FROM products p
      LEFT JOIN product_sales_stats pss ON pss.product_id = p.id
      WHERE p.category_id = $1
        AND p.id != $2
        AND p.is_active = true
    )
    SELECT 
      *,
      -- Composite score formula: sales (70%) + recency (30%)
      (
        (LEAST(sales_count, 1000) / 1000.0 * ${WEIGHTS.sales}) +
        (recency_score * ${WEIGHTS.recency})
      ) AS score
    FROM product_scores
    ORDER BY score DESC, created_at DESC
    LIMIT $3
  `;

  const { rows } = await pool.query(query, [categoryId, productId, SUGGESTION_LIMIT * 3]);
  
  // Apply brand diversity
  const diverseProducts = applyBrandDiversity(rows);
  const products = diverseProducts.map(mapProductFields);

  await setCachedData(cacheKey, products);
  return products;
};

/* =========================================================
   2) FREQUENTLY BOUGHT TOGETHER (WITH COLD START FALLBACK)
   - Primary: Co-purchase analysis from order_items
   - Fallback 1: Same brand products
   - Fallback 2: Same tags products
   - Fallback 3: Same category products
========================================================= */

const getFrequentlyBoughtTogether = async (productId) => {
  const cacheKey = buildCacheKey(productId, "bought_together");
  const cached = await getCachedData(cacheKey);
  if (cached) return cached;

  // Primary query: co-purchase analysis
  const primaryQuery = `
    WITH product_orders AS (
      SELECT DISTINCT order_id
      FROM order_items
      WHERE product_id = $1
    )
    SELECT 
      p.id,
      p.name,
      p.base_price,
      p.thumbnail,
      p.slug,
      p.category_id,
      COALESCE(p.category_id::text, 'unknown') AS brand,
      COUNT(DISTINCT oi.order_id) AS co_purchase_count
    FROM order_items oi
    INNER JOIN product_orders po ON oi.order_id = po.order_id
    INNER JOIN products p ON p.id = oi.product_id
    WHERE oi.product_id != $1
      AND p.is_active = true
    GROUP BY p.id
    ORDER BY co_purchase_count DESC, p.created_at DESC
    LIMIT $2
  `;

  const { rows: primaryRows } = await pool.query(primaryQuery, [productId, SUGGESTION_LIMIT * 3]);
  let diverseProducts = applyBrandDiversity(primaryRows);
  let products = diverseProducts.map(mapProductFields);

  // Cold start fallback if not enough results
  if (products.length < COLD_START_THRESHOLD) {
    const existingIds = products.map((p) => p.id);
    existingIds.push(productId);
    
    // Fetch product category for fallback
    const { rows: productRows } = await pool.query(
      'SELECT category_id FROM products WHERE id = $1',
      [productId]
    );
    const productCategory = productRows[0] || { category_id: null };
    
    const fallbackProducts = await getColdStartFallback(
      productId,
      productCategory,
      existingIds,
      SUGGESTION_LIMIT - products.length
    );
    
    products = [...products, ...fallbackProducts];
  }

  await setCachedData(cacheKey, products);
  return products;
};

/* =========================================================
   COLD START FALLBACK
   - Same brand → Same tags → Same category
========================================================= */

const getColdStartFallback = async (productId, productData, excludeIds, limit) => {
  const { category_id: categoryId } = productData;

  if (!categoryId) {
    return []; // No fallback criteria available
  }

  const query = `
    SELECT 
      p.id,
      p.name,
      p.base_price,
      p.thumbnail,
      p.slug,
      p.category_id,
      COALESCE(p.category_id::text, 'unknown') AS brand,
      COALESCE(pss.total_sales, 0) AS sales_count
    FROM products p
    LEFT JOIN product_sales_stats pss ON pss.product_id = p.id
    WHERE p.category_id = $1
      AND p.id != ALL($2::int[])
      AND p.is_active = true
    ORDER BY sales_count DESC, p.created_at DESC
    LIMIT $3
  `;

  const { rows } = await pool.query(query, [categoryId, excludeIds, limit * 2]);
  const diverseProducts = applyBrandDiversity(rows);
  return diverseProducts.slice(0, limit).map(mapProductFields);
};

/* =========================================================
   3) TRENDING PRODUCTS (OPTIMIZED)
   - Uses pre-aggregated product_sales_stats table
   - No runtime aggregation on order_items
   - Prioritizes last_30_days_sales for recency
========================================================= */

const getTrendingProducts = async (excludeIds = []) => {
  const cacheKey = "suggestions:v2:trending:global";
  const cached = await getCachedData(cacheKey);

  // If cached, filter out excluded IDs and apply diversity
  if (cached) {
    const filtered = cached.filter((p) => !excludeIds.includes(p.id));
    return filtered.slice(0, SUGGESTION_LIMIT);
  }

  // Optimized query using pre-aggregated stats table
  const query = `
    SELECT 
      p.id,
      p.name,
      p.base_price,
      p.thumbnail,
      p.slug,
      p.category_id,
      COALESCE(p.category_id::text, 'unknown') AS brand,
      COALESCE(pss.last_30_days_sales, 0) AS recent_sales,
      COALESCE(pss.total_sales, 0) AS total_sales
    FROM products p
    LEFT JOIN product_sales_stats pss ON pss.product_id = p.id
    WHERE p.is_active = true
    ORDER BY recent_sales DESC, total_sales DESC, p.created_at DESC
    LIMIT 100
  `;

  const { rows } = await pool.query(query);
  
  // Apply brand diversity and cache full list
  const diverseProducts = applyBrandDiversity(rows, MAX_PER_BRAND * 2);
  const products = diverseProducts.map(mapProductFields);

  await setCachedData(cacheKey, products, TRENDING_CACHE_TTL_SECONDS);

  // Return filtered results
  const filtered = products.filter((p) => !excludeIds.includes(p.id));
  return filtered.slice(0, SUGGESTION_LIMIT);
};

/* =========================================================
   MAIN SUGGESTION AGGREGATOR
   - Fetches product data first (for fallback criteria)
   - Parallel fetches for all three sections
   - Excludes duplicates across sections
========================================================= */

const getProductSuggestions = async (productId) => {
  // Fetch product with category for fallback logic
  const productQuery = `
    SELECT id, category_id
    FROM products 
    WHERE id = $1 AND is_active = true
  `;
  const { rows: productRows } = await pool.query(productQuery, [productId]);

  if (productRows.length === 0) {
    return null; // Product not found
  }

  const productData = productRows[0];
  const { category_id: categoryId } = productData;

  // Fetch similar and frequently bought together in parallel
  const [similarProducts, frequentlyBoughtTogether] = await Promise.all([
    getSimilarProducts(productId, categoryId),
    getFrequentlyBoughtTogether(productId),
  ]);

  // Collect IDs already shown to exclude from trending
  const shownIds = new Set([
    productId,
    ...similarProducts.map((p) => p.id),
    ...frequentlyBoughtTogether.map((p) => p.id),
  ]);

  // Fetch trending products, excluding already shown
  const trendingProducts = await getTrendingProducts([...shownIds]);

  return {
    similarProducts,
    frequentlyBoughtTogether,
    trendingProducts,
  };
};

/* =========================================================
   CACHE INVALIDATION
   - Call when orders are placed or products updated
========================================================= */

const invalidateSuggestionCache = async (productId = null) => {
  try {
    const redis = await getRedisClient();
    if (!redis) return;

    if (productId) {
      // Invalidate specific product suggestions
      await redis.del(buildCacheKey(productId, "similar"));
      await redis.del(buildCacheKey(productId, "bought_together"));
    }

    // Always invalidate trending cache on order changes
    await redis.del("suggestions:v2:trending:global");
  } catch {
    // Silently fail
  }
};

/* =========================================================
   UPDATE SALES STATS (Call from order service)
   - Incremental update when order is placed
   - More efficient than trigger for high-traffic scenarios
========================================================= */

const updateSalesStats = async (productIds, quantities) => {
  if (!productIds?.length) return;

  const aggregated = new Map();
  for (let i = 0; i < productIds.length; i++) {
    const productId = Number.parseInt(productIds[i], 10);
    const quantity = Number.parseInt(quantities?.[i], 10) || 1;
    if (!Number.isInteger(productId) || quantity <= 0) continue;
    aggregated.set(productId, (aggregated.get(productId) || 0) + quantity);
  }

  if (!aggregated.size) return;

  const ids = [...aggregated.keys()];
  const qty = ids.map((id) => aggregated.get(id));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO product_sales_stats (product_id, total_sales, last_30_days_sales, updated_at)
        SELECT id, qty, qty, NOW()
        FROM UNNEST($1::int[], $2::int[]) AS t(id, qty)
        ON CONFLICT (product_id) DO UPDATE SET
          total_sales = product_sales_stats.total_sales + EXCLUDED.total_sales,
          last_30_days_sales = product_sales_stats.last_30_days_sales + EXCLUDED.last_30_days_sales,
          updated_at = NOW()
      `,
      [ids, qty]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to update sales stats:", err.message);
  } finally {
    client.release();
  }
};

const subtractSalesStats = async (productIds, quantities) => {
  if (!productIds?.length) return;

  const aggregated = new Map();
  for (let i = 0; i < productIds.length; i++) {
    const productId = Number.parseInt(productIds[i], 10);
    const quantity = Number.parseInt(quantities?.[i], 10) || 1;
    if (!Number.isInteger(productId) || quantity <= 0) continue;
    aggregated.set(productId, (aggregated.get(productId) || 0) + quantity);
  }

  if (!aggregated.size) return;

  const ids = [...aggregated.keys()];
  const qty = ids.map((id) => aggregated.get(id));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
        UPDATE product_sales_stats
        SET total_sales = GREATEST(total_sales - qty, 0),
            last_30_days_sales = GREATEST(last_30_days_sales - qty, 0),
            updated_at = NOW()
        FROM UNNEST($1::int[], $2::int[]) AS t(product_id, qty)
        WHERE product_sales_stats.product_id = t.product_id
      `,
      [ids, qty]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to subtract sales stats:", err.message);
  } finally {
    client.release();
  }
};

module.exports = {
  getProductSuggestions,
  getSimilarProducts,
  getFrequentlyBoughtTogether,
  getTrendingProducts,
  invalidateSuggestionCache,
  updateSalesStats,
  subtractSalesStats,
  SUGGESTION_LIMIT,
};
