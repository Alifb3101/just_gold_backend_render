-- Cart and wishlist tables (idempotent, safe to rerun)
BEGIN;

/* ---------------- CART ITEMS ---------------- */

-- Ensure table exists (covers fresh setups)
CREATE TABLE IF NOT EXISTS cart_items (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  product_variant_id BIGINT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price_at_added NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill/align columns for existing installs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cart_items' AND column_name = 'product_variant_id'
  ) THEN
    ALTER TABLE cart_items ADD COLUMN product_variant_id BIGINT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cart_items' AND column_name = 'quantity'
  ) THEN
    ALTER TABLE cart_items ADD COLUMN quantity INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cart_items' AND column_name = 'price_at_added'
  ) THEN
    ALTER TABLE cart_items ADD COLUMN price_at_added NUMERIC(12,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cart_items' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE cart_items ADD COLUMN updated_at TIMESTAMPTZ;
  END IF;
END$$;

-- Normalize column types and defaults
ALTER TABLE cart_items
  ALTER COLUMN user_id TYPE BIGINT,
  ALTER COLUMN product_id TYPE BIGINT,
  ALTER COLUMN product_variant_id TYPE BIGINT,
  ALTER COLUMN product_variant_id DROP NOT NULL,
  ALTER COLUMN quantity SET NOT NULL,
  ALTER COLUMN quantity SET DEFAULT 1,
  ALTER COLUMN price_at_added SET NOT NULL,
  ALTER COLUMN price_at_added SET DEFAULT 0,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

-- Basic backfill to satisfy NOT NULL
UPDATE cart_items SET quantity = COALESCE(quantity, 1);
UPDATE cart_items SET price_at_added = COALESCE(price_at_added, 0);
UPDATE cart_items SET updated_at = COALESCE(updated_at, NOW());

-- Constraints (skip if already present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_user_variant_key'
  ) THEN
    ALTER TABLE cart_items
      DROP CONSTRAINT cart_items_user_variant_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_user_fk'
  ) THEN
    ALTER TABLE cart_items
      ADD CONSTRAINT cart_items_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_product_fk'
  ) THEN
    ALTER TABLE cart_items
      ADD CONSTRAINT cart_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_variant_fk'
  ) THEN
    ALTER TABLE cart_items
      ADD CONSTRAINT cart_items_variant_fk FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE CASCADE;
  END IF;
END$$;

-- Uniqueness rules:
-- 1) one row per (user, variant) when variant exists
-- 2) one row per (user, product) when variant is NULL (no-variant product)
CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_user_variant_not_null
  ON cart_items(user_id, product_variant_id)
  WHERE product_variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_user_product_no_variant
  ON cart_items(user_id, product_id)
  WHERE product_variant_id IS NULL;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_variant ON cart_items(product_variant_id);

/* ---------------- WISHLIST ITEMS ---------------- */

-- Ensure table exists
CREATE TABLE IF NOT EXISTS wishlist_items (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  product_id BIGINT,
  product_variant_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Align columns for existing installs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wishlist_items' AND column_name = 'product_id'
  ) THEN
    ALTER TABLE wishlist_items ADD COLUMN product_id BIGINT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wishlist_items' AND column_name = 'product_variant_id'
  ) THEN
    ALTER TABLE wishlist_items ADD COLUMN product_variant_id BIGINT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wishlist_items' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE wishlist_items ADD COLUMN created_at TIMESTAMPTZ;
  END IF;
END$$;

-- Normalize column types/defaults
ALTER TABLE wishlist_items
  ALTER COLUMN user_id TYPE BIGINT,
  ALTER COLUMN product_id TYPE BIGINT,
  ALTER COLUMN product_variant_id TYPE BIGINT,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

-- Backfill product_id for existing variant-based rows
UPDATE wishlist_items wi
SET product_id = pv.product_id
FROM product_variants pv
WHERE wi.product_id IS NULL
  AND wi.product_variant_id = pv.id;

-- Ensure product_id is present
ALTER TABLE wishlist_items
  ALTER COLUMN product_id SET NOT NULL;

-- Constraints
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wishlist_items_user_variant_key'
  ) THEN
    ALTER TABLE wishlist_items
      DROP CONSTRAINT wishlist_items_user_variant_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wishlist_items_user_fk'
  ) THEN
    ALTER TABLE wishlist_items
      ADD CONSTRAINT wishlist_items_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wishlist_items_product_fk'
  ) THEN
    ALTER TABLE wishlist_items
      ADD CONSTRAINT wishlist_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wishlist_items_variant_fk'
  ) THEN
    ALTER TABLE wishlist_items
      ADD CONSTRAINT wishlist_items_variant_fk FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE CASCADE;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_wishlist_user_variant_not_null
  ON wishlist_items(user_id, product_variant_id)
  WHERE product_variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_wishlist_user_product_no_variant
  ON wishlist_items(user_id, product_id)
  WHERE product_variant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist_items(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_product ON wishlist_items(product_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_variant ON wishlist_items(product_variant_id);

COMMIT;
