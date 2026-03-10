const pool = require("../src/config/db");

/* =========================================================
   ADD NAILS CATEGORY & SUBCATEGORIES
   Run: node scripts/add_nails_category.js
========================================================= */

const makeSlug = (name) => {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return base || `category-${Date.now()}`;
};

const insertCategory = async (client, name, parentId = null) => {
  const slug = makeSlug(name);
  
  // Check if category already exists
  const existing = await client.query(
    `SELECT id FROM categories WHERE slug = $1`,
    [slug]
  );
  
  if (existing.rows.length > 0) {
    console.log(`   ⏭️  ${name} already exists (ID: ${existing.rows[0].id})`);
    return existing.rows[0].id;
  }
  
  const result = await client.query(
    `INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id`,
    [name, slug, parentId]
  );
  return result.rows[0].id;
};

const addNailsCategory = async () => {
  const client = await pool.connect();

  try {
    console.log("🚀 Adding NAILS Category & Subcategories...\n");

    await client.query("BEGIN");

    /* =====================================================
       MAIN CATEGORY
    ===================================================== */

    const nailsId = await insertCategory(client, "NAILS");
    console.log(`✅ Created Category: NAILS (ID: ${nailsId})`);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    /* =====================================================
       NAILS SUBCATEGORIES
    ===================================================== */

    const nailsSubcategories = [
      "All Nails",
      "Nail Polish",
      "Nail Art",
      "Nail Care",
      "Nail Tools",
      "Gel & Acrylic",
      "Nail Sets"
    ];

    console.log(`📁 NAILS Subcategories:`);
    for (const subcat of nailsSubcategories) {
      const subId = await insertCategory(client, subcat, nailsId);
      console.log(`   ↳ ${subcat} (ID: ${subId})`);
    }

    await client.query("COMMIT");

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("✨ NAILS category added successfully!\n");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", err.message);
  } finally {
    client.release();
    pool.end();
  }
};

addNailsCategory();
