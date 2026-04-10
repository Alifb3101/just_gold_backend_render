const pool = require("../config/db");
const { ApiError } = require("../utils/apiError");
const couponRepository = require("../repositories/coupon.repository");
const { getRedisClient } = require("../config/redis");

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const isCouponDebugEnabled = () => String(process.env.COUPON_DEBUG || "").toLowerCase() === "true";

const normalizeIdentity = (identity = {}) => {
  const parsedUserId = Number.parseInt(identity.userId ?? identity.user_id, 10);
  const userId = Number.isInteger(parsedUserId) ? parsedUserId : null;
  const guestToken = identity.guestToken || identity.guest_token || null;
  return { userId, guestToken };
};

const couponStoreKey = (identity = {}) => {
  const { userId, guestToken } = normalizeIdentity(identity);
  if (userId) return `cart:coupon:user:${userId}`;
  if (guestToken) return `cart:coupon:guest:${guestToken}`;
  throw new ApiError(401, "Unauthorized", "UNAUTHORIZED");
};

const setAppliedCoupon = async (identity, code) => {
  if (!code) return;
  const { userId, guestToken } = normalizeIdentity(identity);
  
  // Try Redis first (fast)
  try {
    const redisClient = await getRedisClient();
    if (redisClient) {
      const key = couponStoreKey(identity);
      await redisClient.set(key, code, { EX: 60 * 60 * 24 * 7 });
    }
  } catch (err) {
    // Redis failed, continue to DB
  }

  // Always persist to database (reliable)
  const dbClient = await pool.connect();
  try {
    await couponRepository.ensureSchema(dbClient);
    await couponRepository.setAppliedCartCoupon(dbClient, { userId, guestToken, couponCode: code });
  } finally {
    dbClient.release();
  }
};

const getAppliedCoupon = async (identity) => {
  const { userId, guestToken } = normalizeIdentity(identity);
  
  // Try Redis first (fast)
  try {
    const redisClient = await getRedisClient();
    if (redisClient) {
      const key = couponStoreKey(identity);
      const code = await redisClient.get(key);
      if (code) return code;
    }
  } catch (err) {
    // Redis failed, continue to DB
  }

  // Fallback to database (reliable)
  const dbClient = await pool.connect();
  try {
    await couponRepository.ensureSchema(dbClient);
    return await couponRepository.getAppliedCartCoupon(dbClient, { userId, guestToken });
  } finally {
    dbClient.release();
  }
};

const clearAppliedCoupon = async (identity) => {
  const { userId, guestToken } = normalizeIdentity(identity);
  
  // Clear from Redis
  try {
    const redisClient = await getRedisClient();
    if (redisClient) {
      const key = couponStoreKey(identity);
      await redisClient.del(key);
    }
  } catch (err) {
    // Redis failed, continue to DB
  }

  // Clear from database
  const dbClient = await pool.connect();
  try {
    await couponRepository.ensureSchema(dbClient);
    await couponRepository.clearAppliedCartCoupon(dbClient, { userId, guestToken });
  } finally {
    dbClient.release();
  }
};

const assertIdentity = (identity) => {
  const { userId, guestToken } = normalizeIdentity(identity);
  if (!userId && !guestToken) {
    throw new ApiError(401, "Unauthorized", "UNAUTHORIZED");
  }
};

const calculateDiscountAmount = (coupon, subtotal) => {
  const value = Number(coupon.discount_value || 0);
  let discount = 0;

  if (coupon.discount_type === "percentage") {
    discount = round2((subtotal * value) / 100);
  } else if (coupon.discount_type === "fixed") {
    discount = round2(value);
  }

  if (coupon.max_discount_amount !== null && coupon.max_discount_amount !== undefined) {
    const maxCap = Number(coupon.max_discount_amount);
    if (Number.isFinite(maxCap) && maxCap >= 0) {
      discount = Math.min(discount, maxCap);
    }
  }

  return round2(discount);
};

const normalizeCouponAudience = (coupon = {}) => {
  const raw = String(coupon.audience || "").trim().toLowerCase();
  if (raw === "users_only" || raw === "guests_only" || raw === "all") {
    return raw;
  }

  // Backward-compatible fallback for existing welcome coupons until audience is set in DB.
  if (/^welcome/i.test(String(coupon.code || ""))) {
    return "users_only";
  }

  return "all";
};

