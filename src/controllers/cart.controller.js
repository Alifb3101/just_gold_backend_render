const pool = require("../config/db");
const cartService = require("../services/cart.service");
const orderService = require("../services/order.service");
const couponService = require("../services/coupon.service");
const { ApiError } = require("../utils/apiError");

const COUPON_COOKIE = process.env.COUPON_COOKIE_NAME || "coupon_code";
const FREE_SHIPPING_THRESHOLD = Number(process.env.CHECKOUT_FREE_SHIPPING_THRESHOLD || 200);
const DEFAULT_SHIPPING_FEE = Number(process.env.CHECKOUT_SHIPPING_FEE || 26);
const isProd = () => process.env.NODE_ENV === "production";
const setCouponCookie = (res, code) => {
  if (!code) return;
  res.cookie(COUPON_COOKIE, code, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};
const clearCouponCookie = (res) => {
  res.cookie(COUPON_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    expires: new Date(0),
  });
};

const handleError = (err, res, next) => {
  if (err.status) {
    return res.status(err.status).json({ message: err.message });
  }
  return next(err);
};

const toIntOrNull = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const buildCartLineItems = (items = []) =>
  items.map((item) => ({
    productId: item.product_id,
    variantId: item.product_variant_id,
    productName: item.product_name,
    unitPrice: Number(item.current_price),
    quantity: Number(item.quantity),
    totalPrice: Number(item.subtotal),
  }));

const buildTotalsPayload = ({ pricing, items }) => ({
  items: items.reduce((acc, item) => acc + Number(item.quantity), 0),
  subtotal: Number(pricing.subtotal),
  discount: Number(pricing.discount),
  tax: Number(pricing.tax),
  shipping: Number(pricing.shippingFee),
  total: Number(pricing.totalAmount),
  currency: pricing.currency,
});

const buildEmptyCartPayload = () => ({
  items: [],
  totals: {
    items: 0,
    subtotal: 0,
    discount: 0,
    tax: 0,
    shipping: 0,
    total: 0,
    currency: "AED",
  },
  coupon: {
    code: null,
    type: null,
    value: null,
    discount_amount: 0,
  },
  free_shipping_remaining: FREE_SHIPPING_THRESHOLD,
  is_free_shipping: false,
});

const resolveCouponCodeFromRequest = async ({ identity, req }) => {
  let couponCode =
    req.query.coupon || req.query.coupon_code || req.query.couponCode || null;

  if (!couponCode) {
    couponCode = await couponService.getAppliedCoupon(identity);
  }

  if (!couponCode) {
    couponCode = req.cookies?.[COUPON_COOKIE] || null;
  }

  return couponCode;
};

const buildCartSnapshotPayload = async ({ identity, req, res }) => {
  const items = await cartService.getCart(identity);

  if (!items.length) {
    await couponService.clearAppliedCoupon(identity);
    clearCouponCookie(res);
    return buildEmptyCartPayload();
  }

  const couponCode = await resolveCouponCodeFromRequest({ identity, req });

  if (process.env.COUPON_DEBUG === "true") {
    console.log("[coupon][cart.snapshot] incoming", {
      couponCode,
      itemsCount: items.length,
      subtotal: items.reduce((sum, item) => sum + Number(item.subtotal), 0),
    });
  }

  const cartLineItems = buildCartLineItems(items);
  const client = await pool.connect();

  let pricing;
  let appliedCouponCode = couponCode;
  try {
    pricing = await orderService.computeTotals(client, cartLineItems, couponCode, identity);
  } catch (couponErr) {
    if (couponErr.code && couponErr.code.startsWith("COUPON")) {
      appliedCouponCode = null;
      await couponService.clearAppliedCoupon(identity);
      clearCouponCookie(res);
      pricing = await orderService.computeTotals(client, cartLineItems, null, identity);
    } else {
      throw couponErr;
    }
  } finally {
    client.release();
  }

  if (pricing.coupon?.code) {
    await couponService.setAppliedCoupon(identity, pricing.coupon.code);
    setCouponCookie(res, pricing.coupon.code);
  } else if (appliedCouponCode) {
    await couponService.clearAppliedCoupon(identity);
    clearCouponCookie(res);
  }

  return {
    items,
    totals: buildTotalsPayload({ pricing, items }),
    coupon: pricing.coupon || {
      code: null,
      type: null,
      value: null,
      discount_amount: 0,
    },
    free_shipping_remaining: pricing.freeShippingRemaining,
    is_free_shipping: pricing.isFreeShipping,
  };
};

