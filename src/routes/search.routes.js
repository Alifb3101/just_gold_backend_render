const router = require("express").Router();
const controller = require("../controllers/search.controller");

router.get("/search/suggestions", controller.getSuggestions);
router.get("/search/trending", controller.getTrending);

module.exports = router;
