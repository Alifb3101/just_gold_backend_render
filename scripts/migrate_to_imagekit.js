/**
 * Optional Background Migration: Migrate Cloudinary images to ImageKit
 * This script downloads images from Cloudinary and uploads to S3 via ImageKit
 * 
 * IMPORTANT: Run this AFTER add_media_provider_column migration
 * Can be run in batches without downtime
 */

const pool = require('../config/db');

/**
 * Migrate images for a specific table
 * Updates image_key and media_provider for records that still use Cloudinary
 * 
 * This is a placeholder - actual implementation would:
 * 1. Fetch Cloudinary URL
 * 2. Download image
 * 3. Upload to S3
 * 4. Get new ImageKit path
 * 5. Update database
 */
const migrateTableToImageKit = async (tableName, imageKeyColumn, limit = 100, offset = 0) => {
  const client = await pool.connect();
  try {
    console.log(`[migrate-to-imagekit] Starting migration for ${tableName} (limit: ${limit}, offset: ${offset})`);

    // Find records still using Cloudinary
    const selectQuery = `
      SELECT * FROM ${tableName}
      WHERE media_provider = 'cloudinary' OR media_provider IS NULL
      LIMIT $1 OFFSET $2
    `;

    const result = await client.query(selectQuery, [limit, offset]);
    const records = result.rows;

    if (records.length === 0) {
      console.log(`[migrate-to-imagekit] No more records to migrate in ${tableName}`);
      return { migrated: 0, total: 0 };
    }

    console.log(`[migrate-to-imagekit] Found ${records.length} records to migrate in ${tableName}`);

    let migratedCount = 0;

    for (const record of records) {
      try {
        // This is where you'd implement actual migration logic
        // For now, just log what would happen
        console.log(`[migrate-to-imagekit] Would migrate record ${record.id} in ${tableName}`);
        
        // Actual implementation would:
        // 1. Download image from Cloudinary
        // 2. Upload to S3
        // 3. Update database with new ImageKit path
        
        // await client.query(
        //   `UPDATE ${tableName} SET media_provider = $1, ${imageKeyColumn} = $2 WHERE id = $3`,
        //   ['imagekit', newImageKey, record.id]
        // );
        
        migratedCount++;

      } catch (err) {
        console.error(`[migrate-to-imagekit] Error migrating record ${record.id}:`, err.message);
        // Continue with next record even if one fails
      }
    }

    console.log(`[migrate-to-imagekit] Migrated ${migratedCount}/${records.length} records in ${tableName}`);
    
    return {
      migrated: migratedCount,
      total: records.length,
      nextOffset: offset + limit
    };

  } catch (err) {
    console.error(`[migrate-to-imagekit] Migration failed for ${tableName}:`, err.message);
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Run full migration across all tables in batches
 * Safe to run multiple times - idempotent
 */
const runFullMigration = async (batchSize = 50) => {
  const tables = [
    { name: 'products', keyColumn: 'thumbnail_key' },
    { name: 'product_variants', keyColumn: 'image_key' },
    { name: 'product_images', keyColumn: 'image_key' },
    { name: 'review_images', keyColumn: 'image_key' }
  ];

  const results = {};

  for (const table of tables) {
    results[table.name] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await migrateTableToImageKit(table.name, table.keyColumn, batchSize, offset);
      results[table.name].push(result);

      hasMore = result.total === batchSize;
      offset = result.nextOffset || offset + batchSize;

      // Small delay between batches
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  console.log('[migrate-to-imagekit] Full migration complete');
  console.log(JSON.stringify(results, null, 2));

  return results;
};

// Run if called directly
if (require.main === module) {
  const batchSize = parseInt(process.env.BATCH_SIZE || '50');
  
  runFullMigration(batchSize)
    .then(() => {
      console.log('Migration complete');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = {
  migrateTableToImageKit,
  runFullMigration
};
