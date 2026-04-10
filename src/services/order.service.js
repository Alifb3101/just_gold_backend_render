const pool = require("../config/db");
const { ApiError } = require("../utils/apiError");
const { clearCartByOwner } = require("./cart.service");
const { buildStripeLineItems, createCheckoutSession } = require("./stripe.service");
const couponService = require("./coupon.service");
const { updateSalesStats, invalidateSuggestionCache } = require("./suggestion.service");
const { syncBestSellerSection } = require("./best-seller.service");

const CURRENCY = "AED";
const TAX_PERCENT = Number(process.env.CHECKOUT_TAX_PERCENT || 0);
const DEFAULT_SHIPPING_FEE = Number(process.env.CHECKOUT_SHIPPING_FEE || 20);
const FREE_SHIPPING_THRESHOLD = Number(process.env.CHECKOUT_FREE_SHIPPING_THRESHOLD || 200);
const isCouponDebugEnabled = () => String(process.env.COUPON_DEBUG || "").toLowerCase() === "true";

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const resolveOwner = (identity = {}) => {
  const parsedUserId = Number.parseInt(identity.userId, 10);
  if (Number.isInteger(parsedUserId)) {
    return { type: "user", column: "user_id", value: parsedUserId };
  }

  if (identity.guestToken) {
    return { type: "guest", column: "guest_token", value: identity.guestToken };
  }

  throw new ApiError(401, "Unauthorized", "UNAUTHORIZED");
};

let ensureOrderSchemaPromise = null;
let ensureStripeSessionSchemaPromise = null;

const ensureOrderSchemaCompatibility = async () => {
  if (!ensureOrderSchemaPromise) {
    ensureOrderSchemaPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL");
        await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_email varchar(255)");
        await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_full_name varchar(255)");
        await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone varchar(64)");
        await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_token uuid");
        await client.query("CREATE INDEX IF NOT EXISTS idx_orders_guest_token ON orders(guest_token)");
        await client.query("CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)");
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    })();
  }

  return ensureOrderSchemaPromise;
};

const ensureStripeSessionSchemaCompatibility = async () => {
  if (!ensureStripeSessionSchemaPromise) {
    ensureStripeSessionSchemaPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("ALTER TABLE stripe_checkout_sessions ALTER COLUMN user_id DROP NOT NULL");
        await client.query("ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS guest_token uuid");
        await client.query("ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS guest_email varchar(255)");
        await client.query("ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS guest_full_name varchar(255)");
        await client.query("ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS guest_phone varchar(64)");
        await client.query("ALTER TABLE stripe_checkout_sessions ADD COLUMN IF NOT EXISTS order_id uuid");
        await client.query("CREATE INDEX IF NOT EXISTS idx_stripe_sessions_guest_token ON stripe_checkout_sessions(guest_token)");
        await client.query("CREATE INDEX IF NOT EXISTS idx_stripe_sessions_order_id ON stripe_checkout_sessions(order_id)");
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    })();
  }

  return ensureStripeSessionSchemaPromise;
};

const getUserAddress = async (client, userId, addressId) => {
  const parsedAddressId = Number.parseInt(addressId, 10);
  if (!Number.isInteger(parsedAddressId)) {
    throw new ApiError(400, "shipping_address_id is required", "INVALID_SHIPPING_ADDRESS");
  }

  const result = await client.query(
    `
      SELECT id, label, full_name, phone, line1, line2, city, emirate, country
      FROM user_addresses
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [parsedAddressId, userId]
  );

  if (!result.rows.length) {
    throw new ApiError(400, "Shipping address not found", "ADDRESS_NOT_FOUND");
  }

  return result.rows[0];
};

const getUserContact = async (client, userId) => {
  const result = await client.query(
    `SELECT name, email, phone FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );

  if (!result.rows.length) {
    throw new ApiError(400, "User not found", "USER_NOT_FOUND");
  }

  return result.rows[0];
};

