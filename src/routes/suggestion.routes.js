/* =========================================================
   PRODUCT SUGGESTION ROUTES
   - GET /api/products/:productId/suggestions
========================================================= */

const router = require("express").Router();
const { getProductSuggestionsHandler } = require("../controllers/suggestion.controller");

/* =========================================================
   PUBLIC ENDPOINTS (No auth required)
========================================================= */

// GET /api/products/:productId/suggestions
router.get("/products/:productId/suggestions", getProductSuggestionsHandler);

module.exports = router;
