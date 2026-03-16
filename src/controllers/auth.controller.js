const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { mergeGuestCartIntoUser } = require("../services/cart.service");
const { extractGuestToken, clearGuestCookie } = require("../middlewares/identity.middleware");

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    const existing = await pool.query(
      "SELECT id FROM users WHERE email=$1",
      [email]
    );

    if (existing.rows.length)
      return res.status(400).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 12);

    const result = await pool.query(
      "INSERT INTO users (name,email,password_hash,phone) VALUES ($1,$2,$3,$4) RETURNING id,email,role,phone",
      [name, email, hashed, phone || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (!result.rows.length)
      return res.status(401).json({ message: "Invalid credentials" });

    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Extract guest token from header (X-Guest-Token) or cookie
    // Priority: Header > Cookie
    const guestToken = extractGuestToken(req);
    
    if (guestToken) {
      try {
        // Merge guest cart items into user's cart
        await mergeGuestCartIntoUser(user.id, guestToken);
        
        // Clear the guest token cookie (header token is frontend-managed)
        clearGuestCookie(res);
        
        if (process.env.NODE_ENV === "development") {
          console.log(`[auth] Guest cart merged: user_id=${user.id}, guestToken=${guestToken}`);
        }
      } catch (mergeError) {
        // Log but don't fail the login
        console.error("[auth] guest cart merge failed", { 
          userId: user.id,
          message: mergeError.message,
          stack: process.env.NODE_ENV === "development" ? mergeError.stack : undefined,
        });
      }
    }

    res.json({ 
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      }
    });
  } catch (err) {
    next(err);
  }
};
