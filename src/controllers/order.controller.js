const pool = require("../config/db");

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
      `SELECT id, label, full_name, phone, line1, line2, city, state, postal_code, country
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
