const Stripe = require("stripe");
const { ApiError } = require("../utils/apiError");

const getStripeClient = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new ApiError(500, "Missing STRIPE_SECRET_KEY", "STRIPE_CONFIG_ERROR");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};

const toMinorUnit = (amount) => {
  const numeric = Number(amount || 0);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new ApiError(400, "Invalid amount", "INVALID_AMOUNT");
  }
  return Math.round(numeric * 100);
};

const createCheckoutSession = async ({ lineItems, metadata, successUrl, cancelUrl, shippingFee = 0, discount = 0, currency = "aed" }) => {
  const stripe = getStripeClient();

  const sessionConfig = {
    mode: "payment",
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
    payment_method_types: ["card"],
    metadata,
  };

  // Add shipping as a line item if > 0
  if (shippingFee > 0) {
    sessionConfig.line_items.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: toMinorUnit(shippingFee),
        product_data: {
          name: "Shipping",
          description: "Delivery fee",
        },
      },
    });
  }

  // Apply discount using Stripe's discounts feature
  if (discount > 0) {
    const coupon = await stripe.coupons.create({
      amount_off: toMinorUnit(discount),
      currency,
      duration: "once",
      name: metadata?.coupon_code || "Discount",
    });
    sessionConfig.discounts = [{ coupon: coupon.id }];
  }

  return stripe.checkout.sessions.create(sessionConfig);
};

const buildStripeLineItems = (items, currency = "aed") => {
  return items.map((item) => ({
    quantity: item.quantity,
    price_data: {
      currency,
      unit_amount: toMinorUnit(item.unitPrice),
      product_data: {
        name: item.productName,
        description: item.description || undefined,
      },
    },
  }));
};

const constructWebhookEvent = (rawBody, signature) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new ApiError(500, "Missing STRIPE_WEBHOOK_SECRET", "STRIPE_CONFIG_ERROR");
  }

  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
};

module.exports = {
  getStripeClient,
  createCheckoutSession,
  buildStripeLineItems,
  constructWebhookEvent,
  toMinorUnit,
};