const validateCoupon = async ({ client, code, subtotal, identity }) => {
  if (!code) {
    return { amount: 0, coupon: null };
  }

  assertIdentity(identity);

  await couponRepository.ensureSchema(client);

  const coupon = await couponRepository.findByCode(client, code);
  if (!coupon) {
    throw new ApiError(400, "Invalid coupon code", "INVALID_COUPON");
  }

  if (!coupon.is_active) {
    throw new ApiError(400, "Coupon is inactive", "COUPON_INACTIVE");
  }

  const now = new Date();
  if (coupon.start_date && new Date(coupon.start_date) > now) {
    throw new ApiError(400, "Coupon not started yet", "COUPON_NOT_STARTED");
  }
  if (coupon.end_date && new Date(coupon.end_date) < now) {
    throw new ApiError(400, "Coupon has expired", "COUPON_EXPIRED");
  }

  const minAmount = Number(coupon.min_order_amount || 0);
  if (subtotal < minAmount) {
    throw new ApiError(400, "Cart total below minimum for coupon", "COUPON_MINIMUM_NOT_MET");
  }

  const usageLimit = coupon.usage_limit;
  const usedCount = Number(coupon.used_count || 0);
  if (usageLimit !== null && usageLimit !== undefined && usedCount >= usageLimit) {
    throw new ApiError(400, "Coupon usage limit reached", "COUPON_LIMIT_REACHED");
  }

  const { userId, guestToken } = normalizeIdentity(identity);

  const audience = normalizeCouponAudience(coupon);
  if (audience === "users_only" && !userId) {
    throw new ApiError(400, "This coupon is available for logged-in users only", "COUPON_LOGIN_REQUIRED");
  }
  if (audience === "guests_only" && !guestToken) {
    throw new ApiError(400, "This coupon is available for guest checkout only", "COUPON_GUEST_ONLY");
  }

  const usageStats = await couponRepository.getUsageStats(client, coupon.id, { userId, guestToken });
  if (coupon.per_user_limit && usageStats.user_used >= coupon.per_user_limit) {
    throw new ApiError(400, "Per-user coupon limit reached", "COUPON_PER_USER_LIMIT");
  }

  const discountAmount = calculateDiscountAmount(coupon, subtotal);

  if (isCouponDebugEnabled()) {
    console.log("[coupon][validate]", {
      code,
      subtotal,
      type: coupon.discount_type,
      value: Number(coupon.discount_value),
      max: coupon.max_discount_amount,
      minOrder: minAmount,
      discountAmount,
    });
  }

  return {
    amount: discountAmount,
    coupon: {
      id: coupon.id,
      code: coupon.code,
      type: coupon.discount_type,
      value: Number(coupon.discount_value),
      max_discount_amount: coupon.max_discount_amount !== null && coupon.max_discount_amount !== undefined
        ? Number(coupon.max_discount_amount)
        : null,
      audience,
      discount_amount: discountAmount,
      usage_limit: coupon.usage_limit,
      per_user_limit: coupon.per_user_limit,
    },
  };
};

const getDiscount = async ({ client, code, subtotal, identity }) => {
  return validateCoupon({ client, code, subtotal, identity });
};

const recordUsage = async ({ client, coupon, identity, orderId, discountAmount }) => {
  if (!coupon?.id) {
    return;
  }
  assertIdentity(identity);
  await couponRepository.ensureSchema(client);

  const { userId, guestToken } = normalizeIdentity(identity);
  const inserted = await couponRepository.insertUsageIfNeeded(client, {
    couponId: coupon.id,
    orderId,
    userId,
    guestToken,
    discountAmount: round2(discountAmount || 0),
  });

  if (inserted) {
    await couponRepository.incrementUsedCount(client, coupon.id, coupon.usage_limit);
  }
};

const applyToCart = async ({ identity, cartItems, couponCode }) => {
  assertIdentity(identity);

  const client = await pool.connect();
  try {
    const subtotal = round2(cartItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0));
    const { amount: discount, coupon } = await validateCoupon({ client, code: couponCode, subtotal, identity });
    return { discount, coupon };
  } finally {
    client.release();
  }
};

module.exports = {
  getDiscount,
  recordUsage,
  applyToCart,
  normalizeIdentity,
  setAppliedCoupon,
  getAppliedCoupon,
  clearAppliedCoupon,
};
