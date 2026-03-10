const pool = require("../config/db");

const createError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const isCartDebugEnabled = () => {
  const flag = String(process.env.CART_DEBUG || "").toLowerCase();
  return flag === "1" || flag === "true" || (process.env.NODE_ENV !== "production" && flag !== "false");
};

const cartDebug = (event, payload = {}) => {
  if (!isCartDebugEnabled()) {
    return;
  }
  const stamp = new Date().toISOString();
  console.log(`[cart][${stamp}] ${event}`, payload);
};

const resolveOwner = (identity = {}) => {
  const normalizedUserId = Number.isInteger(identity.userId)
    ? identity.userId
    : Number.parseInt(identity.userId, 10);

  const guestToken = identity.guestToken || null;

  if (Number.isInteger(normalizedUserId)) {
    return { column: "user_id", value: normalizedUserId, type: "user" };
  }

  if (guestToken) {
    return { column: "guest_token", value: guestToken, type: "guest" };
  }

  throw createError(401, "Unauthorized");
};

let ensureCartSchemaPromise = null;

const ensureCartSchemaCompatibility = async () => {
  if (!ensureCartSchemaPromise) {
    ensureCartSchemaPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("ALTER TABLE cart_items ALTER COLUMN product_variant_id DROP NOT NULL");
        await client.query("ALTER TABLE cart_items ALTER COLUMN user_id DROP NOT NULL");
        await client.query("ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS guest_token uuid");
        await client.query("ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_variant_key");
        await client.query(
          "CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_user_variant_not_null ON cart_items(user_id, product_variant_id) WHERE product_variant_id IS NOT NULL"
        );
        await client.query(
          "CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_user_product_no_variant ON cart_items(user_id, product_id) WHERE product_variant_id IS NULL"
        );
        await client.query(
          "CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_guest_variant_not_null ON cart_items(guest_token, product_variant_id) WHERE guest_token IS NOT NULL AND product_variant_id IS NOT NULL"
        );
        await client.query(
          "CREATE UNIQUE INDEX IF NOT EXISTS ux_cart_guest_product_no_variant ON cart_items(guest_token, product_id) WHERE guest_token IS NOT NULL AND product_variant_id IS NULL"
        );
        await client.query("CREATE INDEX IF NOT EXISTS idx_cart_guest_token ON cart_items(guest_token)");
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    })();
  }

  return ensureCartSchemaPromise;
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
      thumbnail_key,
      afterimage,
      afterimage_key
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
      pv.stock,
      pv.price,
      pv.discount_price,
      pv.shade,
      pv.color_type,
      pv.color_panel_type,
      pv.color_panel_value,
      pv.variant_model_no,
      pv.main_image,
      pv.secondary_image,
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
      pv.stock,
      pv.price,
      pv.discount_price,
      pv.shade,
      pv.color_type,
      pv.color_panel_type,
      pv.color_panel_value,
      pv.variant_model_no,
      pv.main_image,
      pv.secondary_image,
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

const getEffectivePrice = ({ variant = null, product = null }) => {
  const raw = variant
    ? (variant.discount_price ?? variant.price)
    : (product?.base_price ?? null);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw createError(400, "Variant price not available");
  }
  return value;
};

