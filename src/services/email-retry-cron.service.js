const cron = require("node-cron");
const pool = require("../config/db");
const logger = require("../config/logger");
const { sendEmail, MAX_RETRIES } = require("./mail.service");

let retryJobStarted = false;
const EMAIL_RETRY_ADVISORY_LOCK_KEY = 98422031;

const retryFailedEmails = async () => {
  const lockResult = await pool.query(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [EMAIL_RETRY_ADVISORY_LOCK_KEY]
  );

  if (!lockResult.rows[0]?.locked) {
    logger.debug({ event: "email_retry_cron_skipped_lock_busy" }, "Skipping email retry run; lock held by another process");
    return;
  }

  try {
    const result = await pool.query(
      `
        SELECT id, template_key, to_email, subject, payload, retry_count
        FROM email_logs
        WHERE status = 'failed'
          AND retry_count < $1
          AND next_retry_at IS NOT NULL
          AND next_retry_at <= NOW()
        ORDER BY next_retry_at ASC
        LIMIT 25
      `,
      [MAX_RETRIES]
    );

    for (const row of result.rows) {
      const duplicateSuccess = await pool.query(
        `
          SELECT id
          FROM email_logs
          WHERE template_key = $1
            AND to_email = $2
            AND status = 'success'
            AND id <> $3
          LIMIT 1
        `,
        [row.template_key, row.to_email, row.id]
      );

      if (duplicateSuccess.rows.length) {
        await pool.query(
          `
            UPDATE email_logs
            SET status = 'success',
                error_message = 'Skipped duplicate retry: already delivered',
                next_retry_at = NULL,
                sent_at = COALESCE(sent_at, NOW()),
                updated_at = NOW()
            WHERE id = $1
          `,
          [row.id]
        );
        continue;
      }

      const payload = row.payload || {};
      if (!payload.html || !payload.text) {
        await pool.query(
          `
            UPDATE email_logs
            SET retry_count = retry_count + 1,
                error_message = 'Missing retry payload html/text',
                next_retry_at = NULL,
                updated_at = NOW()
            WHERE id = $1
          `,
          [row.id]
        );
        continue;
      }

      await sendEmail({
        to: row.to_email,
        subject: row.subject,
        html: payload.html,
        text: payload.text,
        templateKey: row.template_key,
        payload,
        retryCount: Number(row.retry_count || 0) + 1,
        existingLogId: row.id,
      });
    }
  } finally {
    await pool.query("SELECT pg_advisory_unlock($1)", [EMAIL_RETRY_ADVISORY_LOCK_KEY]);
  }
};

const startEmailRetryCron = () => {
  if (retryJobStarted) return;

  cron.schedule("*/5 * * * *", async () => {
    try {
      await retryFailedEmails();
    } catch (error) {
      logger.error({ event: "email_retry_cron_failed", error }, "Email retry cron run failed");
    }
  });

  retryJobStarted = true;
  logger.info({ event: "email_retry_cron_started" }, "Email retry cron started");
};

module.exports = {
  startEmailRetryCron,
  retryFailedEmails,
};
