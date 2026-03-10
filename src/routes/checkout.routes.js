const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { validate } = require("../middlewares/validation.middleware");
const { asyncHandler } = require("../middlewares/async.middleware");
const { cartIdentity } = require("../middlewares/identity.middleware");
const { createSession, checkoutSchema, getGuestOrder } = require("../controllers/checkout.controller");

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many checkout attempts. Please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

router.post(
  "/create-session",
  checkoutLimiter,
  cartIdentity,
  validate(checkoutSchema),
  asyncHandler(createSession)
);

router.get(
  "/guest-order/:orderId",
  cartIdentity,
  asyncHandler(getGuestOrder)
);

module.exports = router;
