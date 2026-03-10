-- Creates applied_cart_coupons table for persistent coupon storage per cart
-- Run this migration to enable database-backed coupon persistence

CREATE TABLE IF NOT EXISTS applied_cart_coupons (
  id bigserial PRIMARY KEY,
  user_id integer,
  guest_token uuid,
  coupon_code varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Partial unique indexes to ensure one coupon per user or per guest
CREATE UNIQUE INDEX IF NOT EXISTS ux_applied_cart_coupons_user ON applied_cart_coupons(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_applied_cart_coupons_guest ON applied_cart_coupons(guest_token) WHERE guest_token IS NOT NULL;

-- Regular indexes for lookups
CREATE INDEX IF NOT EXISTS idx_applied_cart_coupons_user ON applied_cart_coupons(user_id);

CREATE INDEX IF NOT EXISTS idx_applied_cart_coupons_guest ON applied_cart_coupons(guest_token);
