#!/usr/bin/env node

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const runMigration = async () => {
  const client = await pool.connect();

  try {
    console.log("Starting transactional email schema migration...\n");

    const sqlPath = path.join(__dirname, "transactional_email_schema.sql");
    const sql = fs.readFileSync(sqlPath, "utf-8");

    await client.query(sql);

    console.log("Migration completed successfully.\n");

    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'newsletter_subscribers',
          'contact_messages',
          'email_logs',
          'password_reset_tokens'
        )
      ORDER BY table_name
    `);

    console.log("Verified tables:");
    tablesResult.rows.forEach((row) => console.log(`  - ${row.table_name}`));

    console.log("\nDone. Only transactional email section was migrated.");
  } catch (error) {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

runMigration().catch((error) => {
  console.error("Fatal migration error:", error.message);
  process.exit(1);
});
