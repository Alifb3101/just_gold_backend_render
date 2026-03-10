const pool = require("../config/db");

const UAE_EMIRATES = [
  "Abu Dhabi",
  "Dubai",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
];

exports.list = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, label, full_name, phone, line1, line2, city, emirate, country, is_default, created_at
       FROM user_addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const {
      label = "Home",
      full_name,
      phone,
      line1,
      line2,
      city,
      emirate,
      country,
    } = req.body;

    if (!full_name || !phone || !line1)
      return res.status(400).json({ message: "full_name, phone, and line1 are required" });

    if (!emirate || !UAE_EMIRATES.includes(emirate)) {
      return res.status(400).json({ message: "A valid emirate is required" });
    }

    const normalizedCountry = country || "United Arab Emirates";

    const result = await pool.query(
      `INSERT INTO user_addresses (user_id,label,full_name,phone,line1,line2,city,emirate,country)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, label, full_name, phone, line1, line2, city, emirate, country, is_default, created_at`,
      [
        req.user.id,
        label,
        full_name,
        phone,
        line1,
        line2 || null,
        city || null,
        emirate,
        normalizedCountry,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

exports.listEmirates = (req, res) => {
  res.json(UAE_EMIRATES);
};

exports.setDefault = async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { id } = req.params;

    const owned = await client.query(
      "SELECT id FROM user_addresses WHERE id=$1 AND user_id=$2",
      [id, req.user.id]
    );

    if (!owned.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Address not found" });
    }

    await client.query("UPDATE user_addresses SET is_default=false WHERE user_id=$1", [req.user.id]);
    await client.query("UPDATE user_addresses SET is_default=true WHERE id=$1", [id]);

    await client.query("COMMIT");

    res.json({ message: "Default address updated" });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM user_addresses WHERE id=$1 AND user_id=$2 RETURNING id",
      [id, req.user.id]
    );

    if (!result.rowCount)
      return res.status(404).json({ message: "Address not found" });

    res.json({ message: "Address deleted" });
  } catch (err) {
    next(err);
  }
};
