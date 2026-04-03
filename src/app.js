const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");

const app = express();

// Respect original client IP when running behind proxies/load balancers.
app.set("trust proxy", 1);

/* ---------------- CORS with X-Guest-Token Support ---------------- */

const corsOptions = {
  // In production, use specific domains; in dev, accept all
  origin: process.env.NODE_ENV === "production" 
    ? [
        process.env.FRONTEND_URL || "https://your-frontend-domain.com",
        process.env.FRONTEND_URL_ALT || undefined,
      ].filter(Boolean)
    : true,
  credentials: true, // Allow cookies and auth headers
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Guest-Token", // Frontend guest token header
    "X-Requested-With",
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"], // Expose headers for the frontend
  maxAge: 86400, // 24 hours preflight cache
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

// Rate limiting (configurable via env)
const parsedWindowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10);
const parsedMax = Number.parseInt(process.env.RATE_LIMIT_MAX || "1000", 10);

app.use(
  rateLimit({
    windowMs: Number.isInteger(parsedWindowMs) && parsedWindowMs > 0 ? parsedWindowMs : 15 * 60 * 1000,
    max: Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
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
app.use("/api/v1", require("./routes/review.routes"));
app.use("/api/checkout", require("./routes/checkout.routes"));
app.use("/api/v1/checkout", require("./routes/checkout.routes"));
app.use("/api", require("./routes/section.routes"));
app.use("/api/v1", require("./routes/section.routes"));
app.use("/api/v1/settings", require("./routes/settings.routes"));


/* ---------------- 404 HANDLER ---------------- */

app.use((req, res) => {
  res.status(404).json({ message: "Route Not Found" });
});

/* ---------------- GLOBAL ERROR ---------------- */

app.use(require("./middlewares/error.middleware"));

module.exports = app;
