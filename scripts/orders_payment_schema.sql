BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method_enum') THEN
    CREATE TYPE payment_method_enum AS ENUM ('stripe', 'cod');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum') THEN
    CREATE TYPE payment_status_enum AS ENUM ('pending', 'paid', 'failed', 'refunded');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status_enum') THEN
    CREATE TYPE order_status_enum AS ENUM ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled');
  END IF;
END $$;

DO $$
DECLARE
  users_id_udt TEXT;
BEGIN
  SELECT udt_name
  INTO users_id_udt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'id'
  LIMIT 1;

  IF users_id_udt IS NULL THEN
    RAISE EXCEPTION 'users.id column not found';
  END IF;

  IF to_regclass('public.orders') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'id'
        AND udt_name <> 'uuid'
    ) THEN
      IF to_regclass('public.order_items') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE order_items RENAME TO order_items_legacy';
      END IF;
      EXECUTE 'ALTER TABLE orders RENAME TO orders_legacy';
    END IF;
  END IF;

  IF to_regclass('public.orders') IS NULL THEN
    EXECUTE format(
      'CREATE TABLE orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id %s NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        order_number VARCHAR(40) NOT NULL UNIQUE,
        payment_method payment_method_enum NOT NULL,
        payment_status payment_status_enum NOT NULL DEFAULT ''pending'',
        order_status order_status_enum NOT NULL DEFAULT ''pending'',
        financial_status VARCHAR(50) NOT NULL DEFAULT ''unpaid'',
        payment_due_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        is_guest_order BOOLEAN NOT NULL DEFAULT false,
        subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
        tax NUMERIC(12,2) NOT NULL DEFAULT 0,
        shipping_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        discount NUMERIC(12,2) NOT NULL DEFAULT 0,
        total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency CHAR(3) NOT NULL DEFAULT ''AED'',
        stripe_session_id VARCHAR(255),
        stripe_payment_intent_id VARCHAR(255),
        shipping_address_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_order_totals_non_negative CHECK (
          subtotal >= 0 AND tax >= 0 AND shipping_fee >= 0 AND discount >= 0 AND total_amount >= 0
        )
      )',
      users_id_udt
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_snapshot VARCHAR(255) NOT NULL,
  price_snapshot NUMERIC(12,2) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  total_price NUMERIC(12,2) NOT NULL,
  vat_percentage NUMERIC(5,2) DEFAULT 0,
  weight NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill/ensure new columns on existing schemas
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS financial_status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_due_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_guest_order BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS vat_percentage NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weight NUMERIC(10,2);

-- Basic backfill for financial_status and payment_due_amount
DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    UPDATE orders
    SET financial_status = COALESCE(financial_status, 'unpaid');

    UPDATE orders
    SET payment_due_amount = total_amount
    WHERE payment_method = 'cod'
      AND COALESCE(financial_status, 'unpaid') = 'unpaid';

    UPDATE orders
    SET payment_due_amount = 0
    WHERE payment_method = 'stripe'
      AND COALESCE(financial_status, 'unpaid') = 'paid';
  END IF;
END $$;

DO $$
DECLARE
  users_id_udt TEXT;
BEGIN
  SELECT udt_name
  INTO users_id_udt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'id'
  LIMIT 1;

  IF to_regclass('public.stripe_checkout_sessions') IS NULL THEN
    EXECUTE format(
      'CREATE TABLE stripe_checkout_sessions (
        id BIGSERIAL PRIMARY KEY,
        stripe_session_id VARCHAR(255) NOT NULL UNIQUE,
        user_id %s NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        cart_snapshot_json JSONB NOT NULL,
        shipping_address_json JSONB NOT NULL,
        coupon_code VARCHAR(64),
        currency CHAR(3) NOT NULL DEFAULT ''AED'',
        subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
        tax NUMERIC(12,2) NOT NULL DEFAULT 0,
        shipping_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        discount NUMERIC(12,2) NOT NULL DEFAULT 0,
        total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        payment_status payment_status_enum NOT NULL DEFAULT ''pending'',
        processed_at TIMESTAMPTZ,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )',
      users_id_udt
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_stripe_session_id
  ON orders(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_stripe_payment_intent_id
  ON orders(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_financial_status ON orders(financial_status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user_id ON stripe_checkout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_processed_at ON stripe_checkout_sessions(processed_at);

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1000;

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  seq BIGINT;
BEGIN
  seq := nextval('order_number_seq');
  RETURN 'ORD-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(seq::TEXT, 6, '0');
END;
$$;

-- Order status history to track changes over time
CREATE TABLE IF NOT EXISTS order_status_history (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_order_status order_status_enum,
  new_order_status order_status_enum,
  old_financial_status VARCHAR(50),
  new_financial_status VARCHAR(50),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id
  ON order_status_history(order_id, changed_at DESC);

CREATE OR REPLACE FUNCTION log_order_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.order_status IS DISTINCT FROM OLD.order_status)
     OR (NEW.financial_status IS DISTINCT FROM OLD.financial_status) THEN
    INSERT INTO order_status_history (
      order_id,
      old_order_status,
      new_order_status,
      old_financial_status,
      new_financial_status
    ) VALUES (
      NEW.id,
      OLD.order_status,
      NEW.order_status,
      OLD.financial_status,
      NEW.financial_status
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_order_status_history ON orders;

CREATE TRIGGER trg_log_order_status_history
AFTER UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION log_order_status_history();

COMMIT;
