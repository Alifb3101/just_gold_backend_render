const cartService = require("../services/cart.service");

const handleError = (err, res, next) => {
  if (err.status) {
    return res.status(err.status).json({ message: err.message });
  }
  return next(err);
};

exports.addToCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const variantId = parseInt(req.body.product_variant_id, 10);
    const quantity = parseInt(req.body.quantity, 10);

    if (!Number.isInteger(variantId)) {
      return res.status(400).json({ message: "product_variant_id is required" });
    }

    const result = await cartService.addToCart(userId, variantId, quantity);

    return res.status(201).json({
      message: "Added to cart",
      item: {
        ...result.item,
        price_at_added: Number(result.item.price_at_added),
        product_name: result.variant.product_name,
        current_price: Number(result.variant.discount_price ?? result.variant.price ?? 0),
        stock: Number(result.variant.stock || 0),
      },
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.updateQuantity = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const variantId = parseInt(req.params.variantId, 10);
    const quantity = parseInt(req.body.quantity, 10);

    if (!Number.isInteger(variantId)) {
      return res.status(400).json({ message: "Invalid variant id" });
    }

    const item = await cartService.updateQuantity(userId, variantId, quantity);

    return res.json({
      message: "Cart updated",
      item: {
        ...item,
        price_at_added: Number(item.price_at_added),
      },
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.removeFromCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const variantId = parseInt(req.params.variantId, 10);

    if (!Number.isInteger(variantId)) {
      return res.status(400).json({ message: "Invalid variant id" });
    }

    await cartService.removeFromCart(userId, variantId);
    return res.json({ message: "Removed from cart" });
  } catch (err) {
    return handleError(err, res, next);
  }
};

exports.getCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const items = await cartService.getCart(userId);

    const totals = items.reduce(
      (acc, item) => {
        acc.subtotal += item.subtotal;
        acc.items += item.quantity;
        return acc;
      },
      { subtotal: 0, items: 0 }
    );

    return res.json({ items, totals });
  } catch (err) {
    return handleError(err, res, next);
  }
};
