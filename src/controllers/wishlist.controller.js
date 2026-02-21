const wishlistService = require("../services/wishlist.service");

const handleError = (err, res, next) => {
  if (err.status) {
    return res.status(err.status).json({ message: err.message });
  }
  return next(err);
};

exports.addToWishlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const variantId = parseInt(req.body.product_variant_id, 10);

    if (!Number.isInteger(variantId)) {
      return res.status(400).json({ message: "product_variant_id is required" });
    }

    const variant = await wishlistService.addToWishlist(userId, variantId);

    return res.status(201).json({
      message: "Added to wishlist",
      item: {
        product_id: variant.product_id,
        product_variant_id: variant.variant_id,
        product_name: variant.product_name,
        color: variant.shade,
        color_type: variant.color_type,
        size: variant.variant_model_no,
        current_price: Number(variant.discount_price ?? variant.price ?? 0),
        stock: Number(variant.stock || 0),
      },
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.removeFromWishlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const variantId = parseInt(req.params.variantId, 10);

    if (!Number.isInteger(variantId)) {
      return res.status(400).json({ message: "Invalid variant id" });
    }

    await wishlistService.removeFromWishlist(userId, variantId);
    return res.json({ message: "Removed from wishlist" });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.getWishlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const items = await wishlistService.getWishlist(userId);
    return res.json({ items });
  } catch (err) {
    return handleError(err, res, next);
  }
};
