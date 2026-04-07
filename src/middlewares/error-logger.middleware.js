const logger = require("../config/logger");

module.exports = (err, req, res, next) => {
  const statusCode = err?.statusCode || err?.status || 500;
  const safeStack = err?.stack
    ? String(err.stack).split("\n").slice(0, 20).join("\n")
    : undefined;

  logger.error(
    {
      event: "unhandled_error",
      method: req.method,
      path: req.originalUrl,
      statusCode,
      code: err?.code,
      message: err?.message,
      // Stack is logged only to server logs, never returned in API responses.
      stack: safeStack,
    },
    "Unhandled application error"
  );

  next(err);
};
