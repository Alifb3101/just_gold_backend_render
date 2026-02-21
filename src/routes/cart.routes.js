const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const controller = require("../controllers/cart.controller");

router.use(auth);

router.get("/", controller.getCart);
router.post("/", controller.addToCart);
router.put("/:variantId", controller.updateQuantity);
router.delete("/:variantId", controller.removeFromCart);

module.exports = router;
