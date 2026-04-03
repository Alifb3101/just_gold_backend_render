const pool = require("../config/db");
const { getMediaUrl, resolveMediaUrl } = require("./media.service");


const normalizeQuery = (raw) => {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  if (!value.length) return null;
  return value.toLowerCase();
};

const buildTsQuery = (searchTerm) => {
  if (!searchTerm) return null;
  const tokens = searchTerm
    .split(/\s+/)
    .flatMap((t) => t.split(/[-]+/))
    .map((t) => t.replace(/[^a-zA-Z0-9]+/g, ""))
    .filter((t) => t.length > 0);
  if (!tokens.length) return null;
  return tokens.map((t) => `${t}:*`).join(" & ");
};

const logSearchQuery = (query) => {
  const normalized = normalizeQuery(query);
  if (!normalized) return;

  pool
    .query("INSERT INTO search_logs (query) VALUES ($1)", [normalized])
    .catch((err) => {
      console.warn("[search log] failed", err.message);
    });
};

const fetchSearchSuggestions = async (query) => {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const tsQuery = buildTsQuery(normalized);

  const result = await pool.query({
    text: `
      WITH params AS (
        SELECT $1::text AS tsq, $2::text AS raw_query, $3::text AS raw_like
      )
      SELECT
        p.name,
        p.slug,
        p.thumbnail,
        p.thumbnail_key,
        p.product_model_no,
        CASE
          WHEN params.tsq IS NOT NULL AND p.search_vector @@ to_tsquery('simple', params.tsq)
            THEN ts_rank(p.search_vector, to_tsquery('simple', params.tsq))
          ELSE 0
        END AS rank,
        similarity(p.name_unaccent, params.raw_query) AS sim,
        CASE WHEN p.product_model_no ILIKE params.raw_like THEN 1 ELSE 0 END AS model_match
      FROM params, products p
      WHERE p.is_active = true
        AND (
          (params.tsq IS NOT NULL AND p.search_vector @@ to_tsquery('simple', params.tsq))
          OR p.product_model_no ILIKE params.raw_like
        )
      ORDER BY model_match DESC, rank DESC, sim DESC, length(p.name_unaccent) ASC, p.id ASC
      LIMIT 8
    `,
    values: [tsQuery, normalized, `%${normalized}%`],
  });

  return result.rows.map((row) => ({
    name: row.name,
    slug: row.slug,
    thumbnail: resolveMediaUrl(row.thumbnail, row.thumbnail_key, row.media_provider, 'thumbnail'),
  }));
};

const fetchTrendingQueries = async () => {
  const result = await pool.query({
    text: `
      SELECT query, COUNT(*)::int AS search_count
      FROM search_logs
      WHERE searched_at >= NOW() - INTERVAL '7 days'
      GROUP BY query
      ORDER BY search_count DESC
      LIMIT 10
    `,
    values: [],
  });

  return result.rows;
};

module.exports = {
  fetchSearchSuggestions,
  fetchTrendingQueries,
  logSearchQuery,
};
