-- Create user_addresses table for multiple saved addresses per user
CREATE TABLE IF NOT EXISTS user_addresses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(50) DEFAULT 'Home',
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city VARCHAR(120),
  emirate VARCHAR(120),
  country VARCHAR(120) DEFAULT 'United Arab Emirates',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Ensure emirate and country shape exists for existing deployments
ALTER TABLE user_addresses
  ADD COLUMN IF NOT EXISTS emirate VARCHAR(120);

ALTER TABLE user_addresses
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS postal_code;

ALTER TABLE user_addresses
  ALTER COLUMN country SET DEFAULT 'United Arab Emirates';

UPDATE user_addresses
SET country = 'United Arab Emirates'
WHERE country IS NULL;

-- Add contact and address snapshot to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address JSONB;

-- Ensure only one default per user (soft constraint via partial unique index)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'user_addresses_one_default'
  ) THEN
    CREATE UNIQUE INDEX user_addresses_one_default
      ON user_addresses(user_id)
      WHERE is_default IS TRUE;
  END IF;
END $$;
