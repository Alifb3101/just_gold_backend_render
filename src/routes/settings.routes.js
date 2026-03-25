const router = require("express").Router();
const controller = require("../controllers/settings.controller");

/* =========================================================
   SETTINGS ROUTES
   - System configuration and settings
========================================================= */

// Get current media provider
router.get("/media-provider", controller.getMediaProvider);

// Get all settings
router.get("/", controller.getSettings);

module.exports = router;