const getCartItemsForCheckout = async (client, identity, { lock = false } = {}) => {
  const owner = resolveOwner(identity);
  const lockClause = lock ? "FOR UPDATE OF ci, p" : "";
  const result = await client.query(
    `
      SELECT
        ci.id AS cart_item_id,
        ci.quantity,
        ci.product_id,
        ci.product_variant_id,
        p.id AS db_product_id,
        p.name AS product_name,
        p.description,
        p.base_price,
        p.base_stock,
        p.is_active,
        pv.id AS variant_id,
        pv.price AS variant_price,
        pv.discount_price AS variant_discount_price,
        pv.stock AS variant_stock,
        pv.shade
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      LEFT JOIN product_variants pv ON pv.id = ci.product_variant_id
      WHERE ci.${owner.column} = $1
      ${lockClause}
    `,
    [owner.value]
  );

  if (lock) {
    const variantIds = result.rows
      .map((row) => Number.parseInt(row.variant_id, 10))
      .filter((id) => Number.isInteger(id));

    if (variantIds.length) {
      await client.query(
        `
          SELECT id
          FROM product_variants
          WHERE id = ANY($1::int[])
          FOR UPDATE
        `,
        [variantIds]
      );
    }
  }

  return result.rows;
};

const normalizeCheckoutItems = (rows) => {
  if (!rows.length) {
    throw new ApiError(400, "Cart is empty", "EMPTY_CART");
  }

  const items = rows.map((row) => {
    if (!row.is_active) {
      throw new ApiError(400, `Product ${row.product_name} is inactive`, "INACTIVE_PRODUCT");
    }

    const stock = row.variant_id ? Number(row.variant_stock || 0) : Number(row.base_stock || 0);
    if (row.quantity > stock) {
      throw new ApiError(409, `Insufficient stock for ${row.product_name}`, "INSUFFICIENT_STOCK");
    }

    const unitPriceRaw = row.variant_id
      ? (row.variant_discount_price ?? row.variant_price)
      : row.base_price;

    const unitPrice = Number(unitPriceRaw);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new ApiError(400, `Invalid price for ${row.product_name}`, "INVALID_PRICE");
    }

    const quantity = Number(row.quantity);

    return {
      cartItemId: row.cart_item_id,
      productId: row.db_product_id,
      variantId: row.variant_id,
      productName: row.product_name,
      description: row.description,
      unitPrice: round2(unitPrice),
      quantity,
      totalPrice: round2(unitPrice * quantity),
    };
  });

  return items;
};

const normalizeSnapshotItems = async (client, snapshotItems, { lock = false } = {}) => {
  if (!Array.isArray(snapshotItems) || !snapshotItems.length) {
    throw new ApiError(400, "Checkout snapshot is empty", "EMPTY_CHECKOUT_SNAPSHOT");
  }

  const parsedItems = snapshotItems.map((snapshotItem) => {
    const productId = Number.parseInt(snapshotItem.productId, 10);
    const variantId = snapshotItem.variantId ? Number.parseInt(snapshotItem.variantId, 10) : null;
    const quantity = Number.parseInt(snapshotItem.quantity, 10);

    if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) {
      throw new ApiError(400, "Invalid checkout snapshot item", "INVALID_CHECKOUT_SNAPSHOT_ITEM");
    }

    return { productId, variantId, quantity };
  });

  const productIds = [...new Set(parsedItems.map((item) => item.productId))];
  const variantIds = [...new Set(parsedItems.map((item) => item.variantId).filter((id) => Number.isInteger(id)))];
  const lockClause = lock ? "FOR UPDATE" : "";

  const productResult = await client.query(
    `
      SELECT id, name, description, base_price, base_stock, is_active
      FROM products
      WHERE id = ANY($1::int[])
      ${lockClause}
    `,
    [productIds]
  );

  const productMap = new Map(productResult.rows.map((row) => [Number(row.id), row]));

  let variantMap = new Map();
  if (variantIds.length) {
    const variantResult = await client.query(
      `
        SELECT id, product_id, stock, price, discount_price
        FROM product_variants
        WHERE id = ANY($1::int[])
        ${lockClause}
      `,
      [variantIds]
    );
    variantMap = new Map(variantResult.rows.map((row) => [Number(row.id), row]));
  }

  const stockRequirements = new Map();
  for (const item of parsedItems) {
    const key = item.variantId ? `variant:${item.variantId}` : `product:${item.productId}`;
    stockRequirements.set(key, (stockRequirements.get(key) || 0) + item.quantity);
  }

  for (const item of parsedItems) {
    const product = productMap.get(item.productId);
    if (!product || !product.is_active) {
      throw new ApiError(400, `Product ${item.productId} is unavailable`, "PRODUCT_UNAVAILABLE");
    }

    if (item.variantId) {
      const variant = variantMap.get(item.variantId);
      if (!variant || Number(variant.product_id) !== item.productId) {
        throw new ApiError(400, `Variant ${item.variantId} is unavailable`, "VARIANT_UNAVAILABLE");
      }
      const required = stockRequirements.get(`variant:${item.variantId}`) || 0;
      if (required > Number(variant.stock || 0)) {
        throw new ApiError(409, `Insufficient stock for ${product.name}`, "INSUFFICIENT_STOCK");
      }
      continue;
    }

    const required = stockRequirements.get(`product:${item.productId}`) || 0;
    if (required > Number(product.base_stock || 0)) {
      throw new ApiError(409, `Insufficient stock for ${product.name}`, "INSUFFICIENT_STOCK");
    }
  }

  return parsedItems.map((item) => {
    const product = productMap.get(item.productId);
    const variant = item.variantId ? variantMap.get(item.variantId) : null;
    const unitPrice = Number(variant ? (variant.discount_price ?? variant.price ?? product.base_price) : product.base_price);

    return {
      productId: Number(product.id),
      variantId: variant ? Number(variant.id) : null,
      productName: product.name,
      description: product.description,
      unitPrice: round2(unitPrice),
      quantity: item.quantity,
      totalPrice: round2(unitPrice * item.quantity),
    };
  });
};

