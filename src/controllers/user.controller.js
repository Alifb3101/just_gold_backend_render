const pool = require("../config/db");
const bcrypt = require("bcrypt");

/**
 * POST /api/v1/users
 * Create a new user (Admin only)
 */
exports.createUser = async (req, res, next) => {
  try {
    const { name, email, password, phone, role } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const validRoles = ['admin', 'user', 'staff'];
    const userRole = role && validRoles.includes(role) ? role : 'user';

    // Check if email already exists
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 12);

    // Insert user
    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash, phone, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, phone, created_at",
      [name || null, email, hashed, phone || null, userRole]
    );

    res.status(201).json({
      message: "User created successfully",
      data: result.rows[0]
    });
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const countResult = await pool.query("SELECT COUNT(*)::int AS total FROM users");
    const total = countResult.rows[0].total;

    const usersResult = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.phone, u.created_at,
              COALESCE(json_agg(a ORDER BY a.is_default DESC, a.created_at DESC)
                       FILTER (WHERE a.id IS NOT NULL), '[]') AS addresses
       FROM users u
       LEFT JOIN user_addresses a ON a.user_id = u.id
       GROUP BY u.id, u.name, u.email, u.role, u.phone, u.created_at
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({ total, data: usersResult.rows });
  } catch (err) {
    next(err);
  }
};

exports.me = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.phone, u.created_at,
              COALESCE(json_agg(a ORDER BY a.is_default DESC, a.created_at DESC)
                       FILTER (WHERE a.id IS NOT NULL), '[]') AS addresses
       FROM users u
       LEFT JOIN user_addresses a ON a.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id, u.name, u.email, u.role, u.phone, u.created_at`,
      [req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ message: "User not found" });

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/users/:id
 * Get user by ID (Admin only)
 */
exports.getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.phone, u.created_at,
              COALESCE(json_agg(a ORDER BY a.is_default DESC, a.created_at DESC)
                       FILTER (WHERE a.id IS NOT NULL), '[]') AS addresses
       FROM users u
       LEFT JOIN user_addresses a ON a.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id, u.name, u.email, u.role, u.phone, u.created_at`,
      [id]
    );

    if (!result.rows.length) return res.status(404).json({ message: "User not found" });

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/users/:id/role
 * Update user role (Admin only)
 */
exports.updateUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    // Validation
    const validRoles = ['admin', 'user', 'staff'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ 
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}` 
      });
    }

    // Check if user exists
    const checkResult = await pool.query("SELECT id, name, email, role FROM users WHERE id = $1", [id]);
    if (!checkResult.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    const oldRole = checkResult.rows[0].role;

    // Update role
    await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);

    res.json({
      message: "User role updated successfully",
      data: {
        id: parseInt(id),
        name: checkResult.rows[0].name,
        email: checkResult.rows[0].email,
        old_role: oldRole,
        new_role: role
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/users/me
 * Update current user profile
 */
exports.updateProfile = async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    const userId = req.user.id;

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({ message: "Name must be at least 2 characters" });
      }
      updates.push(`name = $${paramIndex}`);
      values.push(name.trim());
      paramIndex++;
    }

    if (phone !== undefined) {
      if (phone !== null && phone !== '' && !/^[0-9+\-\s()]+$/.test(phone)) {
        return res.status(400).json({ message: "Invalid phone number format" });
      }
      updates.push(`phone = $${paramIndex}`);
      values.push(phone || null);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    values.push(userId);

    const query = `
      UPDATE users 
      SET ${updates.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, name, email, role, phone, created_at
    `;

    const result = await pool.query(query, values);

    if (!result.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Profile updated successfully",
      data: result.rows[0]
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/users/:id
 * Delete user (Admin only)
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }

    // Check if user exists
    const checkResult = await pool.query("SELECT id, name, email FROM users WHERE id = $1", [id]);
    if (!checkResult.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    // Delete user (cascade should handle related records)
    await pool.query("DELETE FROM users WHERE id = $1", [id]);

    res.json({
      message: "User deleted successfully",
      data: {
        id: parseInt(id),
        name: checkResult.rows[0].name,
        email: checkResult.rows[0].email
      }
    });
  } catch (err) {
    next(err);
  }
};
