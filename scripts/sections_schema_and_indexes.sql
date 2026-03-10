BEGIN;

CREATE TABLE IF NOT EXISTS sections (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_sections_name_lowercase CHECK (name = LOWER(name))
);

CREATE TABLE IF NOT EXISTS product_sections (
  product_id INT REFERENCES products(id) ON DELETE CASCADE,
  section_id INT REFERENCES sections(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, section_id)
);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

UPDATE sections
SET name = LOWER(name)
WHERE name <> LOWER(name);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_sections_name_lowercase'
  ) THEN
    ALTER TABLE sections
      ADD CONSTRAINT chk_sections_name_lowercase
      CHECK (name = LOWER(name));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_sections_section_id
  ON product_sections(section_id);

CREATE INDEX IF NOT EXISTS idx_product_sections_product_id
  ON product_sections(product_id);

CREATE INDEX IF NOT EXISTS idx_sections_name
  ON sections(name);

CREATE INDEX IF NOT EXISTS idx_products_is_active
  ON products(is_active);

CREATE INDEX IF NOT EXISTS idx_products_id
  ON products(id);

COMMIT;
