const pool = require("../config/db");
const { getRedisClient } = require("../config/redis");

const BEST_SELLER_SECTION_NAME = "best_seller";
const DEFAULT_BEST_SELLER_LIMIT = 24;
const MAX_BEST_SELLER_LIMIT = 200;

const normalizeLimit = (rawLimit) => {
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_BEST_SELLER_LIMIT;
  return Math.min(parsed, MAX_BEST_SELLER_LIMIT);
};

const collectKeysByPattern = async (redis, pattern) => {
  const keys = [];
  let cursor = "0";

  do {
    const result = await redis.scan(cursor, {
      MATCH: pattern,
      COUNT: 100,
    });

    cursor = result.cursor;
    if (Array.isArray(result.keys) && result.keys.length) {
      keys.push(...result.keys);
    }
  } while (cursor !== "0");

  return keys;
};

const invalidateBestSellerCache = async () => {
  const redis = await getRedisClient();
  if (!redis) return;

  try {
    const keysToDelete = ["homepage:data:v3"];
    const dynamicKeys = await Promise.all([
      collectKeysByPattern(redis, "homepage:data:v3:limit:*"),
      collectKeysByPattern(redis, "homepage:section:best_seller:products:*")
    ]);

    for (const batch of dynamicKeys) {
      if (batch.length) keysToDelete.push(...batch);
    }

    if (keysToDelete.length) {
      await redis.del([...new Set(keysToDelete)]);
    }
  } catch (_) {
    // Cache invalidation is best-effort.
  }
};

const syncBestSellerSection = async ({ limit } = {}) => {
  const normalizedLimit = normalizeLimit(limit);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sectionResult = await client.query(
      `
        SELECT id
        FROM sections
        WHERE name = $1
          AND is_active = true
        LIMIT 1
      `,
      [BEST_SELLER_SECTION_NAME]
    );

    if (!sectionResult.rows.length) {
      await client.query("ROLLBACK");
      return { updated: false, reason: "section_not_found" };
    }

    const sectionId = Number(sectionResult.rows[0].id);

    const bestSellerResult = await client.query(
      `
        SELECT pss.product_id
        FROM product_sales_stats pss
        JOIN products p ON p.id = pss.product_id
        WHERE p.is_active = true
        ORDER BY
          pss.total_sales DESC,
          pss.last_30_days_sales DESC,
          pss.updated_at DESC,
          pss.product_id ASC
        LIMIT $1
      `,
      [normalizedLimit]
    );

    const productIds = bestSellerResult.rows
      .map((row) => Number.parseInt(row.product_id, 10))
      .filter((id) => Number.isInteger(id));

    await client.query(
      `
        DELETE FROM product_sections
        WHERE section_id = $1
      `,
      [sectionId]
    );

    if (productIds.length) {
      await client.query(
        `
          INSERT INTO product_sections (product_id, section_id)
          SELECT t.product_id, $2
          FROM UNNEST($1::int[]) AS t(product_id)
          ON CONFLICT (product_id, section_id) DO NOTHING
        `,
        [productIds, sectionId]
      );
    }

    await client.query("COMMIT");
    await invalidateBestSellerCache();

    return { updated: true, count: productIds.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  syncBestSellerSection,
  invalidateBestSellerCache,
};
