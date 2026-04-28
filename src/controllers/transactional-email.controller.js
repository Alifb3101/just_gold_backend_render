const crypto = require("crypto");
const pool = require("../config/db");
const { asyncHandler } = require("../middlewares/async.middleware");
const { sanitizeText, sanitizeEmail } = require("../services/input-sanitizer.service");
const { sendEmail } = require("../services/mail.service");
const { newsletterWelcomeTemplate } = require("../templates/emails/newsletterWelcome.template");
const { contactAutoReplyTemplate } = require("../templates/emails/contactAutoReply.template");
const { orderConfirmationTemplate } = require("../templates/emails/orderConfirmation.template");
const { orderStatusTemplate } = require("../templates/emails/orderStatus.template");
const { passwordResetTemplate } = require("../templates/emails/passwordReset.template");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const FRONTEND_URL =
  process.env.FRONTEND_URL_email || process.env.FRONTEND_URL || "http://localhost:3000";

const getOrderNumber = async (client) => {
  try {
    const result = await client.query("SELECT generate_order_number() AS order_number");
    return result.rows[0]?.order_number;
  } catch (_e) {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const randomPart = Math.floor(Math.random() * 900000 + 100000);
    return `ORD-${stamp}-${randomPart}`;
  }
};

const textFromHtml = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const sendTemplatedEmail = async ({ to, subject, html, templateKey }) => {
  return sendEmail({
    to,
    subject,
    html,
    text: textFromHtml(html),
    templateKey,
    payload: {
      html,
      text: textFromHtml(html),
    },
  });
};

const getNewsletterSubscriberById = async (subscriberId) => {
  const result = await pool.query(
    `
      SELECT id, email, name, is_active, subscribed_at, created_at, updated_at
      FROM newsletter_subscribers
      WHERE id = $1
      LIMIT 1
    `,
    [subscriberId]
  );

  return result.rows[0] || null;
};

