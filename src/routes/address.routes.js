const router = require("express").Router();
const controller = require("../controllers/address.controller");
const auth = require("../middlewares/auth.middleware");

router.get("/", auth, controller.list);
router.post("/", auth, controller.create);
router.post("/:id/default", auth, controller.setDefault);
router.delete("/:id", auth, controller.remove);

module.exports = router;
