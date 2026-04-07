const pino = require("pino");

const isProd = process.env.NODE_ENV === "production";

const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
    base: {
      service: process.env.SERVICE_NAME || "just-gold-backend",
      env: process.env.NODE_ENV || "development",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    // Redact sensitive fields if they are accidentally logged elsewhere.
    redact: {
      paths: [
        "req.headers.authorization",
        "headers.authorization",
        "password",
        "token",
        "accessToken",
        "refreshToken",
      ],
      remove: true,
    },
  },
  // Async destination in production keeps request path logging overhead low.
  pino.destination({ sync: !isProd })
);

module.exports = logger;
