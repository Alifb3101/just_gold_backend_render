-- Migration: Add Guest Cart Support
-- Description: Add guest_token column to cart_items table and create necessary indexes
-- This migration enables the backend to support guest carts alongside user carts

BEGIN;

-- Add guest_token column if it doesn't exist
ALTER TABLE cart_items 
ADD COLUMN IF NOT EXISTS guest_token UUID;

-- Modify user_id to be nullable (to support guest-only carts)
ALTER TABLE cart_items 
ALTER COLUMN user_id DROP NOT NULL;

-- Modify product_variant_id to be nullable (to support base products without variants)
ALTER TABLE cart_items 
ALTER COLUMN product_variant_id DROP NOT NULL;

-- Drop old constraint if exists (it requires user_id to be NOT NULL)
ALTER TABLE cart_items 
DROP CONSTRAINT IF EXISTS cart_items_user_variant_key;

-- Create unique indexes for user carts WITH variants
CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_user_variant_not_null 
ON cart_items(user_id, product_variant_id) 
WHERE product_variant_id IS NOT NULL AND user_id IS NOT NULL;

-- Create unique indexes for user carts WITHOUT variants (base product)
CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_user_product_no_variant 
ON cart_items(user_id, product_id) 
WHERE product_variant_id IS NULL AND user_id IS NOT NULL;

-- Create unique indexes for guest carts WITH variants
CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_guest_variant_not_null 
ON cart_items(guest_token, product_variant_id) 
WHERE guest_token IS NOT NULL AND product_variant_id IS NOT NULL;

-- Create unique indexes for guest carts WITHOUT variants (base product)
CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_guest_product_no_variant 
ON cart_items(guest_token, product_id) 
WHERE guest_token IS NOT NULL AND product_variant_id IS NULL;

-- Create index for fast lookups by guest_token
CREATE INDEX IF NOT EXISTS idx_cart_guest_token 
ON cart_items(guest_token);

-- Create index for fast lookups by user_id (if not already present)
CREATE INDEX IF NOT EXISTS idx_cart_user_id 
ON cart_items(user_id);

-- Create composite index for queries filtering by owner and product
CREATE INDEX IF NOT EXISTS idx_cart_user_product 
ON cart_items(user_id, product_id) 
WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cart_guest_product 
ON cart_items(guest_token, product_id) 
WHERE guest_token IS NOT NULL;

COMMIT;
