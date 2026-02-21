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
  state VARCHAR(120),
  postal_code VARCHAR(30),
  country VARCHAR(120),
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

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
