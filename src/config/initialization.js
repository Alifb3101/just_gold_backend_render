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
 * Ensure product tags schema compatibility once at startup
 * (moved out of request lifecycle for performance)
 */
const ensureProductTagsSchema = async () => {
  const client = await pool.connect();
  try {
    initializationLog("🔄 Initializing product tags schema...");

    await client.query("BEGIN");

    await client.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb`
    );
    initializationLog("✓ products.tags column added/verified");

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN (tags)`
    );
    initializationLog("✓ products.tags index added/verified");

    await client.query(`UPDATE products SET tags = '[]'::jsonb WHERE tags IS NULL`);
    initializationLog("✓ null tags backfilled");

    await client.query(
      `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'products' AND column_name = 'tag'
        ) THEN
          UPDATE products
          SET tags = jsonb_build_array(jsonb_build_object('type', 'badge', 'code', UPPER(TRIM(tag))))
          WHERE (tags IS NULL OR tags = '[]'::jsonb)
            AND tag IS NOT NULL
            AND TRIM(tag) <> ''
            AND UPPER(TRIM(tag)) ~ '^[A-Z0-9_-]{1,24}$';
        END IF;
      END
      $$;`
    );
    initializationLog("✓ legacy tag migration applied/verified");

    await client.query("COMMIT");
    initializationLog("✅ Product tags schema initialization complete!\n");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.warn("[DB_INIT] ROLLBACK failed (connection may be down):", rollbackErr.message);
    }
    initializationLog("❌ Product tags schema initialization failed:", err.message);
    console.error("[DB_INIT] Product tags initialization error:", err.message);
  } finally {
    client.release();
  }
};

/**
 * Ensure transactional email schema compatibility once at startup
 */
const ensureTransactionalEmailSchema = async () => {
  const client = await pool.connect();
  try {
    initializationLog("🔄 Initializing transactional email schema...");

    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id BIGSERIAL PRIMARY KEY,
        email VARCHAR(320) NOT NULL UNIQUE,
        name VARCHAR(120),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    initializationLog("✓ newsletter_subscribers table added/verified");

    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(320) NOT NULL,
        phone VARCHAR(32),
        subject VARCHAR(160) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    initializationLog("✓ contact_messages table added/verified");

    await client.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id BIGSERIAL PRIMARY KEY,
        template_key VARCHAR(80) NOT NULL,
        to_email VARCHAR(320) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TIMESTAMPTZ,
        payload JSONB,
        provider VARCHAR(40) NOT NULL DEFAULT 'brevo',
        provider_message_id VARCHAR(255),
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    initializationLog("✓ email_logs table added/verified");

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        token_hash VARCHAR(128) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    initializationLog("✓ password_reset_tokens table added/verified");

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_email ON newsletter_subscribers(email)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON contact_messages(email)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_email_logs_status_retry ON email_logs(status, next_retry_at)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id)`
    );

    await client.query("COMMIT");
    initializationLog("✅ Transactional email schema initialization complete!\n");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.warn("[DB_INIT] ROLLBACK failed (connection may be down):", rollbackErr.message);
    }
    initializationLog("❌ Transactional email schema initialization failed:", err.message);
    console.error("[DB_INIT] Transactional email initialization error:", err.message);
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
    await ensureProductTagsSchema();
    await ensureTransactionalEmailSchema();
  } catch (err) {
    initializationLog("⚠️  Database initialization failed (non-fatal):", err.message);
    console.warn("[DB_INIT] Server will continue running. Check database connection.");
    // Don't crash the server - allow it to start so we can diagnose the issue
  }
};

module.exports = {
  initializeDatabase,
};
