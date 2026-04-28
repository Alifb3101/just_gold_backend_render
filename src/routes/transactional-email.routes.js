const router = require("express").Router();
const { validateBody } = require("../middlewares/zod-validation.middleware");
const {
  newsletterSubscribeSchema,
  newsletterSubscriberUpdateSchema,
  contactMessageSchema,
  orderCreateSchema,
  orderStatusUpdateSchema,
  forgotPasswordSchema,
} = require("../schemas/transactional-email.schema");
const {
  subscribeNewsletter,
  createContactMessage,
  createOrderAndSendEmail,
  updateOrderStatusAndNotify,
  forgotPassword,
  getNewsletterSubscribers,
  updateNewsletterSubscriber,
  removeNewsletterSubscriber,
} = require("../controllers/transactional-email.controller");

const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");

router.post("/newsletter/subscribe", validateBody(newsletterSubscribeSchema), subscribeNewsletter);
router.post("/v1/newsletter/subscribe", validateBody(newsletterSubscribeSchema), subscribeNewsletter);
router.get("/newsletter/subscribers", auth, role("admin"), getNewsletterSubscribers);
router.get("/v1/newsletter/subscribers", auth, role("admin"), getNewsletterSubscribers);
router.patch(
  "/newsletter/subscribers/:id",
  auth,
  role("admin"),
  validateBody(newsletterSubscriberUpdateSchema),
  updateNewsletterSubscriber
);
router.patch(
  "/v1/newsletter/subscribers/:id",
  auth,
  role("admin"),
  validateBody(newsletterSubscriberUpdateSchema),
  updateNewsletterSubscriber
);
router.delete("/newsletter/subscribers/:id", auth, role("admin"), removeNewsletterSubscriber);
router.delete("/v1/newsletter/subscribers/:id", auth, role("admin"), removeNewsletterSubscriber);
router.post("/contact", validateBody(contactMessageSchema), createContactMessage);
router.post("/orders/create", validateBody(orderCreateSchema), createOrderAndSendEmail);
router.patch("/orders/:id/status", validateBody(orderStatusUpdateSchema), updateOrderStatusAndNotify);
router.post("/auth/forgot-password", validateBody(forgotPasswordSchema), forgotPassword);

module.exports = router;
