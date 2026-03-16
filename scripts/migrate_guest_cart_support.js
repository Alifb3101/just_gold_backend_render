#!/usr/bin/env node

/**
 * Migration Script: Guest Cart Support
 * 
 * Usage:
 *   node scripts/migrate_guest_cart_support.js
 * 
 * This script adds guest_token column and indexes to cart_items table
 * to support guest carts in production.
 */

const pool = require("../src/config/db");
const fs = require("fs");
const path = require("path");

const runMigration = async () => {
  const client = await pool.connect();

  try {
    console.log("🔄 Starting guest cart support migration...\n");

    const sqlPath = path.join(__dirname, "migrate_guest_cart_support.sql");
    const sql = fs.readFileSync(sqlPath, "utf-8");

    console.log("📝 Executing migration SQL...\n");
    await client.query(sql);

    console.log("✅ Migration completed successfully!\n");

    // Verify the schema
    console.log("📊 Verifying schema changes...\n");

    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'cart_items'
      ORDER BY ordinal_position;
    `);

    console.log("Cart Items Table Structure:");
    console.log("─".repeat(60));
    columns.rows.forEach((col) => {
      const nullable = col.is_nullable === "YES" ? "✓ NULL" : "NOT NULL";
      console.log(`  • ${col.column_name}: ${col.data_type} (${nullable})`);
    });

    const indexes = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'cart_items'
      ORDER BY indexname;
    `);

    console.log("\nCart Items Indexes:");
    console.log("─".repeat(60));
    indexes.rows.forEach((idx) => {
      if (!idx.indexname.startsWith("pg_toast")) {
        console.log(`  ✓ ${idx.indexname}`);
      }
    });

    console.log("\n🎉 Guest cart support is ready for production!\n");
    console.log("Frontend should now send X-Guest-Token header with requests:");
    console.log("  X-Guest-Token: <uuid-guest-token>\n");

  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

runMigration().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
