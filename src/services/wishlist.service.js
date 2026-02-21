const pool = require("../config/db");

const createError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const getVariantWithProduct = async (variantId) => {
  const result = await pool.query(
    `
    SELECT
      pv.id AS variant_id,
      pv.product_id,
      pv.shade,
      pv.color_type,
      pv.variant_model_no,
      pv.price,
      pv.discount_price,
      pv.stock,
      p.name AS product_name
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = $1 AND COALESCE(p.is_active, true) = true
    `,
    [variantId]
  );
  return result.rows[0] || null;
};

const addToWishlist = async (userId, variantId) => {
  const variant = await getVariantWithProduct(variantId);
  if (!variant) {
    throw createError(404, "Product variant not found");
  }

  await pool.query(
    `
    INSERT INTO wishlist_items (user_id, product_variant_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, product_variant_id) DO NOTHING
    `,
    [userId, variantId]
  );

  return variant;
};

const removeFromWishlist = async (userId, variantId) => {
  const result = await pool.query(
    "DELETE FROM wishlist_items WHERE user_id=$1 AND product_variant_id=$2 RETURNING id",
    [userId, variantId]
  );
  if (!result.rows.length) {
    throw createError(404, "Wishlist item not found");
  }
  return true;
};

const getWishlist = async (userId) => {
  const result = await pool.query(
    `
    SELECT
      wi.product_variant_id,
      pv.product_id,
      pv.shade AS color,
      pv.color_type,
      pv.variant_model_no AS size,
      pv.price,
      pv.discount_price,
      pv.stock,
      p.name AS product_name,
      wi.created_at
    FROM wishlist_items wi
    JOIN product_variants pv ON pv.id = wi.product_variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE wi.user_id = $1
    ORDER BY wi.created_at DESC
    `,
    [userId]
  );

  return result.rows.map((row) => {
    const currentPrice = Number(row.discount_price ?? row.price ?? 0);
    return {
      product_id: row.product_id,
      product_variant_id: row.product_variant_id,
      product_name: row.product_name,
      color: row.color,
      color_type: row.color_type,
      size: row.size,
      current_price: currentPrice,
      stock: Number(row.stock || 0),
      created_at: row.created_at,
    };
  });
};

module.exports = {
  addToWishlist,
  removeFromWishlist,
  getWishlist,
};
