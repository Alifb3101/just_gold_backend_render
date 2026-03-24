/**
 * Add media_provider column to track media source (Cloudinary vs ImageKit)
 * Safe migration: Does NOT modify existing data, only adds new column with default
 */

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const migrationName = 'add_media_provider_column';

// Tables that need media_provider column
const tables = [
  'products',
  'product_variants',
  'product_images',
  'review_images',
  'user_profiles'
];

const runMigration = async () => {
  const client = await pool.connect();
  try {
    console.log(`[${migrationName}] Starting migration...`);
    
    await client.query('BEGIN');

    for (const table of tables) {
      try {
        // Check if column already exists
        const result = await client.query(`
          SELECT EXISTS(
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = $1 AND column_name = 'media_provider'
          )
        `, [table]);

        if (result.rows[0].exists) {
          console.log(`[${migrationName}] Column media_provider already exists on ${table}, skipping...`);
          continue;
        }

        // Add column with default value 'cloudinary' for backward compatibility
        await client.query(`
          ALTER TABLE ${table}
          ADD COLUMN media_provider VARCHAR(50) DEFAULT 'cloudinary'
        `);

        console.log(`[${migrationName}] ✓ Added media_provider column to ${table}`);

      } catch (err) {
        // If table doesn't exist, that's OK - just skip it
        if (err.code === '42P01') { // Undefined table error
          console.log(`[${migrationName}] Table ${table} does not exist, skipping...`);
        } else {
          throw err;
        }
      }
    }

    await client.query('COMMIT');
    console.log(`[${migrationName}] ✓ Migration completed successfully!`);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[${migrationName}] ✗ Migration failed:`, err.message);
    throw err;
  } finally {
    client.release();
  }
};

// Run if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('Migration complete');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { runMigration };
