const express = require("express");
const router = express.Router();
const { asyncHandler } = require("../middlewares/async.middleware");
const { handleStripeWebhook } = require("../controllers/webhook.controller");

router.post("/stripe", express.raw({ type: "application/json" }), asyncHandler(handleStripeWebhook));

module.exports = router;
