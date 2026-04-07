const { randomUUID } = require("crypto");
const logger = require("../config/logger");

module.exports = (req, res, next) => {
  const requestId = randomUUID();
  req.id = requestId;

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    const payload = {
      event: "http_request",
      requestId,
      method: req.method,
      route: req.originalUrl,
      statusCode: res.statusCode,
      responseTimeMs: Number(durationMs.toFixed(2)),
    };

    if (res.statusCode >= 500) {
      logger.error(payload, "HTTP request failed");
      return;
    }

    if (res.statusCode >= 400) {
      logger.warn(payload, "HTTP request warning");
      return;
    }

    logger.info(payload, "HTTP request completed");
  });

  next();
};