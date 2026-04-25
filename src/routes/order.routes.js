const router = require("express").Router();
const controller = require("../controllers/order.controller");
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");

// Public/Guest routes
router.get("/track", controller.trackOrder);

// Customer routes
router.get("/", auth, controller.getMyOrders);
router.post("/", auth, controller.createOrder);
router.get("/my/:orderId", auth, controller.getMyOrderById);
router.patch("/my/:orderId/cancel", auth, controller.cancelMyOrder);

// Admin routes
router.get("/admin/all", auth, role("admin"), controller.getAllOrders);
router.get("/admin/:orderId", auth, role("admin"), controller.getOrderById);
router.patch("/admin/:orderId/status", auth, role("admin"), controller.updateOrderStatus);
router.patch("/admin/:orderId/payment-status", auth, role("admin"), controller.updatePaymentStatus);
router.get("/admin/stats/summary", auth, role("admin"), controller.getOrderStats);

module.exports = router;