const addToCart = async (identity, payload = {}, options = {}) => {
  await ensureCartSchemaCompatibility();
  const owner = resolveOwner(identity);

  const productId = Number.isInteger(payload.productId)
    ? payload.productId
    : parseInt(payload.productId, 10);
  const variantId = Number.isInteger(payload.variantId)
    ? payload.variantId
    : (payload.variantId === null || payload.variantId === undefined || payload.variantId === "")
      ? null
      : parseInt(payload.variantId, 10);
  const quantity = Number.isInteger(payload.quantity)
    ? payload.quantity
    : parseInt(payload.quantity ?? 1, 10);

  if (!Number.isInteger(productId)) {
    throw createError(400, "product_id is required");
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw createError(400, "Quantity must be a positive integer");
  }

  cartDebug("add.request", {
    owner,
    productId,
    variantId,
    quantity,
  });

  const client = options.client || await pool.connect();
  const manageTransaction = !options.useExistingTransaction;
  const shouldRelease = !options.client;

  try {
    if (manageTransaction) {
      await client.query("BEGIN");
    }

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

    const resolvedProductId = variant ? Number(variant.product_id) : Number(product.id);

    if (variant && resolvedProductId !== productId) {
      throw createError(400, "Selected variant does not belong to the provided product");
    }

    const priceAtAdded = getEffectivePrice({ variant, product });

    const existing = variant
      ? await client.query(
        `SELECT id, quantity, price_at_added FROM cart_items WHERE ${owner.column} = $1 AND product_variant_id = $2 FOR UPDATE`,
        [owner.value, variant.variant_id]
      )
      : await client.query(
        `SELECT id, quantity, price_at_added FROM cart_items WHERE ${owner.column} = $1 AND product_id = $2 AND product_variant_id IS NULL FOR UPDATE`,
        [owner.value, productId]
      );

    const currentQty = existing.rows[0]?.quantity || 0;
    const newQuantity = currentQty + quantity;

    cartDebug("add.variant_resolved", {
      owner,
      variantId: variant?.variant_id ?? null,
      resolvedProductId,
      currentQty,
      requestedQty: quantity,
      newQuantity,
      stock: Number(variant?.stock ?? product?.base_stock ?? 0),
    });

    if (newQuantity > Number(variant?.stock ?? product?.base_stock ?? 0)) {
      throw createError(400, "Not enough stock available");
    }

    let saved;
    if (existing.rows.length) {
      const updated = await client.query(
        `
        UPDATE cart_items
        SET quantity = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, product_id, product_variant_id, quantity, price_at_added, created_at, updated_at
        `,
        [newQuantity, existing.rows[0].id]
      );
      saved = updated.rows[0];
    } else {
      const inserted = await client.query(
        `
        INSERT INTO cart_items (${owner.column}, product_id, product_variant_id, quantity, price_at_added)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, product_id, product_variant_id, quantity, price_at_added, created_at, updated_at
        `,
        [owner.value, productId, variant?.variant_id ?? null, newQuantity, priceAtAdded]
      );
      saved = inserted.rows[0];
    }

    cartDebug("add.persisted", {
      owner,
      cartItemId: saved?.id,
      productId: saved?.product_id,
      productVariantId: saved?.product_variant_id,
      quantity: saved?.quantity,
    });

    if (manageTransaction) {
      await client.query("COMMIT");
    }
    return { item: saved, variant, product };
  } catch (err) {
    if (manageTransaction) {
      await client.query("ROLLBACK");
    }
    throw err;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
};

const updateQuantity = async (identity, variantId, quantity) => {
  await ensureCartSchemaCompatibility();
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw createError(400, "Quantity must be a positive integer");
  }

  const owner = resolveOwner(identity);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT ci.id, ci.product_variant_id, pv.stock
      FROM cart_items ci
      JOIN product_variants pv ON pv.id = ci.product_variant_id
      WHERE ci.${owner.column} = $1 AND ci.product_variant_id = $2
      FOR UPDATE
      `,
      [owner.value, variantId]
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
      WHERE ${owner.column} = $2 AND product_variant_id = $3
      RETURNING id, product_id, product_variant_id, quantity, price_at_added, created_at, updated_at
      `,
      [quantity, owner.value, variantId]
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

const updateQuantityNoVariant = async (identity, productId, quantity) => {
  await ensureCartSchemaCompatibility();
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw createError(400, "Quantity must be a positive integer");
  }

  const owner = resolveOwner(identity);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT ci.id, ci.product_id, p.base_stock
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.${owner.column} = $1 AND ci.product_id = $2 AND ci.product_variant_id IS NULL
      FOR UPDATE
      `,
      [owner.value, productId]
    );

    if (!existing.rows.length) {
      throw createError(404, "Cart item not found");
    }

    const stock = Number(existing.rows[0].base_stock || 0);
    if (quantity > stock) {
      throw createError(400, "Not enough stock available");
    }

    const updated = await client.query(
      `
      UPDATE cart_items
      SET quantity = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, product_id, product_variant_id, quantity, price_at_added, created_at, updated_at
      `,
      [quantity, existing.rows[0].id]
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

const removeFromCart = async (identity, variantId) => {
  const owner = resolveOwner(identity);
  const result = await pool.query(
    `DELETE FROM cart_items WHERE ${owner.column} = $1 AND product_variant_id = $2 RETURNING id`,
    [owner.value, variantId]
  );
  if (!result.rows.length) {
    throw createError(404, "Cart item not found");
  }
  return true;
};

const removeFromCartNoVariant = async (identity, productId) => {
  const owner = resolveOwner(identity);
  const result = await pool.query(
    `DELETE FROM cart_items WHERE ${owner.column} = $1 AND product_id = $2 AND product_variant_id IS NULL RETURNING id`,
    [owner.value, productId]
  );
  if (!result.rows.length) {
    throw createError(404, "Cart item not found");
  }
  return true;
};

const getCart = async (identity) => {
  await ensureCartSchemaCompatibility();
  const owner = resolveOwner(identity);
  const result = await pool.query(
    `
    SELECT
      ci.product_id,
      ci.product_variant_id,
      ci.quantity,
      ci.price_at_added,
      ci.created_at,
      ci.updated_at,
      pv.product_id AS resolved_product_id,
      p.name AS product_name,
      p.product_model_no,
      pv.shade AS color,
      pv.color_type,
      pv.color_panel_type,
      pv.color_panel_value,
      pv.variant_model_no,
      p.base_price,
      p.base_stock,
      p.thumbnail,
      p.afterimage,
      pv.price AS variant_price,
      pv.discount_price,
      pv.stock,
      pv.main_image,
      pv.secondary_image
    FROM cart_items ci
    LEFT JOIN product_variants pv ON pv.id = ci.product_variant_id
    JOIN products p ON p.id = COALESCE(pv.product_id, ci.product_id)
    WHERE ci.${owner.column} = $1
    ORDER BY ci.created_at DESC
    `,
    [owner.value]
  );

  return result.rows.map((row) => {
    const currentPrice = Number(row.discount_price ?? row.variant_price ?? row.base_price ?? 0);
    const priceAtAdded = Number(row.price_at_added ?? currentPrice);
    const subtotal = currentPrice * Number(row.quantity);

    return {
      product_id: Number(row.resolved_product_id ?? row.product_id),
      product_variant_id: row.product_variant_id,
      product_name: row.product_name,
      product_model_no: row.product_model_no,
      color: row.color || null,
      color_type: row.color_type || null,
      color_panel_type: row.color_panel_type || null,
      color_panel_value: row.color_panel_value || null,
      variant_model_no: row.variant_model_no || null,
      quantity: Number(row.quantity),
      price_at_added: priceAtAdded,
      current_price: currentPrice,
      stock: Number(row.stock ?? row.base_stock ?? 0),
      subtotal,
      created_at: row.created_at,
      updated_at: row.updated_at,
      main_image: row.main_image || row.thumbnail || null,
      secondary_image: row.secondary_image || row.afterimage || null,
    };
  });
};

const clearCartByOwner = async (identity, options = {}) => {
  await ensureCartSchemaCompatibility();
  const owner = resolveOwner(identity);

  if (options.client) {
    await options.client.query(`DELETE FROM cart_items WHERE ${owner.column} = $1`, [owner.value]);
  } else {
    await pool.query(`DELETE FROM cart_items WHERE ${owner.column} = $1`, [owner.value]);
  }
};

const mergeGuestCartIntoUser = async (userId, guestToken) => {
  await ensureCartSchemaCompatibility();
  const normalizedUserId = Number.parseInt(userId, 10);
  if (!guestToken || !Number.isInteger(normalizedUserId)) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const guestItemsResult = await client.query(
      `SELECT product_id, product_variant_id, quantity FROM cart_items WHERE guest_token = $1 FOR UPDATE`,
      [guestToken]
    );

    for (const item of guestItemsResult.rows) {
      await addToCart(
        { userId: normalizedUserId },
        {
          productId: Number(item.product_id),
          variantId: item.product_variant_id ? Number(item.product_variant_id) : null,
          quantity: Number(item.quantity),
        },
        { client, useExistingTransaction: true }
      );
    }

    await client.query(`DELETE FROM cart_items WHERE guest_token = $1`, [guestToken]);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  addToCart,
  updateQuantity,
  updateQuantityNoVariant,
  removeFromCart,
  removeFromCartNoVariant,
  getCart,
  clearCartByOwner,
  mergeGuestCartIntoUser,
};
