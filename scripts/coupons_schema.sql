-- Creates coupons and coupon_usages tables with required fields
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(64) UNIQUE NOT NULL,
  discount_type varchar(32) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value numeric(12,2) NOT NULL CHECK (discount_value >= 0),
  min_order_amount numeric(12,2) NOT NULL DEFAULT 0,
  max_discount_amount numeric(12,2),
  usage_limit integer,
  used_count integer NOT NULL DEFAULT 0,
  per_user_limit integer,
  start_date timestamptz,
  end_date timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_usages (
  id bigserial PRIMARY KEY,
  coupon_id uuid REFERENCES coupons(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  user_id integer,
  guest_token uuid,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (coupon_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON coupon_usages(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_user ON coupon_usages(user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_guest ON coupon_usages(guest_token);
