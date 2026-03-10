const pool = require("../config/db");

const createError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

let ensureWishlistSchemaPromise = null;

const ensureWishlistSchemaCompatibility = async () => {
  if (!ensureWishlistSchemaPromise) {
    ensureWishlistSchemaPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS product_id BIGINT");
        await client.query("ALTER TABLE wishlist_items ALTER COLUMN product_variant_id DROP NOT NULL");
        await client.query(
          `
          UPDATE wishlist_items wi
          SET product_id = pv.product_id
          FROM product_variants pv
          WHERE wi.product_id IS NULL
            AND wi.product_variant_id = pv.id
          `
        );
        await client.query("DELETE FROM wishlist_items WHERE product_id IS NULL");
        await client.query("ALTER TABLE wishlist_items ALTER COLUMN product_id SET NOT NULL");
        await client.query("ALTER TABLE wishlist_items DROP CONSTRAINT IF EXISTS wishlist_items_user_variant_key");
        await client.query(
          `
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'wishlist_items_product_fk'
            ) THEN
              ALTER TABLE wishlist_items
                ADD CONSTRAINT wishlist_items_product_fk
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
            END IF;
          END$$;
          `
        );
        await client.query(
          "CREATE UNIQUE INDEX IF NOT EXISTS ux_wishlist_user_variant_not_null ON wishlist_items(user_id, product_variant_id) WHERE product_variant_id IS NOT NULL"
        );
        await client.query(
          "CREATE UNIQUE INDEX IF NOT EXISTS ux_wishlist_user_product_no_variant ON wishlist_items(user_id, product_id) WHERE product_variant_id IS NULL"
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    })().catch((err) => {
      ensureWishlistSchemaPromise = null;
      throw err;
    });
  }

  return ensureWishlistSchemaPromise;
};

const getActiveProduct = async (client, productId) => {
  const result = await client.query(
    `
    SELECT
      id,
      name,
      base_price,
      base_stock,
      product_model_no,
      thumbnail,
      afterimage
    FROM products
    WHERE id = $1 AND COALESCE(is_active, true) = true
    LIMIT 1
    `,
    [productId]
  );

  return result.rows[0] || null;
};

const getVariantByProductAndId = async (client, productId, variantId) => {
  const result = await client.query(
    `
    SELECT
      pv.id AS variant_id,
      pv.product_id,
      pv.shade,
      pv.color_type,
      pv.color_panel_type,
      pv.color_panel_value,
      pv.variant_model_no,
      pv.main_image,
      pv.secondary_image,
      pv.price,
      pv.discount_price,
      pv.stock,
      p.product_model_no,
      p.name AS product_name
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = $1
      AND pv.product_id = $2
      AND COALESCE(p.is_active, true) = true
    LIMIT 1
    `,
    [variantId, productId]
  );
  return result.rows[0] || null;
};

const getFirstVariantByProduct = async (client, productId) => {
  const result = await client.query(
    `
    SELECT
      pv.id AS variant_id,
      pv.product_id,
      pv.shade,
      pv.color_type,
      pv.color_panel_type,
      pv.color_panel_value,
      pv.variant_model_no,
      pv.main_image,
      pv.secondary_image,
      pv.price,
      pv.discount_price,
      pv.stock,
      p.product_model_no,
      p.name AS product_name
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.product_id = $1
      AND COALESCE(p.is_active, true) = true
      AND NOT (
        pv.shade = 'Default'
        AND pv.color_type IS NULL
        AND pv.color_panel_type IS NULL
        AND pv.color_panel_value IS NULL
        AND COALESCE(pv.variant_model_no, '') = COALESCE(p.product_model_no, '')
        AND COALESCE(pv.main_image, '') = COALESCE(p.thumbnail, '')
        AND COALESCE(pv.secondary_image, '') = COALESCE(p.afterimage, '')
        AND COALESCE(pv.price, p.base_price) = p.base_price
        AND COALESCE(pv.stock, p.base_stock) = p.base_stock
      )
    ORDER BY pv.id ASC
    LIMIT 1
    `,
    [productId]
  );

  return result.rows[0] || null;
};

