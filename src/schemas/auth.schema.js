const { z } = require("zod");

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: "Email must be a valid email address" }),
  password: z.string().trim().min(6, { message: "Password must be at least 6 characters" }),
}).strict();

const registerSchema = z.object({
  name: z.string().trim().min(2, { message: "Name must be at least 2 characters" }),
  email: z.string().trim().toLowerCase().email({ message: "Email must be a valid email address" }),
  password: z.string().trim().min(6, { message: "Password must be at least 6 characters" }),
  // Keep optional phone supported so existing register controller behavior is unchanged.
  phone: z.string().trim().optional(),
}).strict();

module.exports = {
  loginSchema,
  registerSchema,
};
