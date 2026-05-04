const pool = require("../config/db");
const { cancelOrder } = require("../services/order.service");

const VAT_PERCENT = Number(process.env.CHECKOUT_TAX_PERCENT || 0);

const ADMIN_ORDER_WHERE_TEMPLATES = new Set([
  "o.order_status = $n",
  "o.payment_status = $n",
  "o.payment_method = $n",
  "( o.order_number ILIKE $n OR u.name ILIKE $n OR u.email ILIKE $n OR o.guest_email ILIKE $n OR o.guest_full_name ILIKE $n )",
  "o.created_at >= $n",
  "o.created_at <= $n",
]);

const normalizeWhereTemplate = (condition) =>
  String(condition)
    .replace(/\$\d+/g, "$n")
    .replace(/\s+/g, " ")
    .trim();

const assertSafeAdminWhereCondition = (condition) => {
  if (!ADMIN_ORDER_WHERE_TEMPLATES.has(normalizeWhereTemplate(condition))) {
    throw new Error("Unsafe admin order filter fragment");
  }
};

exports.createOrder = async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { items, total_amount, address_id, phone } = req.body;

    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "Items are required" });

    if (!address_id)
      return res.status(400).json({ message: "address_id is required" });

    const addressResult = await client.query(
      `SELECT id, label, full_name, phone, line1, line2, city, emirate, country
       FROM user_addresses WHERE id=$1 AND user_id=$2`,
      [address_id, req.user.id]
    );

    if (!addressResult.rows.length)
      return res.status(400).json({ message: "Address not found for user" });

    const shippingAddress = addressResult.rows[0];
    const contactPhone = phone || shippingAddress.phone;

    const order = await client.query(
      "INSERT INTO orders (user_id,total_amount,phone,shipping_address) VALUES ($1,$2,$3,$4) RETURNING id, phone, shipping_address",
      [req.user.id, total_amount, contactPhone, shippingAddress]
    );

    for (let item of items) {
      await client.query(
        "INSERT INTO order_items (order_id,product_variant_id,quantity,price) VALUES ($1,$2,$3,$4)",
        [order.rows[0].id, item.variant_id, item.quantity, item.price]
      );

      await client.query(
        "UPDATE product_variants SET stock = stock - $1 WHERE id=$2",
        [item.quantity, item.variant_id]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Order placed successfully",
      order: order.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

exports.getMyOrders = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Check if coupons table exists to avoid errors on older schemas
    const couponsTableResult = await client.query(
      `SELECT to_regclass('public.coupons')::text AS table_name`
    );
    const hasCouponsTable = Boolean(couponsTableResult.rows[0]?.table_name);

    const ordersQuery = hasCouponsTable
      ? `
        SELECT
          o.id,
          o.order_number,
          o.payment_method,
          o.payment_status,
          o.order_status,
          o.subtotal,
          o.tax,
          o.shipping_fee,
          o.discount,
          o.total_amount,
          o.currency,
          o.shipping_address_json,
          o.created_at,
          o.updated_at,
          o.stripe_session_id,
          o.stripe_payment_intent_id,
          u.name AS customer_name,
          u.email AS customer_email,
          u.phone AS customer_phone,
          sc.coupon_code,
          cp.discount_type AS coupon_discount_type,
          cp.discount_value AS coupon_discount_value
        FROM orders o
        JOIN users u ON u.id = o.user_id
        LEFT JOIN stripe_checkout_sessions sc ON sc.order_id = o.id
        LEFT JOIN coupons cp ON cp.code = sc.coupon_code
        WHERE o.user_id = $1
        ORDER BY o.created_at DESC
      `
      : `
        SELECT
          o.id,
          o.order_number,
          o.payment_method,
          o.payment_status,
          o.order_status,
          o.subtotal,
          o.tax,
          o.shipping_fee,
          o.discount,
          o.total_amount,
          o.currency,
          o.shipping_address_json,
          o.created_at,
          o.updated_at,
          o.stripe_session_id,
          o.stripe_payment_intent_id,
          u.name AS customer_name,
          u.email AS customer_email,
          u.phone AS customer_phone,
          NULL::varchar AS coupon_code,
          NULL::varchar AS coupon_discount_type,
          NULL::numeric AS coupon_discount_value
        FROM orders o
        JOIN users u ON u.id = o.user_id
        LEFT JOIN stripe_checkout_sessions sc ON sc.order_id = o.id
        WHERE o.user_id = $1
        ORDER BY o.created_at DESC
      `;

    const ordersResult = await client.query(ordersQuery, [userId]);

    const orderIds = ordersResult.rows.map((row) => row.id);

    let itemsByOrderId = {};

    if (orderIds.length) {
      const itemsResult = await client.query(
        `
          SELECT
            oi.order_id,
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
            pv.variant_model_no,
            pv.main_image AS variant_image
          FROM order_items oi
          JOIN products p ON p.id = oi.product_id
          LEFT JOIN product_variants pv ON pv.id = oi.variant_id
          WHERE oi.order_id = ANY($1::uuid[])
          ORDER BY oi.id ASC
        `,
        [orderIds]
      );

      itemsByOrderId = itemsResult.rows.reduce((acc, row) => {
        if (!acc[row.order_id]) acc[row.order_id] = [];

        acc[row.order_id].push({
          product_id: row.product_id,
          name: row.product_name_snapshot,
          slug: row.slug || null,
          thumbnail: row.variant_image || row.thumbnail || null,
          sku: row.sku || null,
          variant: {
            name: row.variant_model_no || null,
            shade: row.shade || null,
            size: null,
          },
          quantity: Number(row.quantity),
          unit_price: Number(row.price_snapshot),
          discount: 0,
          tax: 0,
          total_price: Number(row.total_price),
        });

        return acc;
      }, {});
    }

    const data = ordersResult.rows.map((row) => {
      const shippingAddress = row.shipping_address_json || null;

      const couponDiscountAmount = Number(row.discount || 0);

       const createdAt = row.created_at ? new Date(row.created_at) : null;
       const now = new Date();

       let canReturn = false;
       if (row.order_status === "delivered" && createdAt) {
         const diffMs = now.getTime() - createdAt.getTime();
         const diffDays = diffMs / (1000 * 60 * 60 * 24);
         canReturn = diffDays <= 7;
       }

      return {
        id: row.id,
        order_number: row.order_number,

        customer: {
          full_name: row.customer_name,
          email: row.customer_email,
          phone: row.customer_phone,
        },

        payment: {
          method: row.payment_method,
          status: row.payment_status,
          transaction_id: row.stripe_payment_intent_id || row.stripe_session_id || null,
        },

        pricing: {
          subtotal: Number(row.subtotal),
          tax: Number(row.tax),
          shipping_fee: Number(row.shipping_fee),
          discount: Number(row.discount),
          total: Number(row.total_amount),
          currency: row.currency,
          vat_percentage: VAT_PERCENT,
        },

        coupon: {
          code: row.coupon_code || null,
          type: row.coupon_discount_type || null,
          value: row.coupon_discount_value !== null && row.coupon_discount_value !== undefined
            ? Number(row.coupon_discount_value)
            : null,
          discount_amount: couponDiscountAmount,
        },

        shipping_address: shippingAddress,
        billing_address: shippingAddress,

        items: itemsByOrderId[row.id] || [],

        tracking: {
          courier: null,
          tracking_number: null,
          tracking_url: null,
          estimated_delivery: null,
          status: row.order_status,
        },

        timeline: [
          {
            status: row.order_status,
            date: row.created_at,
          },
        ],

        invoice: {
          invoice_number: null,
          invoice_url: null,
        },

        permissions: {
          can_cancel: ["pending", "confirmed"].includes(row.order_status),
          can_return: canReturn,
          can_refund: row.payment_status === "paid",
        },

        notes: null,
        gift_wrap: false,

        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    return res.json(data);
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

// ==================== ADMIN METHODS ====================

/**
 * GET /api/v1/orders/admin/all
 * Get all orders with pagination and filters (Admin only)
 */
exports.getAllOrders = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // Filters
    const { order_status, payment_status, payment_method, search, date_from, date_to } = req.query;

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (order_status) {
      const condition = `o.order_status = $${paramIndex}`;
      assertSafeAdminWhereCondition(condition);
      whereConditions.push(condition);
      params.push(order_status);
      paramIndex++;
    }

    if (payment_status) {
      const condition = `o.payment_status = $${paramIndex}`;
      assertSafeAdminWhereCondition(condition);
      whereConditions.push(condition);
      params.push(payment_status);
      paramIndex++;
    }

    if (payment_method) {
      const condition = `o.payment_method = $${paramIndex}`;
      assertSafeAdminWhereCondition(condition);
      whereConditions.push(condition);
      params.push(payment_method);
      paramIndex++;
    }

    if (search) {
      const condition = `(
        o.order_number ILIKE $${paramIndex}
        OR u.name ILIKE $${paramIndex}
        OR u.email ILIKE $${paramIndex}
        OR o.guest_email ILIKE $${paramIndex}
        OR o.guest_full_name ILIKE $${paramIndex}
      )`;
      assertSafeAdminWhereCondition(condition);
      whereConditions.push(condition);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (date_from) {
      const condition = `o.created_at >= $${paramIndex}`;
      assertSafeAdminWhereCondition(condition);
      whereConditions.push(condition);
      params.push(date_from);
      paramIndex++;
    }

    if (date_to) {
      const condition = `o.created_at <= $${paramIndex}`;
      assertSafeAdminWhereCondition(condition);
      whereConditions.push(condition);
      params.push(date_to);
      paramIndex++;
    }

    // Dynamic WHERE assembly is restricted to validated server templates above.
    const whereClause = whereConditions.length
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      ${whereClause}
    `;
    const countResult = await client.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Orders query
    const ordersQuery = `
      SELECT
        o.id,
        o.order_number,
        o.payment_method,
        o.payment_status,
        o.order_status,
        o.subtotal,
        o.tax,
        o.shipping_fee,
        o.discount,
        o.total_amount,
        o.currency,
        o.shipping_address_json,
        o.is_guest_order,
        o.guest_email,
        o.guest_full_name,
        o.guest_phone,
        o.stripe_session_id,
        o.stripe_payment_intent_id,
        o.created_at,
        o.updated_at,
        u.id AS user_id,
        u.name AS customer_name,
        u.email AS customer_email,
        u.phone AS customer_phone,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const ordersResult = await client.query(ordersQuery, [...params, limit, offset]);

    const orders = ordersResult.rows.map((row) => ({
      id: row.id,
      order_number: row.order_number,
      is_guest_order: row.is_guest_order,
      customer: {
        id: row.user_id || null,
        name: row.is_guest_order ? row.guest_full_name : row.customer_name,
        email: row.is_guest_order ? row.guest_email : row.customer_email,
        phone: row.is_guest_order ? row.guest_phone : row.customer_phone,
      },
      payment: {
        method: row.payment_method,
        status: row.payment_status,
        transaction_id: row.stripe_payment_intent_id || row.stripe_session_id || null,
      },
      pricing: {
        subtotal: Number(row.subtotal),
        tax: Number(row.tax),
        shipping_fee: Number(row.shipping_fee),
        discount: Number(row.discount),
        total: Number(row.total_amount),
        currency: row.currency,
      },
      order_status: row.order_status,
      items_count: parseInt(row.items_count, 10),
      shipping_address: row.shipping_address_json,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return res.json({
      success: true,
      data: orders,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/orders/admin/:orderId
 * Get single order details (Admin only)
 */
exports.getOrderById = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { orderId } = req.params;

    const orderQuery = `
      SELECT
        o.id,
        o.order_number,
        o.payment_method,
        o.payment_status,
        o.order_status,
        o.payment_due_amount,
        o.subtotal,
        o.tax,
        o.shipping_fee,
        o.discount,
        o.total_amount,
        o.currency,
        o.shipping_address_json,
        o.is_guest_order,
        o.guest_email,
        o.guest_full_name,
        o.guest_phone,
        o.stripe_session_id,
        o.stripe_payment_intent_id,
        o.created_at,
        o.updated_at,
        u.id AS user_id,
        u.name AS customer_name,
        u.email AS customer_email,
        u.phone AS customer_phone
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      LIMIT 1
    `;

    const orderResult = await client.query(orderQuery, [orderId]);

    if (!orderResult.rows.length) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const row = orderResult.rows[0];

    // Get order items
    const itemsQuery = `
      SELECT
        oi.id,
        oi.product_id,
        oi.variant_id,
        oi.product_name_snapshot,
        oi.price_snapshot,
        oi.quantity,
        oi.total_price,
        oi.vat_percentage,
        p.slug,
        p.thumbnail,
        p.product_model_no AS sku,
        pv.shade,
        pv.variant_model_no,
        pv.main_image AS variant_image
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE oi.order_id = $1
      ORDER BY oi.id ASC
    `;

    const itemsResult = await client.query(itemsQuery, [orderId]);

    const items = itemsResult.rows.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      variant_id: item.variant_id,
      name: item.product_name_snapshot,
      slug: item.slug,
      thumbnail: item.variant_image || item.thumbnail,
      sku: item.sku,
      variant: {
        shade: item.shade,
        model_no: item.variant_model_no,
      },
      quantity: Number(item.quantity),
      unit_price: Number(item.price_snapshot),
      total_price: Number(item.total_price),
      vat_percentage: Number(item.vat_percentage || 0),
    }));

    // Get coupon info if available
    let couponInfo = null;
    const couponQuery = `
      SELECT scs.coupon_code, c.discount_type, c.discount_value
      FROM stripe_checkout_sessions scs
      LEFT JOIN coupons c ON c.code = scs.coupon_code
      WHERE scs.order_id = $1
      LIMIT 1
    `;
    const couponResult = await client.query(couponQuery, [orderId]);
    if (couponResult.rows.length && couponResult.rows[0].coupon_code) {
      couponInfo = {
        code: couponResult.rows[0].coupon_code,
        type: couponResult.rows[0].discount_type,
        value: Number(couponResult.rows[0].discount_value),
        discount_amount: Number(row.discount),
      };
    }

    const order = {
      id: row.id,
      order_number: row.order_number,
      is_guest_order: row.is_guest_order,
      customer: {
        id: row.user_id || null,
        name: row.is_guest_order ? row.guest_full_name : row.customer_name,
        email: row.is_guest_order ? row.guest_email : row.customer_email,
        phone: row.is_guest_order ? row.guest_phone : row.customer_phone,
      },
      payment: {
        method: row.payment_method,
        status: row.payment_status,
        payment_due_amount: Number(row.payment_due_amount),
        transaction_id: row.stripe_payment_intent_id || row.stripe_session_id || null,
      },
      pricing: {
        subtotal: Number(row.subtotal),
        tax: Number(row.tax),
        shipping_fee: Number(row.shipping_fee),
        discount: Number(row.discount),
        total: Number(row.total_amount),
        currency: row.currency,
        vat_percentage: VAT_PERCENT,
      },
      coupon: couponInfo,
      order_status: row.order_status,
      shipping_address: row.shipping_address_json,
      billing_address: row.shipping_address_json,
      items,
      timeline: [
        { status: "created", date: row.created_at },
        ...(row.order_status !== "pending" ? [{ status: row.order_status, date: row.updated_at }] : []),
      ],
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    return res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/orders/my/:orderId
 * Get my single order details (Customer)
 */
exports.getMyOrderById = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const userId = req.user?.id;
    const { orderId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const orderQuery = `
      SELECT
        o.id,
        o.order_number,
        o.payment_method,
        o.payment_status,
        o.order_status,
        o.subtotal,
        o.tax,
        o.shipping_fee,
        o.discount,
        o.total_amount,
        o.currency,
        o.shipping_address_json,
        o.stripe_payment_intent_id,
        o.created_at,
        o.updated_at,
        u.name AS customer_name,
        u.email AS customer_email,
        u.phone AS customer_phone
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.id = $1 AND o.user_id = $2
      LIMIT 1
    `;

    const orderResult = await client.query(orderQuery, [orderId, userId]);

    if (!orderResult.rows.length) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const row = orderResult.rows[0];

    const itemsQuery = `
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
        pv.variant_model_no,
        pv.main_image AS variant_image
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE oi.order_id = $1
      ORDER BY oi.id ASC
    `;

    const itemsResult = await client.query(itemsQuery, [orderId]);

    const items = itemsResult.rows.map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id,
      name: item.product_name_snapshot,
      slug: item.slug,
      thumbnail: item.variant_image || item.thumbnail,
      sku: item.sku,
      variant: { shade: item.shade, model_no: item.variant_model_no },
      quantity: Number(item.quantity),
      unit_price: Number(item.price_snapshot),
      total_price: Number(item.total_price),
    }));

    const createdAt = row.created_at ? new Date(row.created_at) : null;
    const now = new Date();
    let canReturn = false;
    if (row.order_status === "delivered" && createdAt) {
      const diffDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      canReturn = diffDays <= 7;
    }

    const order = {
      id: row.id,
      order_number: row.order_number,
      customer: {
        name: row.customer_name,
        email: row.customer_email,
        phone: row.customer_phone,
      },
      payment: {
        method: row.payment_method,
        status: row.payment_status,
        transaction_id: row.stripe_payment_intent_id || null,
      },
      pricing: {
        subtotal: Number(row.subtotal),
        tax: Number(row.tax),
        shipping_fee: Number(row.shipping_fee),
        discount: Number(row.discount),
        total: Number(row.total_amount),
        currency: row.currency,
        vat_percentage: VAT_PERCENT,
      },
      order_status: row.order_status,
      shipping_address: row.shipping_address_json,
      items,
      permissions: {
        can_cancel: ["pending", "confirmed"].includes(row.order_status),
        can_return: canReturn,
        can_refund: row.payment_status === "paid",
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    return res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/v1/orders/my/:orderId/cancel
 * Cancel user's own order
 */
exports.cancelMyOrder = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { orderId } = req.params;
    const reason = req.body?.reason || 'customer_request';

    console.log("[cancelMyOrder] request", { userId, orderId, reason });

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const identity = { userId };
    const result = await cancelOrder({ identity, orderId, reason });

    return res.json({
      success: true,
      message: "Order cancelled successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/orders/admin/:orderId/status
 * Update order status (Admin only)
 */
exports.updateOrderStatus = async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { orderId } = req.params;
    const { order_status } = req.body;

    const validStatuses = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];

    if (!order_status || !validStatuses.includes(order_status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `Invalid order_status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Check if order exists
    const checkQuery = "SELECT id, order_status FROM orders WHERE id = $1";
    const checkResult = await client.query(checkQuery, [orderId]);

    if (!checkResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const currentStatus = checkResult.rows[0].order_status;

    // Validate status transition
    const statusOrder = ["pending", "confirmed", "processing", "shipped", "delivered"];
    const currentIndex = statusOrder.indexOf(currentStatus);
    const newIndex = statusOrder.indexOf(order_status);

    // Allow cancellation from pending/confirmed only
    if (order_status === "cancelled" && !["pending", "confirmed"].includes(currentStatus)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Can only cancel orders that are pending or confirmed",
      });
    }

    // Don't allow going backwards (except for special cases)
    if (order_status !== "cancelled" && newIndex < currentIndex && currentStatus !== "cancelled") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `Cannot change status from ${currentStatus} to ${order_status}`,
      });
    }

    // Handle cancellation side effects
    if (order_status === "cancelled") {
      // Get order items for stock restore and sales stats
      const itemsQuery = `
        SELECT oi.product_id, oi.variant_id, oi.quantity
        FROM order_items oi
        WHERE oi.order_id = $1
      `;
      const itemsResult = await client.query(itemsQuery, [orderId]);
      const items = itemsResult.rows.map(row => ({
        productId: row.product_id,
        variantId: row.variant_id,
        quantity: row.quantity,
        productName: "",
      }));

      // Restore stock
      const { restoreStockForItems } = require("../services/order.service");
      await restoreStockForItems(client, items);

      // Subtract sales stats
      const { subtractSalesStats } = require("../services/suggestion.service");
      const productIds = items.map(item => item.productId);
      const quantities = items.map(item => item.quantity);
      await subtractSalesStats(productIds, quantities);

      // Invalidate caches
      const { invalidateSuggestionCache } = require("../services/suggestion.service");
      const { syncBestSellerSection } = require("../services/best-seller.service");
      await invalidateSuggestionCache();
      await syncBestSellerSection();

      // Get order payment info for refund
      const orderInfoQuery = `
        SELECT payment_status, stripe_payment_intent_id, total_amount
        FROM orders WHERE id = $1
      `;
      const orderInfo = await client.query(orderInfoQuery, [orderId]).then(r => r.rows[0]);

      // Process refund if paid
      let refundId = null;
      if (orderInfo.payment_status === "paid" && orderInfo.stripe_payment_intent_id) {
        try {
          const { createRefund } = require("../services/stripe.service");
          const refund = await createRefund(orderInfo.stripe_payment_intent_id, null, "requested_by_customer");
          refundId = refund.id;
          await client.query(
            `UPDATE orders SET payment_status = 'refunded' WHERE id = $1`,
            [orderId]
          );
        } catch (refundError) {
          console.error("Refund failed:", refundError.message);
        }
      }

      // Reverse coupon usage
      // Note: applied_cart_coupons is for cart persistence, not order-specific
      // Since coupons are cleared from cart after order creation,
      // and order is cancelled, coupon usage is effectively reversed
      // No action needed here as coupon tracking is per cart, not per order

      // Status update will be done below, trigger logs history
    }

    const updateQuery = `
      UPDATE orders
      SET order_status = $1::order_status_enum, updated_at = NOW()
      WHERE id = $2
      RETURNING id, order_number, order_status, updated_at
    `;

    const updateResult = await client.query(updateQuery, [order_status, orderId]);

    // Commit transaction before returning
    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Order status updated successfully",
      data: {
        id: updateResult.rows[0].id,
        order_number: updateResult.rows[0].order_number,
        order_status: updateResult.rows[0].order_status,
        previous_status: currentStatus,
        updated_at: updateResult.rows[0].updated_at,
      },
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError.message);
    }
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/v1/orders/admin/:orderId/payment-status
 * Update payment status (Admin only)
 */
exports.updatePaymentStatus = async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { orderId } = req.params;
    const { payment_status } = req.body;

    const validPaymentStatuses = ["pending", "paid", "failed", "refunded"];

    if (payment_status && !validPaymentStatuses.includes(payment_status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `Invalid payment_status. Must be one of: ${validPaymentStatuses.join(", ")}`,
      });
    }

    // Check if order exists
    const checkQuery = "SELECT id, payment_status FROM orders WHERE id = $1";
    const checkResult = await client.query(checkQuery, [orderId]);

    if (!checkResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const current = checkResult.rows[0];

    let updates = [];
    let params = [];
    let paramIndex = 1;

    if (payment_status) {
      updates.push(`payment_status = $${paramIndex}::payment_status_enum`);
      params.push(payment_status);
      paramIndex++;

      // Keep due amount aligned with payment state.
      if (payment_status === "paid") {
        updates.push(`payment_due_amount = 0`);
      }
    }

    if (!updates.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "No valid fields to update. Provide payment_status.",
      });
    }

    updates.push("updated_at = NOW()");
    params.push(orderId);

    const updateQuery = `
      UPDATE orders
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING id, order_number, payment_status, payment_due_amount, updated_at
    `;

    const updateResult = await client.query(updateQuery, params);

    // Commit transaction before returning
    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Payment status updated successfully",
      data: {
        id: updateResult.rows[0].id,
        order_number: updateResult.rows[0].order_number,
        payment_status: updateResult.rows[0].payment_status,
        payment_due_amount: Number(updateResult.rows[0].payment_due_amount),
        previous_payment_status: current.payment_status,
        updated_at: updateResult.rows[0].updated_at,
      },
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError.message);
    }
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/orders/admin/stats/summary
 * Get order statistics summary (Admin only)
 */
exports.getOrderStats = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { date_from, date_to } = req.query;

    let dateFilter = "";
    let params = [];

    if (date_from && date_to) {
      dateFilter = "WHERE o.created_at >= $1 AND o.created_at <= $2";
      params = [date_from, date_to];
    } else if (date_from) {
      dateFilter = "WHERE o.created_at >= $1";
      params = [date_from];
    } else if (date_to) {
      dateFilter = "WHERE o.created_at <= $1";
      params = [date_to];
    }

    // Summary stats
    const summaryQuery = `
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS total_revenue,
        COALESCE(AVG(total_amount), 0) AS average_order_value,
        COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) AS paid_orders,
        COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) AS pending_orders,
        COUNT(CASE WHEN order_status = 'delivered' THEN 1 END) AS delivered_orders,
        COUNT(CASE WHEN order_status = 'cancelled' THEN 1 END) AS cancelled_orders,
        COUNT(CASE WHEN payment_method = 'cod' THEN 1 END) AS cod_orders,
        COUNT(CASE WHEN payment_method = 'stripe' THEN 1 END) AS stripe_orders
      FROM orders o
      ${dateFilter}
    `;

    const summaryResult = await client.query(summaryQuery, params);
    const summary = summaryResult.rows[0];

    // Order status breakdown
    const statusQuery = `
      SELECT order_status, COUNT(*) AS count
      FROM orders o
      ${dateFilter}
      GROUP BY order_status
      ORDER BY count DESC
    `;

    const statusResult = await client.query(statusQuery, params);

    // Recent orders (last 5)
    const recentQuery = `
      SELECT
        o.id,
        o.order_number,
        o.total_amount,
        o.currency,
        o.order_status,
        o.payment_status,
        o.created_at,
        COALESCE(u.name, o.guest_full_name) AS customer_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      ${dateFilter}
      ORDER BY o.created_at DESC
      LIMIT 5
    `;

    const recentResult = await client.query(recentQuery, params);

    return res.json({
      success: true,
      data: {
        summary: {
          total_orders: parseInt(summary.total_orders, 10),
          total_revenue: Number(summary.total_revenue),
          average_order_value: Number(Number(summary.average_order_value).toFixed(2)),
          paid_orders: parseInt(summary.paid_orders, 10),
          pending_orders: parseInt(summary.pending_orders, 10),
          delivered_orders: parseInt(summary.delivered_orders, 10),
          cancelled_orders: parseInt(summary.cancelled_orders, 10),
          cod_orders: parseInt(summary.cod_orders, 10),
          stripe_orders: parseInt(summary.stripe_orders, 10),
        },
        status_breakdown: statusResult.rows.map((row) => ({
          status: row.order_status,
          count: parseInt(row.count, 10),
        })),
        recent_orders: recentResult.rows.map((row) => ({
          id: row.id,
          order_number: row.order_number,
          customer_name: row.customer_name,
          total: Number(row.total_amount),
          currency: row.currency,
          order_status: row.order_status,
          payment_status: row.payment_status,
          created_at: row.created_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/orders/track
 * Track order by order number and email (Guest/Public access)
 */
exports.trackOrder = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { order_number, email } = req.query;

    if (!order_number || !email) {
      return res.status(400).json({
        success: false,
        message: "order_number and email are required",
      });
    }

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();

    // Check if coupons table exists
    const couponsTableResult = await client.query(
      `SELECT to_regclass('public.coupons')::text AS table_name`
    );
    const hasCouponsTable = Boolean(couponsTableResult.rows[0]?.table_name);

    const orderQuery = hasCouponsTable
      ? `
        SELECT
          o.id,
          o.order_number,
          o.payment_method,
          o.payment_status,
          o.order_status,
          o.subtotal,
          o.tax,
          o.shipping_fee,
          o.discount,
          o.total_amount,
          o.currency,
          o.shipping_address_json,
          o.is_guest_order,
          o.guest_email,
          o.guest_full_name,
          o.guest_phone,
          o.stripe_session_id,
          o.stripe_payment_intent_id,
          o.created_at,
          o.updated_at,
          u.id AS user_id,
          u.name AS customer_name,
          u.email AS customer_email,
          u.phone AS customer_phone,
          sc.coupon_code,
          cp.discount_type AS coupon_discount_type,
          cp.discount_value AS coupon_discount_value
        FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        LEFT JOIN stripe_checkout_sessions sc ON sc.order_id = o.id
        LEFT JOIN coupons cp ON cp.code = sc.coupon_code
        WHERE o.order_number = $1
          AND (
            (o.is_guest_order = true AND LOWER(o.guest_email) = $2)
            OR (o.is_guest_order = false AND LOWER(u.email) = $2)
          )
        LIMIT 1
      `
      : `
        SELECT
          o.id,
          o.order_number,
          o.payment_method,
          o.payment_status,
          o.order_status,
          o.subtotal,
          o.tax,
          o.shipping_fee,
          o.discount,
          o.total_amount,
          o.currency,
          o.shipping_address_json,
          o.is_guest_order,
          o.guest_email,
          o.guest_full_name,
          o.guest_phone,
          o.stripe_session_id,
          o.stripe_payment_intent_id,
          o.created_at,
          o.updated_at,
          u.id AS user_id,
          u.name AS customer_name,
          u.email AS customer_email,
          u.phone AS customer_phone,
          NULL::varchar AS coupon_code,
          NULL::varchar AS coupon_discount_type,
          NULL::numeric AS coupon_discount_value
        FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        LEFT JOIN stripe_checkout_sessions sc ON sc.order_id = o.id
        WHERE o.order_number = $1
          AND (
            (o.is_guest_order = true AND LOWER(o.guest_email) = $2)
            OR (o.is_guest_order = false AND LOWER(u.email) = $2)
          )
        LIMIT 1
      `;

    const orderResult = await client.query(orderQuery, [order_number, normalizedEmail]);

    if (!orderResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Order not found or email does not match",
      });
    }

    const row = orderResult.rows[0];

    // Get order items
    const itemsQuery = `
      SELECT
        oi.id,
        oi.product_id,
        oi.variant_id,
        oi.product_name_snapshot,
        oi.price_snapshot,
        oi.quantity,
        oi.total_price,
        oi.vat_percentage,
        p.slug,
        p.thumbnail,
        p.product_model_no AS sku,
        pv.shade,
        pv.variant_model_no,
        pv.main_image AS variant_image
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE oi.order_id = $1
      ORDER BY oi.id ASC
    `;

    const itemsResult = await client.query(itemsQuery, [row.id]);

    const items = itemsResult.rows.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      variant_id: item.variant_id,
      name: item.product_name_snapshot,
      slug: item.slug,
      thumbnail: item.variant_image || item.thumbnail,
      sku: item.sku,
      variant: {
        shade: item.shade,
        model_no: item.variant_model_no,
      },
      quantity: Number(item.quantity),
      unit_price: Number(item.price_snapshot),
      total_price: Number(item.total_price),
      vat_percentage: Number(item.vat_percentage || 0),
    }));

    const shippingAddress = row.shipping_address_json || null;
    const couponDiscountAmount = Number(row.discount || 0);

    const order = {
      id: row.id,
      order_number: row.order_number,
      is_guest_order: row.is_guest_order,
      customer: {
        id: row.user_id || null,
        name: row.is_guest_order ? row.guest_full_name : row.customer_name,
        email: row.is_guest_order ? row.guest_email : row.customer_email,
        phone: row.is_guest_order ? row.guest_phone : row.customer_phone,
      },
      payment: {
        method: row.payment_method,
        status: row.payment_status,
        transaction_id: row.stripe_payment_intent_id || row.stripe_session_id || null,
      },
      pricing: {
        subtotal: Number(row.subtotal),
        tax: Number(row.tax),
        shipping_fee: Number(row.shipping_fee),
        discount: Number(row.discount),
        total: Number(row.total_amount),
        currency: row.currency,
        vat_percentage: VAT_PERCENT,
      },
      coupon: {
        code: row.coupon_code || null,
        type: row.coupon_discount_type || null,
        value: row.coupon_discount_value !== null && row.coupon_discount_value !== undefined
          ? Number(row.coupon_discount_value)
          : null,
        discount_amount: couponDiscountAmount,
      },
      order_status: row.order_status,
      shipping_address: shippingAddress,
      billing_address: shippingAddress,
      items,
      tracking: {
        courier: null,
        tracking_number: null,
        tracking_url: null,
        estimated_delivery: null,
        status: row.order_status,
      },
      timeline: [
        {
          status: row.order_status,
          date: row.created_at,
        },
      ],
      invoice: {
        invoice_number: null,
        invoice_url: null,
      },
      notes: null,
      gift_wrap: false,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    return res.json({
      success: true,
      data: order,
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};
