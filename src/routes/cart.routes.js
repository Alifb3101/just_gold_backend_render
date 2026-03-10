const router = require("express").Router();
const { cartIdentity } = require("../middlewares/identity.middleware");
const controller = require("../controllers/cart.controller");

router.use(cartIdentity);

router.get("/", controller.getCart);
router.post("/", controller.addToCart);
router.put("/", controller.updateQuantity);
router.put("/product/:productId", controller.updateQuantity);
router.put("/:variantId", controller.updateQuantity);
router.post("/apply-coupon", controller.applyCoupon);
router.post("/remove-coupon", controller.removeCoupon);
router.delete("/", controller.removeFromCart);
router.delete("/product/:productId", controller.removeFromCart);
router.delete("/:variantId", controller.removeFromCart);

module.exports = router;
