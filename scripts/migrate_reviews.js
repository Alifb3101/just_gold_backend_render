#!/usr/bin/env node

/**
 * DATABASE MIGRATION: Create Reviews Schema
 * Run this script once to set up the reviews tables
 * 
 * Usage: node scripts/migrate_reviews.js
 */

const pool = require("../src/config/db");
const fs = require("fs");
const path = require("path");

const main = async () => {
  const client = await pool.connect();
  
  try {
    console.log("🔄 Starting reviews schema migration...\n");

    // Read SQL migration file
    const sqlPath = path.join(__dirname, "reviews_schema.sql");
    const sqlContent = fs.readFileSync(sqlPath, "utf8");

    // Split by semicolon and execute statements
    const statements = sqlContent
      .split(";")
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0 && !stmt.startsWith("--"));

    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      
      // Skip comments and empty lines
      if (stmt.startsWith("--") || stmt.length === 0) continue;

      try {
        await client.query(stmt);
        const statementPreview = stmt.substring(0, 50).replace(/\n/g, " ");
        console.log(`✅ [${i + 1}/${statements.length}] Executed: ${statementPreview}...`);
      } catch (error) {
        // Some statements might be idempotent - warn but continue
        if (error.message.includes("already exists")) {
          console.log(`⚠️  [${i + 1}/${statements.length}] Skipped (already exists)`);
        } else {
          throw error;
        }
      }
    }

    console.log("\n✨ Reviews schema migration completed successfully!\n");
    
    // Verify tables were created
    const tablesCheck = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('reviews', 'review_images')
      ORDER BY table_name
    `);

    if (tablesCheck.rows.length === 2) {
      console.log("✅ Verified: All required tables exist");
      tablesCheck.rows.forEach((row) => {
        console.log(`   - ${row.table_name}`);
      });
    } else {
      throw new Error("Some tables were not created properly");
    }

    // Check indexes
    const indexCheck = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename IN ('reviews', 'review_images')
    `);
    
    console.log(`\n✅ Created ${indexCheck.rows.length} indexes for performance`);

    // Check view
    const viewCheck = await client.query(`
      SELECT viewname FROM information_schema.views
      WHERE table_schema = 'public'
      AND viewname = 'product_review_stats'
    `);

    if (viewCheck.rows.length > 0) {
      console.log("✅ Created 'product_review_stats' view for aggregated data");
    }

    console.log("\n🚀 Database is ready for reviews API!\n");
    console.log("📚 Next steps:");
    console.log("   1. Deploy backend code to production");
    console.log("   2. Test review endpoints:");
    console.log("      - POST /api/v1/products/:productId/reviews");
    console.log("      - GET /api/v1/products/:productId/reviews");
    console.log("   3. Update frontend to use review endpoints\n");

  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    console.error("\nDebug info:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
};

// Run migration
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
