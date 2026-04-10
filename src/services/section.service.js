const pool = require("../config/db");
const { getRedisClient } = require("../config/redis");

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const CACHE_TTL_SECONDS = 600;
const SECTION_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{1,49}$/;
const SECTION_ID_CACHE_TTL_MS = 5 * 60 * 1000;
const sectionIdMemoryCache = new Map();

const normalizeLimit = (rawLimit) => {
  const parsed = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIMIT;
  if (parsed < 1) return 1;
  if (parsed > MAX_LIMIT) return MAX_LIMIT;
  return parsed;
};

const normalizeSectionName = (rawSectionName) => {
  if (typeof rawSectionName !== "string") return null;

  const sectionName = rawSectionName.trim().toLowerCase();
  if (!sectionName || !SECTION_NAME_REGEX.test(sectionName)) return null;

  return sectionName;
};

const buildCacheKey = (sectionName, limit) =>
  `homepage:section:${sectionName}:products:${limit}`;

const getSectionId = async (sectionName) => {
  const cached = sectionIdMemoryCache.get(sectionName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.id;
  }

  const sectionResult = await pool.query(
    `
      SELECT id
      FROM sections
      WHERE name = $1
      AND is_active = true
      LIMIT 1
    `,
    [sectionName]
  );

  if (!sectionResult.rows.length) {
    sectionIdMemoryCache.delete(sectionName);
    return null;
  }

  const sectionId = sectionResult.rows[0].id;
  sectionIdMemoryCache.set(sectionName, {
    id: sectionId,
    expiresAt: Date.now() + SECTION_ID_CACHE_TTL_MS,
  });

  return sectionId;
};

const getSectionProducts = async ({ sectionName, limit }) => {
  const sectionId = await getSectionId(sectionName);
  if (!sectionId) {
    const notFoundError = new Error("Section not found");
    notFoundError.status = 404;
    throw notFoundError;
  }

  const cacheKey = buildCacheKey(sectionName, limit);
  const redis = await getRedisClient();

  if (redis) {
    try {
      const cachedPayload = await redis.get(cacheKey);
      if (cachedPayload) return JSON.parse(cachedPayload);
    } catch (_) {
      // Silent fallback to DB for reliability
    }
  }

  const query = {
    text: `
      SELECT
        p.id,
        p.name,
        p.slug,
        p.thumbnail,
        p.base_price AS price,
        COALESCE(pss.total_sales, 0) AS total_sales,
        COALESCE(pss.last_30_days_sales, 0) AS last_30_days_sales
      FROM products p
      JOIN product_sections ps ON p.id = ps.product_id
      LEFT JOIN product_sales_stats pss ON pss.product_id = p.id
      WHERE ps.section_id = $1
      AND p.is_active = true
      ORDER BY
        CASE WHEN $3::text = 'best_seller' THEN COALESCE(pss.total_sales, 0) END DESC,
        CASE WHEN $3::text = 'best_seller' THEN COALESCE(pss.last_30_days_sales, 0) END DESC,
        p.id DESC
      LIMIT $2
    `,
    values: [sectionId, limit, sectionName],
  };

  const result = await pool.query(query);

  const payload = {
    section: sectionName,
    products: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      thumbnail: row.thumbnail,
      price: Number(row.price),
    })),
  };

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(payload), { EX: CACHE_TTL_SECONDS });
    } catch (_) {
      // Silent cache write failure
    }
  }

  return payload;
};

const getHomepageSections = async ({ sectionNames, limit }) => {
  const entries = await Promise.all(
    sectionNames.map(async (sectionName) => {
      try {
        const data = await getSectionProducts({ sectionName, limit });
        return [sectionName, data.products];
      } catch (error) {
        if (error && error.status === 404) {
          return [sectionName, []];
        }
        throw error;
      }
    })
  );

  return Object.fromEntries(entries);
};

module.exports = {
  DEFAULT_LIMIT,
  normalizeLimit,
  normalizeSectionName,
  getSectionProducts,
  getHomepageSections,
};