const computeTotals = async (client, items, couponCode, identity) => {
  const subtotal = round2(items.reduce((sum, item) => sum + item.totalPrice, 0));
  const { amount: discount, coupon } = await couponService.getDiscount({
    client,
    code: couponCode,
    subtotal,
    identity,
  });
  const taxableBase = Math.max(0, subtotal - discount);
  // Product prices are VAT-inclusive, so no extra tax should be added on top.
  const tax = 0;
  const eligibleForFreeShipping = taxableBase >= FREE_SHIPPING_THRESHOLD;
  const shippingFee = round2(eligibleForFreeShipping ? 0 : DEFAULT_SHIPPING_FEE);
  const totalAmount = round2(Math.max(0, taxableBase + shippingFee));
  const freeShippingRemaining = round2(Math.max(0, FREE_SHIPPING_THRESHOLD - taxableBase));

   if (isCouponDebugEnabled()) {
     console.log("[coupon][computeTotals]", {
       subtotal,
       couponCode: couponCode || null,
       discount,
       coupon,
       taxableBase,
       tax,
       shippingFee,
       totalAmount,
     });
   }

  return {
    subtotal,
    tax,
    shippingFee,
    discount,
    totalAmount,
    currency: CURRENCY,
    coupon,
    isFreeShipping: eligibleForFreeShipping,
    freeShippingRemaining,
  };
};

const buildCheckoutContext = async ({
  identity,
  shippingAddressId,
  guestShippingAddress,
  guestContact,
  couponCode,
  lock = false,
  client,
}) => {
  const owner = resolveOwner(identity);

  let shippingAddress;
  let guestProfile = null;
  let normalizedUserId = owner.type === "user" ? owner.value : null;

  if (owner.type === "user") {
    shippingAddress = await getUserAddress(client, normalizedUserId, shippingAddressId);
    const userContact = await getUserContact(client, normalizedUserId);
    guestProfile = {
      email: userContact.email,
      full_name: shippingAddress.full_name || userContact.name,
      phone: shippingAddress.phone || userContact.phone,
    };
  } else {
    if (!guestShippingAddress) {
      throw new ApiError(400, "shipping_address is required for guest checkout", "INVALID_SHIPPING_ADDRESS");
    }

    shippingAddress = {
      label: guestShippingAddress.label || "Guest",
      full_name: guestShippingAddress.full_name,
      phone: guestShippingAddress.phone,
      line1: guestShippingAddress.line1,
      line2: guestShippingAddress.line2 || null,
      city: guestShippingAddress.city,
      emirate: guestShippingAddress.emirate,
      country: guestShippingAddress.country,
    };

    guestProfile = {
      email: guestContact?.email,
      full_name: guestContact?.full_name || guestShippingAddress.full_name,
      phone: guestContact?.phone || guestShippingAddress.phone,
    };

    if (!guestProfile.email) {
      throw new ApiError(400, "Guest email is required", "GUEST_EMAIL_REQUIRED");
    }
  }

  const rows = await getCartItemsForCheckout(client, identity, { lock });
  const items = normalizeCheckoutItems(rows);
  const totals = await computeTotals(client, items, couponCode, identity);

  return {
    owner,
    userId: normalizedUserId,
    shippingAddress,
    guestProfile,
    items,
    totals,
    couponCode: couponCode || null,
  };
};

