require("dotenv").config();
const app = require("./src/app");
const { initializeDatabase } = require("./src/config/initialization");
const logger = require("./src/config/logger");
const { startEmailRetryCron } = require("./src/services/email-retry-cron.service");

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";

(async () => {
  try {
    // Initialize database schema on startup
    await initializeDatabase();
    
    // Start the server
    app.listen(PORT, HOST, () => {
      logger.info({ event: "server_started", host: HOST, port: PORT }, "Server started");
      startEmailRetryCron();
    });
  } catch (err) {
    logger.error({ event: "server_start_failed", err }, "Failed to start server");
    process.exit(1);
  }
})();
