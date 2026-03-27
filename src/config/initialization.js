/**
 * Database Initialization
 * Runs critical schema migrations on server startup
 * Ensures guest cart support is available before handling requests
 */

const pool = require("./db");

const initializationLog = (...args) => {
  console.log(`[DB_INIT] ${new Date().toISOString()}`, ...args);
};

/**
 * Ensure guest cart schema compatibility
 * This is the same migration that cart.service.js runs,
 * but run once at startup instead of on every request
 */
const ensureGuestCartSchema = async () => {
  // Avoid starving the pool: only grab a client when available quickly
  const client = await pool.connect();
  try {
    initializationLog("🔄 Initializing guest cart schema...");

    await client.query("BEGIN");

    // Add guest_token column if it doesn't exist
    await client.query(`
      ALTER TABLE cart_items 
      ADD COLUMN IF NOT EXISTS guest_token UUID
    `);
    initializationLog("✓ guest_token column added/verified");

    // Make user_id nullable (to support guest-only carts)
    await client.query(`
      ALTER TABLE cart_items 
      ALTER COLUMN user_id DROP NOT NULL
    `);
    initializationLog("✓ user_id column is nullable");

    // Make product_variant_id nullable (to support base products without variants)
    await client.query(`
      ALTER TABLE cart_items 
      ALTER COLUMN product_variant_id DROP NOT NULL
    `);
    initializationLog("✓ product_variant_id column is nullable");

    // Drop old constraint if exists
    await client.query(`
      ALTER TABLE cart_items 
      DROP CONSTRAINT IF EXISTS cart_items_user_variant_key
    `);
    initializationLog("✓ Old constraints removed");

    // Create unique indexes for user carts WITH variants
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_user_variant_not_null 
      ON cart_items(user_id, product_variant_id) 
      WHERE product_variant_id IS NOT NULL AND user_id IS NOT NULL
    `);
    initializationLog("✓ User cart variant index created");

    // Create unique indexes for user carts WITHOUT variants
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_user_product_no_variant 
      ON cart_items(user_id, product_id) 
      WHERE product_variant_id IS NULL AND user_id IS NOT NULL
    `);
    initializationLog("✓ User cart product (no variant) index created");

    // Create unique indexes for guest carts WITH variants
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_guest_variant_not_null 
      ON cart_items(guest_token, product_variant_id) 
      WHERE guest_token IS NOT NULL AND product_variant_id IS NOT NULL
    `);
    initializationLog("✓ Guest cart variant index created");

    // Create unique indexes for guest carts WITHOUT variants
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_guest_product_no_variant 
      ON cart_items(guest_token, product_id) 
      WHERE guest_token IS NOT NULL AND product_variant_id IS NULL
    `);
    initializationLog("✓ Guest cart product (no variant) index created");

    // Create index for fast lookups by guest_token
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cart_guest_token 
      ON cart_items(guest_token)
    `);
    initializationLog("✓ Guest token lookup index created");

    // Create index for user_id lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cart_user_id 
      ON cart_items(user_id)
    `);
    initializationLog("✓ User ID lookup index created");

    // Create composite indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cart_user_product 
      ON cart_items(user_id, product_id) 
      WHERE user_id IS NOT NULL
    `);
    initializationLog("✓ User cart lookup index created");

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cart_guest_product 
      ON cart_items(guest_token, product_id) 
      WHERE guest_token IS NOT NULL
    `);
    initializationLog("✓ Guest cart lookup index created");

    await client.query("COMMIT");
    initializationLog("✅ Guest cart schema initialization complete!\n");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // Connection may be already terminated, that's OK
      console.warn("[DB_INIT] ROLLBACK failed (connection may be down):", rollbackErr.message);
    }
    initializationLog("❌ Schema initialization failed:", err.message);
    // Don't crash the server, but log the error
    console.error("[DB_INIT] Database initialization error:", err.message);
  } finally {
    client.release();
  }
};

/**
 * Initialize database on server startup
 */
const initializeDatabase = async () => {
  try {
    initializationLog("Starting database initialization...");
    await ensureGuestCartSchema();
  } catch (err) {
    initializationLog("⚠️  Database initialization failed (non-fatal):", err.message);
    console.warn("[DB_INIT] Server will continue running. Check database connection.");
    // Don't crash the server - allow it to start so we can diagnose the issue
  }
};

module.exports = {
  initializeDatabase,
};
