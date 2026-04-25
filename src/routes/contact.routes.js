const router = require("express").Router();
const controller = require("../controllers/contact.controller");
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");

// Public route - Submit contact form
router.post("/", controller.submitContact);

// Admin routes
router.get("/admin/all", auth, role("admin"), controller.getAllContacts);
router.get("/admin/:id", auth, role("admin"), controller.getContactById);
router.delete("/admin/:id", auth, role("admin"), controller.deleteContact);

module.exports = router;