const prepareCheckoutContext = async ({ identity, shippingAddressId, guestShippingAddress, guestContact, couponCode }) => {
  const client = await pool.connect();
  try {
    return await buildCheckoutContext({
      identity,
      shippingAddressId,
      guestShippingAddress,
      guestContact,
      couponCode,
      lock: false,
      client,
    });
  } finally {
    client.release();
  }
};

const saveStripeCheckoutSession = async (
  { identity, orderId, stripeSessionId, cartSnapshot, shippingAddress, couponCode, totals, guestProfile },
  client
) => {
  const owner = resolveOwner(identity);

  await client.query(
    `
      INSERT INTO stripe_checkout_sessions (
        stripe_session_id, order_id, user_id, guest_token,
        guest_email, guest_full_name, guest_phone,
        cart_snapshot_json, shipping_address_json, coupon_code,
        currency, subtotal, tax, shipping_fee, discount, total_amount, payment_status
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8::jsonb, $9::jsonb, $10,
        $11, $12, $13, $14, $15, $16, 'pending'
      )
      ON CONFLICT (stripe_session_id)
      DO UPDATE SET
        order_id = EXCLUDED.order_id,
        cart_snapshot_json = EXCLUDED.cart_snapshot_json,
        shipping_address_json = EXCLUDED.shipping_address_json,
        coupon_code = EXCLUDED.coupon_code,
        currency = EXCLUDED.currency,
        subtotal = EXCLUDED.subtotal,
        tax = EXCLUDED.tax,
        shipping_fee = EXCLUDED.shipping_fee,
        discount = EXCLUDED.discount,
        total_amount = EXCLUDED.total_amount,
        guest_token = EXCLUDED.guest_token,
        guest_email = EXCLUDED.guest_email,
        guest_full_name = EXCLUDED.guest_full_name,
        guest_phone = EXCLUDED.guest_phone,
        updated_at = NOW()
    `,
    [
      stripeSessionId,
      orderId,
      owner.type === "user" ? owner.value : null,
      owner.type === "guest" ? owner.value : null,
      guestProfile?.email || null,
      guestProfile?.full_name || null,
      guestProfile?.phone || null,
      JSON.stringify(cartSnapshot),
      JSON.stringify(shippingAddress),
      couponCode || null,
      totals.currency,
      totals.subtotal,
      totals.tax,
      totals.shippingFee,
      totals.discount,
      totals.totalAmount,
    ]
  );
};

const generateOrderNumber = async (client) => {
  const result = await client.query(`SELECT generate_order_number() AS order_number`);
  return result.rows[0].order_number;
};

const buildStockNeeds = (items = []) => {
  const variantNeeds = new Map();
  const productNeeds = new Map();

  for (const item of items) {
    const quantity = Number(item.quantity || 0);
    if (!quantity) continue;

    if (item.variantId) {
      const current = variantNeeds.get(item.variantId) || { qty: 0, name: item.productName };
      current.qty += quantity;
      variantNeeds.set(item.variantId, current);
    } else {
      const current = productNeeds.get(item.productId) || { qty: 0, name: item.productName };
      current.qty += quantity;
      productNeeds.set(item.productId, current);
    }
  }

  return { variantNeeds, productNeeds };
};

