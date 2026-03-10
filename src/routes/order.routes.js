const router = require("express").Router();
const controller = require("../controllers/order.controller");
const auth = require("../middlewares/auth.middleware");

router.get("/", auth, controller.getMyOrders);
router.post("/", auth, controller.createOrder);

module.exports = router;
