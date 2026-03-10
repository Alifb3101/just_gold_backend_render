-- =========================================================
-- ADD NAILS CATEGORY & SUBCATEGORIES
-- Run this script to add NAILS to an existing database
-- =========================================================

BEGIN;

-- Insert main NAILS category
INSERT INTO categories (name, slug, parent_id)
VALUES ('NAILS', 'nails', NULL)
ON CONFLICT (slug) DO NOTHING;

-- Get NAILS category ID for subcategories
DO $$
DECLARE
  nails_id INTEGER;
BEGIN
  SELECT id INTO nails_id FROM categories WHERE slug = 'nails' AND parent_id IS NULL;
  
  IF nails_id IS NOT NULL THEN
    -- Insert NAILS subcategories
    INSERT INTO categories (name, slug, parent_id) VALUES
      ('All Nails', 'all-nails', nails_id),
      ('Nail Polish', 'nail-polish', nails_id),
      ('Nail Art', 'nail-art', nails_id),
      ('Nail Care', 'nail-care', nails_id),
      ('Nail Tools', 'nail-tools', nails_id),
      ('Nail Sets', 'nail-sets', nails_id)
    ON CONFLICT (slug) DO NOTHING;
    
    RAISE NOTICE 'NAILS category and subcategories added successfully (ID: %)', nails_id;
  ELSE
    RAISE NOTICE 'Failed to create NAILS category';
  END IF;
END $$;

COMMIT;
