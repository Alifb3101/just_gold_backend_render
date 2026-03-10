const pool = require("../config/db");
const cartService = require("../services/cart.service");
const orderService = require("../services/order.service");
const couponService = require("../services/coupon.service");
const { ApiError } = require("../utils/apiError");

const COUPON_COOKIE = process.env.COUPON_COOKIE_NAME || "coupon_code";
const FREE_SHIPPING_THRESHOLD = Number(process.env.CHECKOUT_FREE_SHIPPING_THRESHOLD || 200);
const DEFAULT_SHIPPING_FEE = Number(process.env.CHECKOUT_SHIPPING_FEE || 20);
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

    return res.json({
      message: "Cart updated",
      item: {
        ...item,
        price_at_added: Number(item.price_at_added),
      },
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
    return res.json({ message: "Removed from cart" });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.getCart = async (req, res, next) => {
  try {
    const identity = req.identity;
    const items = await cartService.getCart(identity);

    // If cart is empty, clear any stored coupon and return empty cart
    if (!items.length) {
      await couponService.clearAppliedCoupon(identity);
      clearCouponCookie(res);
      return res.json({
        items: [],
        totals: {
          items: 0,
          subtotal: 0,
          discount: 0,
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
    }

    let couponCode =
      req.query.coupon || req.query.coupon_code || req.query.couponCode || null;

    if (!couponCode) {
      couponCode = await couponService.getAppliedCoupon(identity);
    }

    if (!couponCode) {
      couponCode = req.cookies?.[COUPON_COOKIE] || null;
    }

    if (process.env.COUPON_DEBUG === "true") {
      console.log("[coupon][cart.getCart] incoming", {
        couponCode,
        itemsCount: items.length,
        subtotal: items.reduce((sum, item) => sum + Number(item.subtotal), 0),
      });
    }

    const cartLineItems = items.map((item) => ({
      productId: item.product_id,
      variantId: item.product_variant_id,
      productName: item.product_name,
      unitPrice: Number(item.current_price),
      quantity: Number(item.quantity),
      totalPrice: Number(item.subtotal),
    }));

    const client = await pool.connect();
    let pricing;
    let appliedCouponCode = couponCode;
    try {
      pricing = await orderService.computeTotals(client, cartLineItems, couponCode, identity);
    } catch (couponErr) {
      // If coupon validation fails (e.g., minimum not met, expired, etc.), 
      // clear the invalid coupon and return cart without discount
      if (couponErr.code && couponErr.code.startsWith("COUPON")) {
        appliedCouponCode = null;
        await couponService.clearAppliedCoupon(identity);
        clearCouponCookie(res);
        // Recalculate without coupon
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
      // Coupon was provided but didn't result in a valid discount - clear it
      await couponService.clearAppliedCoupon(identity);
      clearCouponCookie(res);
    }

    const totals = {
      items: items.reduce((acc, item) => acc + Number(item.quantity), 0),
      subtotal: pricing.subtotal,
      discount: pricing.discount,
      shipping: pricing.shippingFee,
      total: pricing.totalAmount,
      currency: pricing.currency,
    };

    const coupon = pricing.coupon || {
      code: null,
      type: null,
      value: null,
      discount_amount: 0,
    };

    return res.json({
      items,
      totals,
      coupon,
      free_shipping_remaining: pricing.freeShippingRemaining,
      is_free_shipping: pricing.isFreeShipping,
    });
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

    const cartLineItems = items.map((item) => ({
      productId: item.product_id,
      variantId: item.product_variant_id,
      productName: item.product_name,
      unitPrice: Number(item.current_price),
      quantity: Number(item.quantity),
      totalPrice: Number(item.subtotal),
    }));

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
      totals: {
        subtotal: pricing.subtotal,
        discount: pricing.discount,
        shipping: pricing.shippingFee,
        tax: pricing.tax,
        total: pricing.totalAmount,
        currency: pricing.currency,
      },
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

    const cartLineItems = items.map((item) => ({
      productId: item.product_id,
      variantId: item.product_variant_id,
      productName: item.product_name,
      unitPrice: Number(item.current_price),
      quantity: Number(item.quantity),
      totalPrice: Number(item.subtotal),
    }));

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
      totals: {
        subtotal: pricing.subtotal,
        discount: pricing.discount,
        shipping: pricing.shippingFee,
        tax: pricing.tax,
        total: pricing.totalAmount,
        currency: pricing.currency,
      },
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};