const insertOrderItemsBatch = async (client, orderId, items) => {
  const productIds = items.map((item) => Number(item.productId));
  const variantIds = items.map((item) => (item.variantId ? Number(item.variantId) : null));
  const names = items.map((item) => item.productName);
  const unitPrices = items.map((item) => Number(item.unitPrice));
  const quantities = items.map((item) => Number(item.quantity));
  const totalPrices = items.map((item) => Number(item.totalPrice));
  const vatPercentages = items.map(() => Number(TAX_PERCENT));

  await client.query(
    `
      INSERT INTO order_items (
        order_id, product_id, variant_id, product_name_snapshot,
        price_snapshot, quantity, total_price, vat_percentage, weight
      )
      SELECT
        $1,
        t.product_id,
        t.variant_id,
        t.product_name_snapshot,
        t.price_snapshot,
        t.quantity,
        t.total_price,
        t.vat_percentage,
        NULL::numeric
      FROM UNNEST(
        $2::int[],
        $3::int[],
        $4::text[],
        $5::numeric[],
        $6::int[],
        $7::numeric[],
        $8::numeric[]
      ) AS t(
        product_id,
        variant_id,
        product_name_snapshot,
        price_snapshot,
        quantity,
        total_price,
        vat_percentage
      )
    `,
    [orderId, productIds, variantIds, names, unitPrices, quantities, totalPrices, vatPercentages]
  );
};

const createOrderWithItems = async ({
  client,
  identity,
  guestProfile,
  paymentMethod,
  paymentStatus,
  orderStatus,
  financialStatus,
  paymentDueAmount,
  totals,
  coupon = null,
  shippingAddress,
  items,
  stripeSessionId,
  stripePaymentIntentId,
  deductStock = true,
}) => {
  await ensureOrderSchemaCompatibility();
  const owner = resolveOwner(identity);
  const guestDetails = owner.type === "guest" ? guestProfile : null;
  const orderNumber = await generateOrderNumber(client);

  const orderResult = await client.query(
    `
      INSERT INTO orders (
        user_id, guest_token, guest_email, guest_full_name, guest_phone,
        order_number, payment_method, payment_status, order_status,
        financial_status, payment_due_amount, is_guest_order,
        subtotal, tax, shipping_fee, discount, total_amount, currency,
        stripe_session_id, stripe_payment_intent_id, shipping_address_json
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7::payment_method_enum, $8::payment_status_enum, $9::order_status_enum,
        $10, $11, $12,
        $13, $14, $15, $16, $17, $18,
        $19, $20, $21::jsonb
      )
      RETURNING id, order_number, payment_status, order_status, total_amount, currency
    `,
    [
      owner.type === "user" ? owner.value : null,
      owner.type === "guest" ? owner.value : null,
      guestDetails?.email || null,
      guestDetails?.full_name || null,
      guestDetails?.phone || null,
      orderNumber,
      paymentMethod,
      paymentStatus,
      orderStatus,
      financialStatus || "unpaid",
      paymentDueAmount ?? (paymentMethod === "cod" ? totals.totalAmount : 0),
      owner.type !== "user",
      totals.subtotal,
      totals.tax,
      totals.shippingFee,
      totals.discount,
      totals.totalAmount,
      totals.currency,
      stripeSessionId || null,
      stripePaymentIntentId || null,
      JSON.stringify(shippingAddress),
    ]
  );

  const order = orderResult.rows[0];

  await insertOrderItemsBatch(client, order.id, items);

  if (deductStock) {
    await deductStockForItems(client, items);
  }

  if (coupon && coupon.id) {
    await couponService.recordUsage({
      client,
      coupon,
      identity,
      orderId: order.id,
      discountAmount: totals.discount,
    });
  }

  // Update product sales stats for recommendations (non-blocking)
  const productIds = items.map((item) => item.productId);
  const quantities = items.map((item) => item.quantity);
  setImmediate(async () => {
    try {
      await updateSalesStats(productIds, quantities);
      await syncBestSellerSection();
      await invalidateSuggestionCache();
    } catch (err) {
      console.error("[order] sales stats update failed:", err.message);
    }
  });

  return order;
};

