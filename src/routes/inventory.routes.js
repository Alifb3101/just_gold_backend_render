const router = require("express").Router();
const controller = require("../controllers/inventory.controller");
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");

// Admin & Staff inventory routes
router.get("/admin/products", auth, role("admin", "staff"), controller.getProductsInventory);
router.get("/admin/products/:productId", auth, role("admin", "staff"), controller.getProductInventory);
router.put("/admin/variants/:variantId/price", auth, role("admin", "staff"), controller.updateVariantPrice);
router.put("/admin/variants/:variantId/discount-price", auth, role("admin", "staff"), controller.updateVariantDiscountPrice);
router.put("/admin/variants/:variantId/stock", auth, role("admin", "staff"), controller.updateVariantStock);
router.put("/admin/products/:productId/base-stock", auth, role("admin", "staff"), controller.updateProductBaseStock);
router.put("/admin/products/:productId/base-price", auth, role("admin", "staff"), controller.updateProductBasePrice);
router.put("/admin/bulk/update", auth, role("admin"), controller.bulkUpdateInventory);
router.get("/admin/low-stock", auth, role("admin", "staff"), controller.getLowStockItems);

module.exports = router;
