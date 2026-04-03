const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { cartIdentity } = require("../middlewares/identity.middleware");
const controller = require("../controllers/cart.controller");

const cartMutationLimiter = rateLimit({
	windowMs: 10 * 1000,
	max: 30,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, message: "Too many cart updates. Please wait a moment." },
});

router.use(cartIdentity);

router.get("/", controller.getCart);
router.post("/", cartMutationLimiter, controller.addToCart);
router.put("/", cartMutationLimiter, controller.updateQuantity);
router.patch("/", cartMutationLimiter, controller.updateQuantity);
router.put("/product/:productId", cartMutationLimiter, controller.updateQuantity);
router.patch("/product/:productId", cartMutationLimiter, controller.updateQuantity);
router.put("/:variantId", cartMutationLimiter, controller.updateQuantity);
router.patch("/:variantId", cartMutationLimiter, controller.updateQuantity);
router.post("/apply-coupon", controller.applyCoupon);
router.post("/remove-coupon", controller.removeCoupon);
router.delete("/", cartMutationLimiter, controller.removeFromCart);
router.delete("/product/:productId", cartMutationLimiter, controller.removeFromCart);
router.delete("/:variantId", cartMutationLimiter, controller.removeFromCart);

module.exports = router;
