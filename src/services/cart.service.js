const pool = require("../config/db");

const createError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const getVariantWithProduct = async (client, variantId) => {
  const result = await client.query(
    `
    SELECT
      pv.id AS variant_id,
      pv.product_id,
      pv.stock,
      pv.price,
      pv.discount_price,
      pv.shade,
      pv.color_type,
      pv.variant_model_no,
      pv.main_image,
      pv.secondary_image,
      p.name AS product_name
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = $1 AND COALESCE(p.is_active, true) = true
    `,
    [variantId]
  );

  return result.rows[0] || null;
};

const getEffectivePrice = (variant) => {
  const raw = variant.discount_price ?? variant.price;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw createError(400, "Variant price not available");
  }
  return value;
};

const addToCart = async (userId, variantId, quantity) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw createError(400, "Quantity must be a positive integer");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const variant = await getVariantWithProduct(client, variantId);
    if (!variant) {
      throw createError(404, "Product variant not found");
    }

    const priceAtAdded = getEffectivePrice(variant);

    const existing = await client.query(
      "SELECT id, quantity, price_at_added FROM cart_items WHERE user_id=$1 AND product_variant_id=$2 FOR UPDATE",
      [userId, variantId]
    );

    const currentQty = existing.rows[0]?.quantity || 0;
    const newQuantity = currentQty + quantity;

    if (newQuantity > Number(variant.stock || 0)) {
      throw createError(400, "Not enough stock available");
    }

    const upsert = await client.query(
      `
      INSERT INTO cart_items (user_id, product_id, product_variant_id, quantity, price_at_added)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, product_variant_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
      RETURNING id, product_id, product_variant_id, quantity, price_at_added, created_at, updated_at
      `,
      [userId, variant.product_id, variant.variant_id, newQuantity, priceAtAdded]
    );

    await client.query("COMMIT");
    return { item: upsert.rows[0], variant };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const updateQuantity = async (userId, variantId, quantity) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw createError(400, "Quantity must be a positive integer");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT ci.id, ci.product_variant_id, pv.stock
      FROM cart_items ci
      JOIN product_variants pv ON pv.id = ci.product_variant_id
      WHERE ci.user_id = $1 AND ci.product_variant_id = $2
      FOR UPDATE
      `,
      [userId, variantId]
    );

    if (!existing.rows.length) {
      throw createError(404, "Cart item not found");
    }

    const stock = Number(existing.rows[0].stock || 0);
    if (quantity > stock) {
      throw createError(400, "Not enough stock available");
    }

    const updated = await client.query(
      `
      UPDATE cart_items
      SET quantity = $1, updated_at = NOW()
      WHERE user_id = $2 AND product_variant_id = $3
      RETURNING id, product_id, product_variant_id, quantity, price_at_added, created_at, updated_at
      `,
      [quantity, userId, variantId]
    );

    await client.query("COMMIT");
    return updated.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const removeFromCart = async (userId, variantId) => {
  const result = await pool.query(
    "DELETE FROM cart_items WHERE user_id=$1 AND product_variant_id=$2 RETURNING id",
    [userId, variantId]
  );
  if (!result.rows.length) {
    throw createError(404, "Cart item not found");
  }
  return true;
};

const getCart = async (userId) => {
  const result = await pool.query(
    `
    SELECT
      ci.product_id,
      ci.product_variant_id,
      ci.quantity,
      ci.price_at_added,
      ci.created_at,
      ci.updated_at,
      p.name AS product_name,
      pv.shade AS color,
      pv.color_type,
      pv.variant_model_no AS size,
      pv.price AS variant_price,
      pv.discount_price,
      pv.stock,
      pv.main_image,
      pv.secondary_image
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    JOIN product_variants pv ON pv.id = ci.product_variant_id
    WHERE ci.user_id = $1
    ORDER BY ci.created_at DESC
    `,
    [userId]
  );

  return result.rows.map((row) => {
    const currentPrice = Number(row.discount_price ?? row.variant_price ?? 0);
    const priceAtAdded = Number(row.price_at_added ?? currentPrice);
    const subtotal = currentPrice * Number(row.quantity);

    return {
      product_id: row.product_id,
      product_variant_id: row.product_variant_id,
      product_name: row.product_name,
      color: row.color,
      color_type: row.color_type,
      size: row.size,
      quantity: Number(row.quantity),
      price_at_added: priceAtAdded,
      current_price: currentPrice,
      stock: Number(row.stock || 0),
      subtotal,
      created_at: row.created_at,
      updated_at: row.updated_at,
      main_image: row.main_image,
      secondary_image: row.secondary_image,
    };
  });
};

module.exports = {
  addToCart,
  updateQuantity,
  removeFromCart,
  getCart,
};
