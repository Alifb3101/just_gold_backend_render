const nodemailer = require("nodemailer");
const logger = require("./logger");

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number.parseInt(process.env.SMTP_PORT || "587", 10);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS || process.env.SMTP_PAS;

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: Number.isInteger(smtpPort) ? smtpPort : 587,
  secure: smtpPort === 465,
  auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
});

const requiredMailEnv = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "MAIL_FROM", "ADMIN_EMAIL"];
const missingMailEnv = requiredMailEnv.filter((key) => !process.env[key]);

if (!smtpPass) {
  missingMailEnv.push("SMTP_PASS");
}

if (!process.env.FRONTEND_URL_email && !process.env.FRONTEND_URL) {
  missingMailEnv.push("FRONTEND_URL_email");
}

if (missingMailEnv.length) {
  logger.warn(
    { event: "mail_env_missing", missing: missingMailEnv },
    "Email service environment variables are missing"
  );
}

module.exports = {
  transporter,
};
