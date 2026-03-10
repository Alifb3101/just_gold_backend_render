const { randomUUID } = require("crypto");
const jwt = require("jsonwebtoken");
const { ApiError } = require("../utils/apiError");

const COOKIE_NAME = process.env.GUEST_CART_COOKIE_NAME || "guest_token";
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
    throw new ApiError(401, "Invalid token", "INVALID_TOKEN");
  }
};

const ensureGuestCookie = (req, res) => {
  let guestToken = req.cookies?.[COOKIE_NAME] || null;

  if (!guestToken) {
    guestToken = randomUUID();
    res.cookie(COOKIE_NAME, guestToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction(),
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }

  return guestToken;
};

const cartIdentity = (req, res, next) => {
  try {
    const user = parseBearerToken(req);
    const guestToken = user ? null : ensureGuestCookie(req, res);

    req.identity = {
      userId: user?.id ? Number.parseInt(user.id, 10) : null,
      guestToken: guestToken || null,
      rawGuestToken: req.cookies?.[COOKIE_NAME] || guestToken || null,
      isGuest: !user,
      user,
    };

    if (!req.identity.userId && !req.identity.guestToken) {
      throw new ApiError(401, "Unauthorized", "UNAUTHORIZED");
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

const extractGuestToken = (req) => req.cookies?.[COOKIE_NAME] || null;

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
  clearGuestCookie,
  COOKIE_NAME,
};
