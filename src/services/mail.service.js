const { transporter } = require("../config/mail.config");
const pool = require("../config/db");
const logger = require("../config/logger");

const MAX_RETRIES = 3;

const computeNextRetryAt = (retryCount) => {
  const now = Date.now();
  const delayMinutes = Math.min(60, 5 * Math.pow(2, retryCount));
  return new Date(now + delayMinutes * 60 * 1000);
};

const insertEmailLog = async ({
  templateKey,
  toEmail,
  subject,
  status,
  errorMessage,
  retryCount = 0,
  payload = null,
  nextRetryAt = null,
  providerMessageId = null,
}) => {
  const sentAt = status === "success" ? new Date() : null;

  const query = `
    INSERT INTO email_logs (
      template_key,
      to_email,
      subject,
      status,
      error_message,
      retry_count,
      next_retry_at,
      payload,
      provider_message_id,
      sent_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id
  `;

  const result = await pool.query(query, [
    templateKey,
    toEmail,
    subject,
    status,
    errorMessage || null,
    retryCount,
    nextRetryAt,
    payload,
    providerMessageId,
    sentAt,
  ]);

  return result.rows[0]?.id;
};

const updateEmailLog = async (id, data) => {
  await pool.query(
    `
      UPDATE email_logs
      SET
        status = $2,
        error_message = $3,
        retry_count = $4,
        next_retry_at = $5,
        provider_message_id = $6,
        sent_at = CASE WHEN $2 = 'success' THEN NOW() ELSE sent_at END,
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      id,
      data.status,
      data.errorMessage || null,
      data.retryCount || 0,
      data.nextRetryAt || null,
      data.providerMessageId || null,
    ]
  );
};

const sendEmail = async ({
  to,
  subject,
  html,
  text,
  templateKey,
  payload = null,
  retryCount = 0,
  existingLogId = null,
}) => {
  const from = process.env.MAIL_FROM;

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text,
    });

    if (existingLogId) {
      await updateEmailLog(existingLogId, {
        status: "success",
        retryCount,
        nextRetryAt: null,
        providerMessageId: info.messageId || null,
      });
    } else {
      await insertEmailLog({
        templateKey,
        toEmail: to,
        subject,
        status: "success",
        retryCount,
        payload,
        providerMessageId: info.messageId || null,
      });
    }

    return { success: true, messageId: info.messageId || null };
  } catch (error) {
    const errMsg = error?.message || "Unknown email error";
    const nextRetryAt = retryCount < MAX_RETRIES ? computeNextRetryAt(retryCount) : null;

    logger.error(
      {
        event: "email_send_failed",
        templateKey,
        to,
        retryCount,
        errMsg,
      },
      "Failed to send transactional email"
    );

    if (existingLogId) {
      await updateEmailLog(existingLogId, {
        status: "failed",
        errorMessage: errMsg,
        retryCount,
        nextRetryAt,
      });
    } else {
      await insertEmailLog({
        templateKey,
        toEmail: to,
        subject,
        status: "failed",
        errorMessage: errMsg,
        retryCount,
        nextRetryAt,
        payload,
      });
    }

    return { success: false, error: errMsg };
  }
};

module.exports = {
  sendEmail,
  MAX_RETRIES,
};