const deductStockForItems = async (client, items) => {
  const { variantNeeds, productNeeds } = buildStockNeeds(items);

  const variantIds = [...variantNeeds.keys()];
  if (variantIds.length) {
    const variantQty = variantIds.map((id) => Number(variantNeeds.get(id).qty));

    const variantInsufficient = await client.query(
      `
        WITH requested AS (
          SELECT * FROM UNNEST($1::int[], $2::int[]) AS t(id, qty)
        )
        SELECT pv.id, pv.stock, r.qty
        FROM product_variants pv
        JOIN requested r ON r.id = pv.id
        WHERE pv.stock < r.qty
      `,
      [variantIds, variantQty]
    );

    if (variantInsufficient.rows.length) {
      const failedId = Number(variantInsufficient.rows[0].id);
      const failedName = variantNeeds.get(failedId)?.name || `variant ${failedId}`;
      throw new ApiError(409, `Insufficient stock for ${failedName}`, "INSUFFICIENT_STOCK");
    }

    await client.query(
      `
        WITH requested AS (
          SELECT * FROM UNNEST($1::int[], $2::int[]) AS t(id, qty)
        )
        UPDATE product_variants pv
        SET stock = pv.stock - r.qty
        FROM requested r
        WHERE pv.id = r.id
      `,
      [variantIds, variantQty]
    );
  }

  const productIds = [...productNeeds.keys()];
  if (productIds.length) {
    const productQty = productIds.map((id) => Number(productNeeds.get(id).qty));

    const productInsufficient = await client.query(
      `
        WITH requested AS (
          SELECT * FROM UNNEST($1::int[], $2::int[]) AS t(id, qty)
        )
        SELECT p.id, p.base_stock, r.qty
        FROM products p
        JOIN requested r ON r.id = p.id
        WHERE p.base_stock < r.qty
      `,
      [productIds, productQty]
    );

    if (productInsufficient.rows.length) {
      const failedId = Number(productInsufficient.rows[0].id);
      const failedName = productNeeds.get(failedId)?.name || `product ${failedId}`;
      throw new ApiError(409, `Insufficient stock for ${failedName}`, "INSUFFICIENT_STOCK");
    }

    await client.query(
      `
        WITH requested AS (
          SELECT * FROM UNNEST($1::int[], $2::int[]) AS t(id, qty)
        )
        UPDATE products p
        SET base_stock = p.base_stock - r.qty
        FROM requested r
        WHERE p.id = r.id
      `,
      [productIds, productQty]
    );
  }
};

const createCodOrderFromCart = async ({ identity, shippingAddressId, guestShippingAddress, guestContact, couponCode }) => {
  const owner = resolveOwner(identity);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    console.log("[checkout] cod transaction begin", { owner });

    const context = await buildCheckoutContext({
      identity,
      shippingAddressId,
      guestShippingAddress,
      guestContact,
      couponCode,
      lock: true,
      client,
    });

    const order = await createOrderWithItems({
      client,
      userId: context.userId,
      identity,
      guestProfile: context.guestProfile,
      paymentMethod: "cod",
      paymentStatus: "pending",
      orderStatus: "confirmed",
      financialStatus: "unpaid",
      paymentDueAmount: context.totals.totalAmount,
      totals: context.totals,
      coupon: context.totals.coupon,
      shippingAddress: context.shippingAddress,
      items: context.items,
    });

    await clearCartByOwner(identity, { client });
    await couponService.clearAppliedCoupon(identity);

    await client.query("COMMIT");
    console.log("[checkout] cod transaction commit", { userId: context.userId, orderId: order.id });

    return {
      order,
      totals: context.totals,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[checkout] cod transaction rollback", { message: error.message, code: error.code || null });
    throw error;
  } finally {
    client.release();
  }
};

