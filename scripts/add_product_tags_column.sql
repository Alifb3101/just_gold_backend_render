-- Adds structured JSONB tags to products with a supporting GIN index
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]';

-- Backfill any nulls to an empty array for consistent queries
UPDATE products SET tags = '[]'::jsonb WHERE tags IS NULL;

-- Optional performance index for tag lookups
CREATE INDEX IF NOT EXISTS idx_products_tags
  ON products USING GIN (tags);