const subscribeNewsletter = asyncHandler(async (req, res) => {
  const email = sanitizeEmail(req.body.email);
  const name = sanitizeText(req.body.name || "", 120);

  const existing = await pool.query(
    "SELECT id, is_active FROM newsletter_subscribers WHERE email = $1 LIMIT 1",
    [email]
  );
  if (existing.rows.length) {
    if (!existing.rows[0].is_active) {
      await pool.query(
        `
          UPDATE newsletter_subscribers
          SET name = $2,
              is_active = TRUE,
              subscribed_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [existing.rows[0].id, name || null]
      );

      const html = newsletterWelcomeTemplate({ name });
      await sendTemplatedEmail({
        to: email,
        subject: "Welcome to Just Gold Cosmetics",
        html,
        templateKey: "newsletter_welcome",
      });

      return res.status(200).json({
        success: true,
        message: "Subscribed successfully",
      });
    }

    return res.status(409).json({
      success: false,
      message: "Email is already subscribed",
    });
  }

  await pool.query(
    `
      INSERT INTO newsletter_subscribers (email, name)
      VALUES ($1, $2)
    `,
    [email, name || null]
  );

  const html = newsletterWelcomeTemplate({ name });
  await sendTemplatedEmail({
    to: email,
    subject: "Welcome to Just Gold Cosmetics",
    html,
    templateKey: "newsletter_welcome",
  });

  return res.status(201).json({
    success: true,
    message: "Subscribed successfully",
  });
});

const createContactMessage = asyncHandler(async (req, res) => {
  const name = sanitizeText(req.body.name, 120);
  const email = sanitizeEmail(req.body.email);
  const phone = sanitizeText(req.body.phone || "", 32);
  const message = sanitizeText(req.body.message, 5000);
  const subject = sanitizeText(req.body.subject || "New Contact Message", 160);

  const insertResult = await pool.query(
    `
      INSERT INTO contact_messages (name, email, phone, subject, message)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, created_at
    `,
    [name, email, phone || null, subject, message]
  );

  const adminHtml = `
    <h2>New Contact Message</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Phone:</strong> ${phone || "N/A"}</p>
    <p><strong>Subject:</strong> ${subject}</p>
    <p><strong>Message:</strong> ${message}</p>
  `;

  if (ADMIN_EMAIL) {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `[Contact] ${subject}`,
      html: adminHtml,
      text: textFromHtml(adminHtml),
      templateKey: "contact_admin_notification",
      payload: {
        html: adminHtml,
        text: textFromHtml(adminHtml),
      },
    });
  }

  const autoReplyHtml = contactAutoReplyTemplate({ name });
  await sendTemplatedEmail({
    to: email,
    subject: "Thanks for contacting Just Gold Cosmetics",
    html: autoReplyHtml,
    templateKey: "contact_auto_reply",
  });

  return res.status(201).json({
    success: true,
    message: "Contact message submitted successfully",
    data: insertResult.rows[0],
  });
});

const createOrderAndSendEmail = asyncHandler(async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      user_id,
      customer_name,
      customer_email,
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
      items,
    } = req.body;

    await client.query("BEGIN");

    const orderNumber = await getOrderNumber(client);

    const orderResult = await client.query(
      `
        INSERT INTO orders (
          user_id,
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
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
        RETURNING id, order_number, total_amount, currency
      `,
      [
        user_id,
        orderNumber,
        payment_method,
        payment_status,
        order_status,
        subtotal,
        tax,
        shipping_fee,
        discount,
        total_amount,
        currency.toUpperCase(),
        shipping_address_json,
      ]
    );

    const order = orderResult.rows[0];

    for (const item of items) {
      await client.query(
        `
          INSERT INTO order_items (
            order_id,
            product_id,
            variant_id,
            product_name_snapshot,
            price_snapshot,
            quantity,
            total_price,
            created_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        `,
        [
          order.id,
          item.product_id,
          item.variant_id || null,
          sanitizeText(item.name, 255),
          item.price,
          item.quantity,
          item.price * item.quantity,
        ]
      );
    }

    await client.query("COMMIT");

    const userResult = await pool.query("SELECT name, email FROM users WHERE id = $1 LIMIT 1", [user_id]);
    const resolvedName = sanitizeText(customer_name || userResult.rows[0]?.name || "Customer", 120);
    const resolvedEmail = sanitizeEmail(customer_email || userResult.rows[0]?.email || "");

    if (resolvedEmail) {
      const html = orderConfirmationTemplate({
        customerName: resolvedName,
        orderNumber: order.order_number,
        totalAmount: order.total_amount,
        currency: order.currency,
        items,
      });

      await sendTemplatedEmail({
        to: resolvedEmail,
        subject: `Order Confirmation - ${order.order_number}`,
        html,
        templateKey: "order_confirmation",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: order,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

const updateOrderStatusAndNotify = asyncHandler(async (req, res) => {
  const orderId = sanitizeText(req.params.id, 64);
  const status = String(req.body.status || "").toLowerCase();

  const updateResult = await pool.query(
    `
      UPDATE orders
      SET order_status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, order_number, order_status
    `,
    [orderId, status]
  );

  if (!updateResult.rows.length) {
    return res.status(404).json({
      success: false,
      message: "Order not found",
    });
  }

  const order = updateResult.rows[0];
  const userResult = await pool.query("SELECT name, email FROM users WHERE id = $1 LIMIT 1", [order.user_id]);
  const email = sanitizeEmail(userResult.rows[0]?.email || "");
  const customerName = sanitizeText(userResult.rows[0]?.name || "Customer", 120);

  if (email) {
    const html = orderStatusTemplate({
      customerName,
      orderNumber: order.order_number,
      status,
    });

    await sendTemplatedEmail({
      to: email,
      subject: `Order ${order.order_number} is now ${status}`,
      html,
      templateKey: "order_status",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Order status updated",
    data: order,
  });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const email = sanitizeEmail(req.body.email);

  const userResult = await pool.query("SELECT id, name, email FROM users WHERE email = $1 LIMIT 1", [email]);

  if (!userResult.rows.length) {
    return res.status(200).json({
      success: true,
      message: "If that email exists, a reset link has been sent",
    });
  }

  const user = userResult.rows[0];
  const plainToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await pool.query(
    `
      UPDATE password_reset_tokens
      SET used_at = NOW(), updated_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
    `,
    [String(user.id)]
  );

  await pool.query(
    `
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `,
    [String(user.id), tokenHash, expiresAt]
  );

  const resetUrl = `${FRONTEND_URL.replace(/\/+$/, "")}/reset-password?token=${plainToken}`;
  const html = passwordResetTemplate({ resetUrl, expiresInMinutes: 30 });

  await sendTemplatedEmail({
    to: user.email,
    subject: "Reset Your Just Gold Password",
    html,
    templateKey: "password_reset",
  });

  return res.status(200).json({
    success: true,
    message: "If that email exists, a reset link has been sent",
  });
});

const getNewsletterSubscribers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
  const offset = (page - 1) * limit;
  const search = sanitizeText(req.query.search || "", 160);

  const values = [];
  let where = "";
  if (search) {
    values.push(`%${search}%`);
    where = `WHERE email ILIKE $${values.length} OR name ILIKE $${values.length}`;
  }

  const countSql = `SELECT COUNT(*)::int AS total FROM newsletter_subscribers ${where}`;
  const countResult = await pool.query(countSql, values);
  const total = countResult.rows[0]?.total || 0;

  values.push(limit, offset);
  const dataSql = `
    SELECT id, email, name, is_active, subscribed_at, created_at, updated_at
    FROM newsletter_subscribers
    ${where}
    ORDER BY is_active DESC, subscribed_at DESC NULLS LAST, id DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `;

  const dataResult = await pool.query(dataSql, values);

  return res.status(200).json({
    success: true,
    data: dataResult.rows,
    pagination: { total, page, limit },
  });
});

const updateNewsletterSubscriber = asyncHandler(async (req, res) => {
  const subscriberId = sanitizeText(req.params.id, 64);
  const hasEmail = Object.prototype.hasOwnProperty.call(req.body, "email");
  const hasName = Object.prototype.hasOwnProperty.call(req.body, "name");
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body, "is_active");

  const existing = await getNewsletterSubscriberById(subscriberId);
  if (!existing) {
    return res.status(404).json({
      success: false,
      message: "Subscriber not found",
    });
  }

  const nextEmail = hasEmail ? sanitizeEmail(req.body.email) : existing.email;
  const nextName = hasName ? sanitizeText(req.body.name || "", 120) || null : existing.name;
  const nextIsActive = hasIsActive ? Boolean(req.body.is_active) : existing.is_active;

  if (hasEmail && nextEmail !== existing.email) {
    const duplicate = await pool.query(
      `SELECT id FROM newsletter_subscribers WHERE email = $1 AND id <> $2 LIMIT 1`,
      [nextEmail, subscriberId]
    );
    if (duplicate.rows.length) {
      return res.status(409).json({
        success: false,
        message: "Another subscriber already uses this email",
      });
    }
  }

  const updateResult = await pool.query(
    `
      UPDATE newsletter_subscribers
      SET email = $2,
          name = $3,
          is_active = $4,
          subscribed_at = CASE WHEN $4 = TRUE AND is_active = FALSE THEN NOW() ELSE subscribed_at END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, name, is_active, subscribed_at, created_at, updated_at
    `,
    [subscriberId, nextEmail, nextName, nextIsActive]
  );

  return res.status(200).json({
    success: true,
    message: "Subscriber updated successfully",
    data: updateResult.rows[0],
  });
});

const removeNewsletterSubscriber = asyncHandler(async (req, res) => {
  const subscriberId = sanitizeText(req.params.id, 64);
  const hardDelete = String(req.query.hard || req.headers["x-confirm-delete"] || "")
    .toLowerCase()
    .trim();
  const shouldHardDelete = hardDelete === "true" || hardDelete === "1" || hardDelete === "yes";

  if (shouldHardDelete) {
    const deleteResult = await pool.query(
      `
        DELETE FROM newsletter_subscribers
        WHERE id = $1
        RETURNING id, email, name, is_active, subscribed_at, created_at, updated_at
      `,
      [subscriberId]
    );

    if (!deleteResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Subscriber not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subscriber deleted permanently",
      data: deleteResult.rows[0],
    });
  }

  const updateResult = await pool.query(
    `
      UPDATE newsletter_subscribers
      SET is_active = FALSE,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, name, is_active, subscribed_at, created_at, updated_at
    `,
    [subscriberId]
  );

  if (!updateResult.rows.length) {
    return res.status(404).json({
      success: false,
      message: "Subscriber not found",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Subscriber removed successfully",
    data: updateResult.rows[0],
  });
});

module.exports = {
  subscribeNewsletter,
  getNewsletterSubscribers,
  updateNewsletterSubscriber,
  removeNewsletterSubscriber,
  createContactMessage,
  createOrderAndSendEmail,
  updateOrderStatusAndNotify,
  forgotPassword,
};
