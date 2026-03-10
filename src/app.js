const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");

const app = express();

/* ---------------- CORS ---------------- */

const corsOptions = {
  origin: true, // reflect request origin (useful in dev)
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Apply CORS before any other middleware or routes (handles preflight too)
app.use(cors(corsOptions));

/* ---------------- SECURITY ---------------- */

// Secure headers
app.use(helmet());

// JSON parsing
app.use(compression());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// NOTE: All media now stored in Cloudinary - no local uploads folder needed

// Rate limiting
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
  })
);

/* ---------------- HEALTH CHECK ---------------- */

app.get("/", (req, res) => {
  res.json({ status: "Backend_Just_gold API Running 🚀" });
});

/* ---------------- ROUTES ---------------- */

app.use("/api/webhook", require("./routes/webhook.routes"));
app.use("/api/v1/auth", require("./routes/auth.routes"));
app.use("/api/v1", require("./routes/product.routes"));
app.use("/api/v1/orders", require("./routes/order.routes"));
app.use("/api/v1/categories", require("./routes/category.routes"));
app.use("/api/v1", require("./routes/search.routes"));
app.use("/api/v1/addresses", require("./routes/address.routes"));
app.use("/api/v1/users", require("./routes/user.routes"));
app.use("/api/v1/cart", require("./routes/cart.routes"));
app.use("/api/v1/wishlist", require("./routes/wishlist.routes"));
app.use("/api/v1", require("./routes/suggestion.routes"));
app.use("/api/checkout", require("./routes/checkout.routes"));
app.use("/api/v1/checkout", require("./routes/checkout.routes"));
app.use("/api", require("./routes/section.routes"));
app.use("/api/v1", require("./routes/section.routes"));


/* ---------------- 404 HANDLER ---------------- */

app.use((req, res) => {
  res.status(404).json({ message: "Route Not Found" });
});

/* ---------------- GLOBAL ERROR ---------------- */

app.use(require("./middlewares/error.middleware"));

module.exports = app;
