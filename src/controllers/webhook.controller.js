const { ApiError } = require("../utils/apiError");
const { constructWebhookEvent } = require("../services/stripe.service");
const { processStripeSessionCompleted } = require("../services/order.service");

const handleStripeWebhook = async (req, res) => {
  const signature = req.headers["stripe-signature"];
  if (!signature) {
    throw new ApiError(400, "Missing Stripe signature", "MISSING_STRIPE_SIGNATURE");
  }

  let event;
  try {
    event = constructWebhookEvent(req.body, signature);
  } catch (error) {
    console.error("[webhook] signature verification failed", { message: error.message });
    throw new ApiError(400, "Invalid Stripe signature", "INVALID_STRIPE_SIGNATURE");
  }

  console.log("[webhook] received", { type: event.type, id: event.id });

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    await processStripeSessionCompleted(session);
  }

  return res.status(200).json({ received: true });
};

module.exports = {
  handleStripeWebhook,
};