const startStripeCheckoutSession = async ({
  identity,
  shippingAddressId,
  guestShippingAddress,
  guestContact,
  couponCode,
  successUrl,
  cancelUrl,
}) => {
  await ensureStripeSessionSchemaCompatibility();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    console.log("[checkout] stripe transaction begin", { identity });

    const context = await buildCheckoutContext({
      identity,
      shippingAddressId,
      guestShippingAddress,
      guestContact,
      couponCode,
      lock: true,
      client,
    });

    const session = await createCheckoutSession({
      lineItems: buildStripeLineItems(context.items, "aed"),
      metadata: {
        order_owner: context.owner.type,
        coupon_code: context.couponCode || "",
      },
      successUrl,
      cancelUrl,
      shippingFee: context.totals.shippingFee,
      discount: context.totals.discount,
      currency: "aed",
    });

    const order = await createOrderWithItems({
      client,
      identity,
      guestProfile: context.guestProfile,
      paymentMethod: "stripe",
      paymentStatus: "pending",
      orderStatus: "pending",
      financialStatus: "unpaid",
      paymentDueAmount: context.totals.totalAmount,
      totals: context.totals,
      coupon: context.totals.coupon,
      shippingAddress: context.shippingAddress,
      items: context.items,
      stripeSessionId: session.id,
      deductStock: false,
    });

    await saveStripeCheckoutSession(
      {
        identity,
        orderId: order.id,
        stripeSessionId: session.id,
        cartSnapshot: context.items,
        shippingAddress: context.shippingAddress,
        couponCode: context.couponCode,
        totals: context.totals,
        guestProfile: context.guestProfile,
      },
      client
    );

    await client.query("COMMIT");
    console.log("[checkout] stripe transaction commit", { orderId: order.id, stripeSessionId: session.id });

    return { session, order, context };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[checkout] stripe transaction rollback", { message: error.message, code: error.code || null });
    throw error;
  } finally {
    client.release();
  }
};

