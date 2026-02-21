-- Enable extensions required for full-text search and trigram similarity
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add materialized columns (avoid IMMUTABLE requirement on generated columns)
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE products ADD COLUMN IF NOT EXISTS name_unaccent text;

-- Backfill existing rows
UPDATE products
SET
  search_vector = to_tsvector('simple', unaccent(coalesce(name, '') || ' ' || coalesce(description, ''))),
  name_unaccent = unaccent(coalesce(name, ''))
WHERE search_vector IS NULL OR name_unaccent IS NULL;

-- Trigger to keep columns in sync on insert/update
CREATE OR REPLACE FUNCTION products_search_tsvector_trigger()
RETURNS trigger AS $$
BEGIN
  NEW.name_unaccent := unaccent(coalesce(NEW.name, ''));
  NEW.search_vector := to_tsvector('simple', NEW.name_unaccent || ' ' || unaccent(coalesce(NEW.description, '')));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_search_update ON products;
CREATE TRIGGER trg_products_search_update
BEFORE INSERT OR UPDATE OF name, description
ON products
FOR EACH ROW
EXECUTE FUNCTION products_search_tsvector_trigger();

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_products_search_vector_gin
  ON products USING GIN (search_vector);

-- Trigram index for typo tolerance on precomputed unaccented names
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING GIN (name_unaccent gin_trgm_ops);

-- Table to log searches for trending analytics
CREATE TABLE IF NOT EXISTS search_logs (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  searched_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Indexes to keep search log lookups fast
CREATE INDEX IF NOT EXISTS idx_search_logs_query_trgm
  ON search_logs USING GIN (query gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_logs_searched_at
  ON search_logs (searched_at);

-- Optional maintenance to keep planner stats fresh
ANALYZE products;
ANALYZE search_logs;
