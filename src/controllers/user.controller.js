const pool = require("../config/db");

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
