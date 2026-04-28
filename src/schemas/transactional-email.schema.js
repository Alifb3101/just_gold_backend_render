const { z } = require("zod");

const newsletterSubscribeSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(120).optional(),
});

const newsletterSubscriberUpdateSchema = z
  .object({
    email: z.string().email().optional(),
    name: z.string().min(2).max(120).optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (data) => data.email !== undefined || data.name !== undefined || data.is_active !== undefined,
    {
      message: "At least one field is required",
    }
  );

const contactMessageSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().max(32).optional(),
  message: z.string().min(10).max(5000),
  subject: z.string().max(160).optional(),
});

const toLowerString = z.string().transform((value) => value.toLowerCase());

const orderCreateSchema = z.object({
  user_id: z.union([z.string(), z.number()]),
  customer_name: z.string().min(2).max(120).optional(),
  customer_email: z.string().email().optional(),
  payment_method: toLowerString.pipe(z.enum(["stripe", "cod"])).default("cod"),
  payment_status: toLowerString.pipe(z.enum(["pending", "paid", "failed", "refunded"]))
    .default("pending"),
  order_status: toLowerString
    .pipe(z.enum(["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"]))
    .default("pending"),
  subtotal: z.number().nonnegative(),
  tax: z.number().nonnegative().default(0),
  shipping_fee: z.number().nonnegative().default(0),
  discount: z.number().nonnegative().default(0),
  total_amount: z.number().nonnegative(),
  currency: z.string().length(3).default("AED"),
  shipping_address_json: z.record(z.any()),
  items: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        variant_id: z.number().int().positive().nullable().optional(),
        name: z.string().min(1).max(255),
        quantity: z.number().int().positive(),
        price: z.number().nonnegative(),
      })
    )
    .min(1),
});

const orderStatusUpdateSchema = z.object({
  status: toLowerString.pipe(z.enum(["processing", "shipped", "delivered", "cancelled"])),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

module.exports = {
  newsletterSubscribeSchema,
  newsletterSubscriberUpdateSchema,
  contactMessageSchema,
  orderCreateSchema,
  orderStatusUpdateSchema,
  forgotPasswordSchema,
};
