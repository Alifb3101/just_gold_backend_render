const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const controller = require("../controllers/wishlist.controller");

router.use(auth);

router.get("/", controller.getWishlist);
router.post("/", controller.addToWishlist);
router.delete("/:variantId", controller.removeFromWishlist);

module.exports = router;
