const Joi = require("joi");
const { ApiError } = require("../utils/apiError");
const {
  startStripeCheckoutSession,
  createCodOrderFromCart,
  getOrderSummary,
} = require("../services/order.service");
const couponService = require("../services/coupon.service");

const COUPON_COOKIE = process.env.COUPON_COOKIE_NAME || "coupon_code";
const isProd = () => process.env.NODE_ENV === "production";
const setCouponCookie = (res, code) => {
  if (!code) return;
  res.cookie(COUPON_COOKIE, code, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

const guestShippingSchema = Joi.object({
  label: Joi.string().trim().max(120).allow(null, ""),
  full_name: Joi.string().trim().min(2).max(120).required(),
  phone: Joi.string().trim().min(6).max(32).required(),
  line1: Joi.string().trim().min(3).max(255).required(),
  line2: Joi.string().trim().allow(null, "").max(255),
  city: Joi.string().trim().max(120).required(),
  emirate: Joi.string().trim().max(120).required(),
  country: Joi.string().trim().max(120).required(),
});

const checkoutSchema = Joi.object({
  payment_method: Joi.string().valid("stripe", "cod"),
  paymentMethod: Joi.string().valid("stripe", "cod"),
  shipping_address_id: Joi.number().integer().positive(),
  shippingAddressId: Joi.number().integer().positive(),
  shipping_address: guestShippingSchema,
  shippingAddress: guestShippingSchema,
  guest_email: Joi.string().trim().email().max(254),
  guestEmail: Joi.string().trim().email().max(254),
  guest_full_name: Joi.string().trim().max(120),
  guestFullName: Joi.string().trim().max(120),
  guest_phone: Joi.string().trim().max(32),
  guestPhone: Joi.string().trim().max(32),
  coupon_code: Joi.string().trim().max(64).allow(null, ""),
  couponCode: Joi.string().trim().max(64).allow(null, ""),
}).or("payment_method", "paymentMethod");

const createSession = async (req, res) => {
  const identity = req.identity;
  const body = req.body || {};

  const paymentMethod = body.payment_method ?? body.paymentMethod;
  const shippingAddressId = body.shipping_address_id ?? body.shippingAddressId;
  const guestShippingAddress = body.shipping_address ?? body.shippingAddress;
  let couponCode = body.coupon_code ?? body.couponCode;

  if (!couponCode) {
    couponCode = await couponService.getAppliedCoupon(identity);
  }

  if (!couponCode) {
    couponCode = req.cookies?.[COUPON_COOKIE] || null;
  }

  if (process.env.COUPON_DEBUG === "true") {
    console.log("[coupon][checkout.createSession] incoming", {
      couponCode,
      paymentMethod,
    });
  }

  const guestContact = {
    email: body.guest_email ?? body.guestEmail ?? null,
    full_name: body.guest_full_name ?? body.guestFullName ?? guestShippingAddress?.full_name ?? null,
    phone: body.guest_phone ?? body.guestPhone ?? guestShippingAddress?.phone ?? null,
  };

  const isGuest = !identity?.userId;

  if (paymentMethod === "cod") {
    if (isGuest && !guestShippingAddress) {
      throw new ApiError(400, "shipping_address is required for guest checkout", "INVALID_SHIPPING_ADDRESS");
    }

    if (isGuest && !guestContact.email) {
      throw new ApiError(400, "guest_email is required", "GUEST_EMAIL_REQUIRED");
    }

    if (!isGuest && !shippingAddressId) {
      throw new ApiError(400, "shipping_address_id is required", "INVALID_SHIPPING_ADDRESS");
    }

    if (couponCode) {
      await couponService.setAppliedCoupon(identity, couponCode);
      setCouponCookie(res, couponCode);
    }

    const codResult = await createCodOrderFromCart({
      identity,
      shippingAddressId,
      guestShippingAddress,
      guestContact,
      couponCode,
    });

    return res.status(201).json({
      success: true,
      message: "COD order created successfully",
      data: {
        order_id: codResult.order.id,
        order_number: codResult.order.order_number,
        payment_status: codResult.order.payment_status,
        order_status: codResult.order.order_status,
        total_amount: Number(codResult.order.total_amount),
        currency: codResult.order.currency,
      },
    });
  }

  if (!process.env.FRONTEND_URL) {
    throw new ApiError(500, "Missing FRONTEND_URL", "FRONTEND_URL_MISSING");
  }
  if (isGuest && !guestShippingAddress) {
    throw new ApiError(400, "shipping_address is required for guest checkout", "INVALID_SHIPPING_ADDRESS");
  }

  if (!isGuest && !shippingAddressId) {
    throw new ApiError(400, "shipping_address_id is required", "INVALID_SHIPPING_ADDRESS");
  }

  if (isGuest && !guestContact.email) {
    throw new ApiError(400, "guest_email is required", "GUEST_EMAIL_REQUIRED");
  }

  const successUrl = `${process.env.FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${process.env.FRONTEND_URL}/checkout/cancel`;

  const { session, order } = await startStripeCheckoutSession({
    identity,
    shippingAddressId,
    guestShippingAddress,
    guestContact,
    couponCode,
    successUrl,
    cancelUrl,
  });

  if (couponCode) {
    await couponService.setAppliedCoupon(identity, couponCode);
    setCouponCookie(res, couponCode);
  }

  console.log("[checkout] stripe session created", {
    owner: identity,
    stripeSessionId: session.id,
    orderId: order.id,
  });

  return res.status(201).json({
    success: true,
    url: session.url,
    session_url: session.url,
    session_id: session.id,
    data: {
      session_id: session.id,
      url: session.url,
      payment_method: "stripe",
      order_id: order.id,
      order_number: order.order_number,
    },
  });
};

const getGuestOrder = async (req, res) => {
  const identity = req.identity;
  const orderId = req.params.orderId;

  const summary = await getOrderSummary({ identity, orderId });

  return res.status(200).json({
    success: true,
    data: summary,
  });
};

module.exports = {
  checkoutSchema,
  createSession,
  getGuestOrder,
};
