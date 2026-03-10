const pool = require("../config/db");

const VAT_PERCENT = Number(process.env.CHECKOUT_TAX_PERCENT || 0);

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
          o.financial_status,
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
          o.financial_status,
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
            pv.variant_model_no
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
          thumbnail: row.thumbnail || null,
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
          can_refund: row.financial_status === "paid",
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
