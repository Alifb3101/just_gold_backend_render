const router = require("express").Router();
const controller = require("../controllers/auth.controller");
const { loginLimiter, registerLimiter } = require("../middlewares/auth-rate-limit.middleware");
const { validateBody } = require("../middlewares/zod-validation.middleware");
const { loginSchema, registerSchema } = require("../schemas/auth.schema");

router.post("/register", registerLimiter, validateBody(registerSchema), controller.register);
router.post("/login", loginLimiter, validateBody(loginSchema), controller.login);

module.exports = router;

