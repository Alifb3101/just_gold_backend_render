const pool = require("../config/db");

/**
 * POST /api/v1/contact
 * Submit a contact form
 */
exports.submitContact = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { name, email, phone, message } = req.body;

    // Validation
    const errors = [];

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      const currentLen = name ? name.trim().length : 0;
      errors.push({ field: "name", message: `Name must be at least 2 characters (you entered ${currentLen})` });
    }

    if (!email || typeof email !== "string") {
      errors.push({ field: "email", message: "Email is required" });
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        errors.push({ field: "email", message: "Invalid email format" });
      }
    }

    if (!message || typeof message !== "string" || message.trim().length < 10) {
      const currentLen = message ? message.trim().length : 0;
      errors.push({ field: "message", message: `Message must be at least 10 characters (you entered ${currentLen})` });
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    // Insert contact query
    const insertQuery = `
      INSERT INTO contact_queries (name, email, phone, message)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, phone, message, created_at
    `;

    const result = await client.query(insertQuery, [
      name.trim(),
      email.trim().toLowerCase(),
      phone ? phone.trim() : null,
      message.trim(),
    ]);

    const contactQuery = result.rows[0];

    return res.status(201).json({
      success: true,
      message: "Contact form submitted successfully. We will get back to you soon!",
      data: {
        id: contactQuery.id,
        name: contactQuery.name,
        email: contactQuery.email,
        phone: contactQuery.phone,
        message: contactQuery.message,
        created_at: contactQuery.created_at,
      },
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/contact/admin/all
 * Get all contact queries (Admin only)
 */
exports.getAllContacts = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const { search, email } = req.query;

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (search) {
      whereConditions.push(`(name ILIKE $${paramIndex} OR message ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (email) {
      whereConditions.push(`email ILIKE $${paramIndex}`);
      params.push(`%${email}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM contact_queries
      ${whereClause}
    `;
    const countResult = await client.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Data query
    const dataQuery = `
      SELECT id, name, email, phone, message, created_at
      FROM contact_queries
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataResult = await client.query(dataQuery, [...params, limit, offset]);

    return res.json({
      success: true,
      data: dataResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        message: row.message,
        created_at: row.created_at,
      })),
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
 * GET /api/v1/contact/admin/:id
 * Get single contact query by ID (Admin only)
 */
exports.getContactById = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    const query = `
      SELECT id, name, email, phone, message, created_at
      FROM contact_queries
      WHERE id = $1
      LIMIT 1
    `;

    const result = await client.query(query, [id]);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Contact query not found",
      });
    }

    const row = result.rows[0];

    return res.json({
      success: true,
      data: {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        message: row.message,
        created_at: row.created_at,
      },
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/v1/contact/admin/:id
 * Delete contact query by ID (Admin only)
 */
exports.deleteContact = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    // Check if contact exists
    const checkQuery = `SELECT id FROM contact_queries WHERE id = $1`;
    const checkResult = await client.query(checkQuery, [id]);

    if (!checkResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Contact query not found",
      });
    }

    // Delete contact
    const deleteQuery = `DELETE FROM contact_queries WHERE id = $1`;
    await client.query(deleteQuery, [id]);

    return res.json({
      success: true,
      message: "Contact query deleted successfully",
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
};