const addToWishlist = async (userId, payload = {}) => {
  await ensureWishlistSchemaCompatibility();

  const productId = Number.isInteger(payload.productId)
    ? payload.productId
    : parseInt(payload.productId, 10);
  const variantId = Number.isInteger(payload.variantId)
    ? payload.variantId
    : (payload.variantId === undefined || payload.variantId === null || payload.variantId === "")
      ? null
      : parseInt(payload.variantId, 10);

  if (!Number.isInteger(productId)) {
    throw createError(400, "product_id is required");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const product = await getActiveProduct(client, productId);
    if (!product) {
      throw createError(404, "Product not found");
    }

    let variant = null;
    if (variantId !== null) {
      variant = await getVariantByProductAndId(client, productId, variantId);
      if (!variant) {
        throw createError(404, "Product variant not found for this product");
      }
    } else {
      variant = await getFirstVariantByProduct(client, productId);
    }

    const existing = variant
      ? await client.query(
        "SELECT id FROM wishlist_items WHERE user_id=$1 AND product_variant_id=$2 LIMIT 1",
        [userId, variant.variant_id]
      )
      : await client.query(
        "SELECT id FROM wishlist_items WHERE user_id=$1 AND product_id=$2 AND product_variant_id IS NULL LIMIT 1",
        [userId, productId]
      );

    if (!existing.rows.length) {
      await client.query(
        `
        INSERT INTO wishlist_items (user_id, product_id, product_variant_id)
        VALUES ($1, $2, $3)
        `,
        [userId, productId, variant?.variant_id ?? null]
      );
    }

    await client.query("COMMIT");

    return { product, variant };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const removeFromWishlist = async (userId, variantId) => {
  await ensureWishlistSchemaCompatibility();

  const result = await pool.query(
    "DELETE FROM wishlist_items WHERE user_id=$1 AND product_variant_id=$2 RETURNING id",
    [userId, variantId]
  );
  if (!result.rows.length) {
    throw createError(404, "Wishlist item not found");
  }
  return true;
};

const removeFromWishlistNoVariant = async (userId, productId) => {
  await ensureWishlistSchemaCompatibility();

  const result = await pool.query(
    "DELETE FROM wishlist_items WHERE user_id=$1 AND product_id=$2 AND product_variant_id IS NULL RETURNING id",
    [userId, productId]
  );
  if (!result.rows.length) {
    throw createError(404, "Wishlist item not found");
  }
  return true;
};

const getWishlist = async (userId) => {
  await ensureWishlistSchemaCompatibility();

  const result = await pool.query(
    `
    SELECT
      wi.product_id,
      wi.product_variant_id,
      pv.product_id AS resolved_product_id,
      pv.shade AS color,
      pv.color_type,
      pv.color_panel_type,
      pv.color_panel_value,
      pv.variant_model_no,
      pv.price,
      pv.discount_price,
      pv.stock,
      pv.main_image,
      pv.secondary_image,
      p.name AS product_name,
      p.product_model_no,
      p.base_price,
      p.base_stock,
      p.thumbnail,
      p.afterimage,
      wi.created_at
    FROM wishlist_items wi
    LEFT JOIN product_variants pv ON pv.id = wi.product_variant_id
    JOIN products p ON p.id = COALESCE(pv.product_id, wi.product_id)
    WHERE wi.user_id = $1
    ORDER BY wi.created_at DESC
    `,
    [userId]
  );

  return result.rows.map((row) => {
    const currentPrice = Number(row.discount_price ?? row.price ?? row.base_price ?? 0);
    return {
      product_id: Number(row.resolved_product_id ?? row.product_id),
      product_variant_id: row.product_variant_id,
      product_name: row.product_name,
      product_model_no: row.product_model_no,
      color: row.color,
      color_type: row.color_type,
      color_panel_type: row.color_panel_type || null,
      color_panel_value: row.color_panel_value || null,
      variant_model_no: row.variant_model_no || null,
      current_price: currentPrice,
      stock: Number(row.stock ?? row.base_stock ?? 0),
      main_image: row.main_image || row.thumbnail || null,
      secondary_image: row.secondary_image || row.afterimage || null,
      created_at: row.created_at,
    };
  });
};

module.exports = {
  addToWishlist,
  removeFromWishlist,
  removeFromWishlistNoVariant,
  getWishlist,
};