const createStripeCheckoutSnapshot = async ({
  identity,
  shippingAddressId,
  guestShippingAddress,
  guestContact,
  couponCode,
  stripeSessionId,
  orderId,
}) => {
  await ensureStripeSessionSchemaCompatibility();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const context = await buildCheckoutContext({
      identity,
      shippingAddressId,
      guestShippingAddress,
      guestContact,
      couponCode,
      lock: false,
      client,
    });

    await saveStripeCheckoutSession(
      {
        identity,
        orderId,
        stripeSessionId,
        cartSnapshot: context.items,
        shippingAddress: context.shippingAddress,
        couponCode: context.couponCode,
        totals: context.totals,
        guestProfile: context.guestProfile,
      },
      client
    );

    await client.query("COMMIT");

    return context;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const processStripeSessionCompleted = async (session) => {
  const stripeSessionId = session.id;
  const stripePaymentIntentId = session.payment_intent || null;

  const client = await pool.connect();
  try {
    await ensureStripeSessionSchemaCompatibility();
    await ensureOrderSchemaCompatibility();

    await client.query("BEGIN");
    console.log("[webhook] transaction begin", { stripeSessionId });

    const pendingResult = await client.query(
      `
        SELECT
          scs.*, o.order_number AS existing_order_number, o.payment_status AS existing_payment_status,
          o.order_status AS existing_order_status
        FROM stripe_checkout_sessions scs
        LEFT JOIN orders o ON o.id = scs.order_id
        WHERE scs.stripe_session_id = $1
        FOR UPDATE
      `,
      [stripeSessionId]
    );

    if (!pendingResult.rows.length) {
      throw new ApiError(404, "Checkout session snapshot not found", "CHECKOUT_SESSION_NOT_FOUND");
    }

    const pending = pendingResult.rows[0];

    if (pending.processed_at || pending.existing_payment_status === "paid") {
      await client.query("ROLLBACK");
      console.log("[webhook] already processed", { stripeSessionId, orderId: pending.order_id });
      return { alreadyProcessed: true, orderId: pending.order_id };
    }

    const identity = { userId: pending.user_id, guestToken: pending.guest_token };

    const snapshotItems = await normalizeSnapshotItems(client, pending.cart_snapshot_json, { lock: true });
    const totals = await computeTotals(client, snapshotItems, pending.coupon_code, identity);

    let orderId = pending.order_id || null;
    let orderNumber = pending.existing_order_number || null;

    if (!orderId) {
      const order = await createOrderWithItems({
        client,
        identity,
        guestProfile: {
          email: pending.guest_email,
          full_name: pending.guest_full_name,
          phone: pending.guest_phone,
        },
        paymentMethod: "stripe",
        paymentStatus: "pending",
        orderStatus: "pending",
        financialStatus: "unpaid",
        paymentDueAmount: totals.totalAmount,
        totals,
        coupon: totals.coupon,
        shippingAddress: pending.shipping_address_json,
        items: snapshotItems,
        stripeSessionId,
        stripePaymentIntentId,
        deductStock: false,
      });
      orderId = order.id;
      orderNumber = order.order_number;
    }

    await deductStockForItems(client, snapshotItems);

    await client.query(
      `
        UPDATE orders
        SET payment_status = 'paid', order_status = 'confirmed', financial_status = 'paid',
            payment_due_amount = 0,
            subtotal = $2, tax = $3, shipping_fee = $4, discount = $5, total_amount = $6,
            stripe_payment_intent_id = $7,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        orderId,
        totals.subtotal,
        totals.tax,
        totals.shippingFee,
        totals.discount,
        totals.totalAmount,
        stripePaymentIntentId,
      ]
    );

    await clearCartByOwner(identity, { client });
    await couponService.clearAppliedCoupon(identity);

    await client.query(
      `
        UPDATE stripe_checkout_sessions
        SET payment_status = 'paid', processed_at = NOW(), order_id = $2, updated_at = NOW()
        WHERE stripe_session_id = $1
      `,
      [stripeSessionId, orderId]
    );

    await client.query("COMMIT");
    console.log("[webhook] transaction commit", { stripeSessionId, orderId });

    return { alreadyProcessed: false, orderId, orderNumber };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[webhook] transaction rollback", {
      stripeSessionId,
      message: error.message,
      code: error.code || null,
    });
    throw error;
  } finally {
    client.release();
  }
};

const getOrderSummary = async ({ identity, orderId }) => {
  await ensureOrderSchemaCompatibility();

  const owner = resolveOwner(identity);
  const client = await pool.connect();

  try {
    const orderResult = await client.query(
      `
        SELECT
          id,
          order_number,
          payment_method,
          payment_status,
          order_status,
          subtotal,
          tax,
          shipping_fee,
          discount,
          total_amount,
          currency,
          shipping_address_json,
          guest_email,
          guest_full_name,
          guest_phone,
          user_id,
          guest_token,
          created_at,
          updated_at
        FROM orders
        WHERE id = $1
          AND (
            ($2::text = 'user' AND user_id = $3)
            OR ($2::text = 'guest' AND guest_token = $4)
          )
        LIMIT 1
      `,
      [
        orderId,
        owner.type,
        owner.type === "user" ? owner.value : null,
        owner.type === "guest" ? owner.value : null,
      ]
    );

    if (!orderResult.rows.length) {
      throw new ApiError(404, "Order not found", "ORDER_NOT_FOUND");
    }

    const order = orderResult.rows[0];

    const itemsResult = await client.query(
      `
        SELECT
          oi.product_id,
          oi.variant_id,
          oi.product_name_snapshot,
          oi.price_snapshot,
          oi.quantity,
          oi.total_price,
          p.slug,
          p.thumbnail,
          p.product_model_no AS sku,
          pv.shade,
          pv.variant_model_no
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE oi.order_id = $1
        ORDER BY oi.id ASC
      `,
      [order.id]
    );

    const items = itemsResult.rows.map((row) => ({
      product_id: row.product_id,
      variant_id: row.variant_id,
      name: row.product_name_snapshot,
      slug: row.slug || null,
      thumbnail: row.thumbnail || null,
      sku: row.sku || null,
      variant: {
        name: row.variant_model_no || null,
        shade: row.shade || null,
      },
      quantity: Number(row.quantity),
      unit_price: Number(row.price_snapshot),
      total_price: Number(row.total_price),
    }));

    return {
      id: order.id,
      order_number: order.order_number,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      order_status: order.order_status,
      totals: {
        subtotal: Number(order.subtotal),
        tax: Number(order.tax),
        shipping_fee: Number(order.shipping_fee),
        discount: Number(order.discount),
        total: Number(order.total_amount),
        currency: order.currency,
      },
      shipping_address: order.shipping_address_json,
      contact: {
        email: order.guest_email || null,
        full_name: order.guest_full_name || null,
        phone: order.guest_phone || null,
      },
      items,
      created_at: order.created_at,
      updated_at: order.updated_at,
    };
  } finally {
    client.release();
  }
};

module.exports = {
  buildCheckoutContext,
  prepareCheckoutContext,
  createStripeCheckoutSnapshot,
  createCodOrderFromCart,
  startStripeCheckoutSession,
  processStripeSessionCompleted,
  getOrderSummary,
  computeTotals,
};
