const pool = require("../config/db");
const { getMediaUrl } = require("./media.service");

const resolveMediaUrl = (key, url) => {
  if (key) return getMediaUrl(key);
  return url || null;
};

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
  if (!tsQuery) return [];

  const result = await pool.query({
    text: `
      WITH params AS (
        SELECT $1::text AS q
      )
      SELECT
        p.name,
        p.slug,
        p.thumbnail,
        p.thumbnail_key,
        ts_rank(p.search_vector, to_tsquery('simple', params.q)) AS rank,
        similarity(p.name_unaccent, params.q) AS sim
      FROM params, products p
      WHERE p.is_active = true
        AND p.search_vector @@ to_tsquery('simple', params.q)
      ORDER BY rank DESC, sim DESC, length(p.name_unaccent) ASC, p.id ASC
      LIMIT 8
    `,
    values: [tsQuery],
  });

  return result.rows.map((row) => ({
    name: row.name,
    slug: row.slug,
    thumbnail: resolveMediaUrl(row.thumbnail_key, row.thumbnail),
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
