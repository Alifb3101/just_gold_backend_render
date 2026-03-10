const wishlistService = require("../services/wishlist.service");

const handleError = (err, res, next) => {
  if (err.status) {
    return res.status(err.status).json({ message: err.message });
  }
  return next(err);
};

const toIntOrNull = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

exports.addToWishlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const productId = toIntOrNull(req.body.product_id ?? req.body.productId);
    const variantId = toIntOrNull(
      req.body.product_variant_id ??
      req.body.productVariantId ??
      req.body.variant_id ??
      req.body.variantId
    );

    if (!Number.isInteger(productId)) {
      return res.status(400).json({ message: "product_id (or productId) is required" });
    }

    const result = await wishlistService.addToWishlist(userId, { productId, variantId });
    const resolvedProduct = result.product || {};
    const resolvedVariant = result.variant || {};

    return res.status(201).json({
      message: "Added to wishlist",
      item: {
        product_id: Number(resolvedVariant.product_id ?? resolvedProduct.id),
        product_variant_id: resolvedVariant.variant_id ?? null,
        product_name: resolvedVariant.product_name ?? resolvedProduct.name ?? null,
        product_model_no: resolvedProduct.product_model_no ?? resolvedVariant.product_model_no ?? null,
        color: resolvedVariant.shade ?? null,
        color_type: resolvedVariant.color_type ?? null,
        color_panel_type: resolvedVariant.color_panel_type ?? null,
        color_panel_value: resolvedVariant.color_panel_value ?? null,
        variant_model_no: resolvedVariant.variant_model_no ?? null,
        current_price: Number(resolvedVariant.discount_price ?? resolvedVariant.price ?? resolvedProduct.base_price ?? 0),
        stock: Number(resolvedVariant.stock ?? resolvedProduct.base_stock ?? 0),
        main_image: resolvedVariant.main_image ?? resolvedProduct.thumbnail ?? null,
        secondary_image: resolvedVariant.secondary_image ?? resolvedProduct.afterimage ?? null,
      },
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.removeFromWishlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const variantId = toIntOrNull(req.params.variantId);
    const productId =
      toIntOrNull(req.params.productId) ??
      toIntOrNull(req.body?.product_id ?? req.body?.productId) ??
      toIntOrNull(req.query?.product_id ?? req.query?.productId);

    if (variantId === null && !Number.isInteger(productId)) {
      return res.status(400).json({ message: "Either valid variant id (path) or product_id is required" });
    }

    if (variantId !== null) {
      try {
        await wishlistService.removeFromWishlist(userId, variantId);
      } catch (err) {
        if (err.status === 404) {
          await wishlistService.removeFromWishlistNoVariant(userId, variantId);
        } else {
          throw err;
        }
      }
    } else {
      await wishlistService.removeFromWishlistNoVariant(userId, productId);
    }

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
