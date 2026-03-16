const { randomUUID } = require("crypto");
const jwt = require("jsonwebtoken");
const { ApiError } = require("../utils/apiError");

const COOKIE_NAME = process.env.GUEST_CART_COOKIE_NAME || "guest_token";
const HEADER_NAME = process.env.GUEST_TOKEN_HEADER_NAME || "X-Guest-Token";
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const isProduction = () => process.env.NODE_ENV === "production";

const parseBearerToken = (req) => {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (!token && !scheme) return null;
  if (scheme !== "Bearer") {
    throw new ApiError(401, "Unauthorized", "UNAUTHORIZED");
  }

  if (!process.env.JWT_SECRET) {
    throw new ApiError(500, "JWT secret is not configured", "JWT_CONFIG_ERROR");
  }

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (_err) {
    // Token is expired or invalid — fall back to guest identity
    return null;
  }
};

/**
 * Extracts guest token from request.
 * Priority: Header > Cookie
 * Frontend sends via X-Guest-Token header
 * Backend can also set cookies for fallback
 */
const extractGuestToken = (req) => {
  // Priority 1: X-Guest-Token header (from frontend localStorage)
  const headerToken = req.headers[HEADER_NAME.toLowerCase()] || 
                      req.headers[HEADER_NAME] ||
                      req.get(HEADER_NAME) ||
                      null;
  
  if (headerToken) {
    return headerToken;
  }

  // Priority 2: Cookie (fallback)
  return req.cookies?.[COOKIE_NAME] || null;
};

/**
 * Ensures guest token exists for cart operations.
 * If frontend provides token via header, uses that.
 * Otherwise, generates new UUID and optionally sets cookie.
 */
const ensureOrCreateGuestToken = (req, res) => {
  // Check if header token exists
  const headerToken = req.headers[HEADER_NAME.toLowerCase()] || 
                      req.headers[HEADER_NAME] ||
                      req.get(HEADER_NAME) ||
                      null;
  
  if (headerToken) {
    return headerToken;
  }

  // Check if cookie exists
  let guestToken = req.cookies?.[COOKIE_NAME] || null;

  // If neither exists, generate new UUID
  if (!guestToken) {
    guestToken = randomUUID();
    // Set cookie as fallback (optional, for servers that support cookies)
    res.cookie(COOKIE_NAME, guestToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction(),
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }

  return guestToken;
};

/**
 * Cart identity middleware
 * Supports both authenticated users (via JWT) and guest users (via X-Guest-Token header)
 * 
 * Sets req.identity with:
 * - userId: authenticated user ID (null for guests)
 * - guestToken: guest token from header or cookie
 * - isGuest: boolean flag
 * - user: decoded JWT user object (null for guests)
 */
const cartIdentity = (req, res, next) => {
  try {
    const user = parseBearerToken(req);
    
    // If authenticated, use user ID
    if (user?.id) {
      req.identity = {
        userId: Number.parseInt(user.id, 10),
        guestToken: null,
        isGuest: false,
        user,
      };
      return next();
    }

    // If guest, extract or create guest token
    const guestToken = ensureOrCreateGuestToken(req, res);

    if (!guestToken) {
      throw new ApiError(401, "Unauthorized", "NO_IDENTITY");
    }

    req.identity = {
      userId: null,
      guestToken: guestToken,
      isGuest: true,
      user: null,
    };

    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Clear guest cookie (for logout)
 */
const clearGuestCookie = (res) => {
  res.cookie(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    expires: new Date(0),
  });
};

module.exports = {
  cartIdentity,
  extractGuestToken,
  ensureOrCreateGuestToken,
  clearGuestCookie,
  COOKIE_NAME,
  HEADER_NAME,
};
