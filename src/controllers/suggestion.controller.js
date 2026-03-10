/* =========================================================
   PRODUCT SUGGESTION CONTROLLER
   - Handles GET /api/products/:productId/suggestions
   - Returns similar, frequently bought together, and trending
========================================================= */

const { getProductSuggestions } = require("../services/suggestion.service");
const { asyncHandler } = require("../middlewares/async.middleware");

/* =========================================================
   GET PRODUCT SUGGESTIONS
   GET /api/products/:productId/suggestions
   
   Response:
   {
     "similarProducts": [...],
     "frequentlyBoughtTogether": [...],
     "trendingProducts": [...]
   }
========================================================= */

const getProductSuggestionsHandler = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  // Validate productId
  const id = parseInt(productId, 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid product ID",
    });
  }

  const suggestions = await getProductSuggestions(id);

  if (!suggestions) {
    return res.status(404).json({
      success: false,
      message: "Product not found",
    });
  }

  res.json({
    success: true,
    data: suggestions,
  });
});

module.exports = {
  getProductSuggestionsHandler,
};
