const jwt = require("jsonwebtoken");
const { ApiError } = require("../utils/apiError");

module.exports = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return next(new ApiError(401, "Unauthorized", "UNAUTHORIZED"));
    }

    if (!process.env.JWT_SECRET) {
      return next(new ApiError(500, "JWT secret is not configured", "JWT_CONFIG_ERROR"));
    }

    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (_error) {
    next(new ApiError(401, "Invalid token", "INVALID_TOKEN"));
  }
};