exports.addToCart = async (req, res, next) => {
  try {
    const identity = req.identity;
    if (!identity) {
      throw new ApiError(401, "Unauthorized", "UNAUTHORIZED");
    }
    const productIdInput = req.body.product_id ?? req.body.productId;
    const variantIdInput =
      req.body.product_variant_id ??
      req.body.productVariantId ??
      req.body.variant_id ??
      req.body.variantId;
    const quantityInput = req.body.quantity ?? 1;

    const productId = parseInt(productIdInput, 10);
    const hasVariantInput = !(variantIdInput === undefined || variantIdInput === null || variantIdInput === "");
    const variantId = hasVariantInput ? parseInt(variantIdInput, 10) : null;
    const quantity = parseInt(quantityInput, 10);

    if (!Number.isInteger(productId)) {
      return res.status(400).json({ message: "product_id (or productId) is required" });
    }

    if (hasVariantInput && !Number.isInteger(variantId)) {
      return res.status(400).json({ message: "Invalid product_variant_id (or productVariantId)" });
    }

    const result = await cartService.addToCart(identity, {
      productId,
      variantId,
      quantity,
    });

    const resolvedProduct = result.product || {};
    const resolvedVariant = result.variant || {};
    const currentPrice = Number(
      resolvedVariant.discount_price ??
      resolvedVariant.price ??
      resolvedProduct.base_price ??
      0
    );

    const cart = await buildCartSnapshotPayload({ identity, req, res });

    return res.status(201).json({
      message: "Added to cart",
      item: {
        ...result.item,
        productVariantId: result.item.product_variant_id,
        productId: result.item.product_id,
        price_at_added: Number(result.item.price_at_added),
        priceAtAdded: Number(result.item.price_at_added),
        product_name: resolvedVariant.product_name ?? resolvedProduct.name ?? null,
        productName: resolvedVariant.product_name ?? resolvedProduct.name ?? null,
        product_model_no: resolvedProduct.product_model_no ?? null,
        productModelNo: resolvedProduct.product_model_no ?? null,
        variant_model_no: resolvedVariant.variant_model_no ?? null,
        variantModelNo: resolvedVariant.variant_model_no ?? null,
        current_price: currentPrice,
        currentPrice: currentPrice,
        stock: Number(resolvedVariant.stock ?? resolvedProduct.base_stock ?? 0),
        color_panel_type: resolvedVariant.color_panel_type ?? null,
        colorPanelType: resolvedVariant.color_panel_type ?? null,
        color_panel_value: resolvedVariant.color_panel_value ?? null,
        colorPanelValue: resolvedVariant.color_panel_value ?? null,
        main_image: resolvedVariant.main_image ?? resolvedProduct.thumbnail ?? null,
        mainImage: resolvedVariant.main_image ?? resolvedProduct.thumbnail ?? null,
        secondary_image: resolvedVariant.secondary_image ?? resolvedProduct.afterimage ?? null,
        secondaryImage: resolvedVariant.secondary_image ?? resolvedProduct.afterimage ?? null,
      },
      cart,
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.updateQuantity = async (req, res, next) => {
  try {
    const identity = req.identity;
    const variantId = toIntOrNull(req.params.variantId);
    const productId =
      toIntOrNull(req.params.productId) ??
      toIntOrNull(req.body.product_id ?? req.body.productId) ??
      toIntOrNull(req.query.product_id ?? req.query.productId);
    const quantity = parseInt(req.body.quantity, 10);

    if (variantId === null && !Number.isInteger(productId)) {
      return res.status(400).json({ message: "Either valid variant id (path) or product_id (body) is required" });
    }

    let item;
    if (variantId !== null) {
      try {
        item = await cartService.updateQuantity(identity, variantId, quantity);
      } catch (err) {
        if (err.status === 404) {
          item = await cartService.updateQuantityNoVariant(identity, variantId, quantity);
        } else {
          throw err;
        }
      }
    } else {
      item = await cartService.updateQuantityNoVariant(identity, productId, quantity);
    }

    const cart = await buildCartSnapshotPayload({ identity, req, res });

    return res.json({
      message: "Cart updated",
      item: {
        ...item,
        price_at_added: Number(item.price_at_added),
      },
      cart,
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.removeFromCart = async (req, res, next) => {
  try {
    const identity = req.identity;
    const variantId = toIntOrNull(req.params.variantId);
    const productId =
      toIntOrNull(req.params.productId) ??
      toIntOrNull(req.body?.product_id ?? req.body?.productId) ??
      toIntOrNull(req.query?.product_id ?? req.query?.productId);

    if (variantId === null && !Number.isInteger(productId)) {
      return res.status(400).json({ message: "Either valid variant id (path) or product_id is required" });
    }

    if (variantId !== null) {
      try {
        await cartService.removeFromCart(identity, variantId);
      } catch (err) {
        if (err.status === 404) {
          await cartService.removeFromCartNoVariant(identity, variantId);
        } else {
          throw err;
        }
      }
    } else {
      await cartService.removeFromCartNoVariant(identity, productId);
    }

    const cart = await buildCartSnapshotPayload({ identity, req, res });
    return res.json({ message: "Removed from cart", cart });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.getCart = async (req, res, next) => {
  try {
    const identity = req.identity;
    const snapshot = await buildCartSnapshotPayload({ identity, req, res });
    return res.json(snapshot);
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.applyCoupon = async (req, res, next) => {
  try {
    const identity = req.identity;
    if (!identity) {
      throw new ApiError(401, "Unauthorized", "UNAUTHORIZED");
    }

    const code = req.body.coupon || req.body.coupon_code || req.body.couponCode || req.body.code;
    if (!code) {
      throw new ApiError(400, "coupon_code is required", "COUPON_REQUIRED");
    }

    const items = await cartService.getCart(identity);
    if (!items.length) {
      throw new ApiError(400, "Cart is empty", "CART_EMPTY");
    }

    const cartLineItems = buildCartLineItems(items);

    const client = await pool.connect();
    let pricing;
    try {
      pricing = await orderService.computeTotals(client, cartLineItems, code, identity);
    } finally {
      client.release();
    }

    if (pricing.coupon?.code) {
      await couponService.setAppliedCoupon(identity, pricing.coupon.code);
      setCouponCookie(res, pricing.coupon.code);
    }

    return res.json({
      success: true,
      message: "Coupon applied",
      coupon: pricing.coupon,
      totals: buildTotalsPayload({ pricing, items }),
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.removeCoupon = async (req, res, next) => {
  try {
    const identity = req.identity;
    if (!identity) {
      throw new ApiError(401, "Unauthorized", "UNAUTHORIZED");
    }

    const items = await cartService.getCart(identity);
    if (!items.length) {
      throw new ApiError(400, "Cart is empty", "CART_EMPTY");
    }

    const cartLineItems = buildCartLineItems(items);

    const client = await pool.connect();
    let pricing;
    try {
      pricing = await orderService.computeTotals(client, cartLineItems, null, identity);
    } finally {
      client.release();
    }

    await couponService.clearAppliedCoupon(identity);
    clearCouponCookie(res);

    return res.json({
      success: true,
      message: "Coupon removed",
      coupon: {
        code: null,
        type: null,
        value: null,
        discount_amount: 0,
      },
      totals: buildTotalsPayload({ pricing, items }),
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};
