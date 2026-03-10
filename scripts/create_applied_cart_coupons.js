// Script to create applied_cart_coupons table for persistent coupon storage
// Run: node scripts/create_applied_cart_coupons.js

require("dotenv").config();
const pool = require("../src/config/db");

const createTable = async () => {
  const client = await pool.connect();
  try {
    console.log("Creating applied_cart_coupons table...");
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS applied_cart_coupons (
        id bigserial PRIMARY KEY,
        user_id integer,
        guest_token uuid,
        coupon_code varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_applied_cart_coupons_user ON applied_cart_coupons(user_id) WHERE user_id IS NOT NULL");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_applied_cart_coupons_guest ON applied_cart_coupons(guest_token) WHERE guest_token IS NOT NULL");
    await client.query("CREATE INDEX IF NOT EXISTS idx_applied_cart_coupons_user ON applied_cart_coupons(user_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_applied_cart_coupons_guest ON applied_cart_coupons(guest_token)");

    console.log("Table created successfully!");
  } catch (err) {
    console.error("Error creating table:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

createTable().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
