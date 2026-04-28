const { escapeHtml, renderEmailLayout } = require("./shared");

const passwordResetTemplate = ({ resetUrl, expiresInMinutes }) => {
  const safeResetUrl = escapeHtml(resetUrl);

  const bodyContent = `
    <p>We received a request to reset your Just Gold Cosmetics account password.</p>
    <p>
      <a href="${safeResetUrl}" class="btn">Reset Password</a>
    </p>
    <p class="muted">This link expires in ${Number(expiresInMinutes || 30)} minutes.</p>
    <div class="divider"></div>
    <p class="muted">If you did not request a reset, you can ignore this email.</p>
  `;

  return renderEmailLayout({
    title: "Reset Your Password",
    preheader: "Secure password reset link",
    bodyContent,
  });
};

module.exports = {
  passwordResetTemplate,
};
