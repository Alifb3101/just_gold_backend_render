const router = require("express").Router();
const controller = require("../controllers/user.controller");
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");

router.get("/", auth, role("admin"), controller.list);
router.get("/me", auth, controller.me);

module.exports = router;
