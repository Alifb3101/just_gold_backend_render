require("dotenv").config();
const app = require("./src/app");
const { initializeDatabase } = require("./src/config/initialization");

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";

(async () => {
  try {
    // Initialize database schema on startup
    await initializeDatabase();
    
    // Start the server
    app.listen(PORT, HOST, () => {
      console.log(`🚀 Server running at http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();
