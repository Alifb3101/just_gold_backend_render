const { getRedisClient } = require("../config/redis");
const { fetchHomepageProducts } = require("../repositories/homepage.repository");
const { getMediaUrl } = require("./media.service");

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const CACHE_TTL_SECONDS = 600;
const CACHE_KEY = "homepage:data:v2";
const HOMEPAGE_SECTIONS = ["best_seller", "new_arrivals", "deal_of_the_day", "trending"];

const normalizeLimit = (rawLimit) => {
  const parsed = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIMIT;
  if (parsed < 1) return 1;
  if (parsed > MAX_LIMIT) return MAX_LIMIT;
  return parsed;
};

const buildPayload = (rows) => {
  const payload = {
    best_seller: [],
    new_arrivals: [],
    deal_of_the_day: [],
  };

  const sectionSeen = {
    best_seller: new Set(),
    new_arrivals: new Set(),
    deal_of_the_day: new Set(),
  };

  for (const row of rows) {
    const sectionName = row.section_name === "trending" ? "deal_of_the_day" : row.section_name;
    if (!payload[sectionName]) continue;
    if (sectionSeen[sectionName].has(row.id)) continue;
    sectionSeen[sectionName].add(row.id);

    payload[sectionName].push({
      id: row.id,
      name: row.name,
      description: row.description,
      thumbnail: row.thumbnail_key ? getMediaUrl(row.thumbnail_key) : row.thumbnail,
      price: Number(row.price),
      discount_price: row.discount_price !== null ? Number(row.discount_price) : null,
    });
  }

  return payload;
};

const getHomepageData = async ({ rawLimit }) => {
  const limit = normalizeLimit(rawLimit);
  const redis = await getRedisClient();

  const cacheKey = limit === DEFAULT_LIMIT ? CACHE_KEY : `${CACHE_KEY}:limit:${limit}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (_) {
      // Fallback to database on cache read failure
    }
  }

  const rows = await fetchHomepageProducts({
    sectionNames: HOMEPAGE_SECTIONS,
    limit,
  });

  const payload = buildPayload(rows);

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(payload), { EX: CACHE_TTL_SECONDS });
    } catch (_) {
      // Ignore cache write failures
    }
  }

  return payload;
};

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  getHomepageData,
};
