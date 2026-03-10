const router = require("express").Router();
const controller = require("../controllers/section.controller");

router.get("/homepage", controller.getHomepage);
router.get("/sections/:sectionName/products", controller.getSectionProducts);

module.exports = router;
