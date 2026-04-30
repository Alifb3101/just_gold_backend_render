const router = require("express").Router();
const controller = require("../controllers/user.controller");
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");

// User routes
router.get("/me", auth, controller.me);
router.put("/me", auth, controller.updateProfile);

// Admin routes
router.post("/", auth, role("admin"), controller.createUser);
router.get("/", auth, role("admin", "staff"), controller.list);
router.get("/:id", auth, role("admin", "staff"), controller.getUserById);
router.put("/:id/role", auth, role("admin"), controller.updateUserRole);
router.delete("/:id", auth, role("admin"), controller.deleteUser);

module.exports = router;
