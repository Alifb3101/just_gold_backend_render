const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const renderEmailLayout = ({ title, preheader, bodyContent }) => {
  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f7fb; font-family: Arial, Helvetica, sans-serif; color: #1d2433; }
    .wrap { width: 100%; padding: 20px 12px; }
    .card { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4eaf3; }
    .header { padding: 20px 24px; background: linear-gradient(135deg, #0f766e, #0c4a6e); color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; line-height: 1.3; }
    .content { padding: 24px; font-size: 15px; line-height: 1.6; }
    .content p { margin: 0 0 14px; }
    .btn { display: inline-block; padding: 12px 20px; border-radius: 8px; background: #0f766e; color: #ffffff !important; text-decoration: none; font-weight: 600; }
    .muted { color: #5f6b84; font-size: 13px; }
    .divider { height: 1px; background: #e4eaf3; margin: 18px 0; }
    .footer { padding: 18px 24px 24px; color: #63728a; font-size: 12px; background: #f8fafc; }
    .table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .table th, .table td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e9eef6; font-size: 14px; }
    .pill { display: inline-block; border-radius: 999px; padding: 5px 10px; font-size: 12px; background: #dbeafe; color: #1d4ed8; font-weight: 600; }
    @media (max-width: 620px) {
      .header, .content, .footer { padding: 16px; }
      .header h1 { font-size: 20px; }
      .table th, .table td { font-size: 13px; padding: 8px 6px; }
      .btn { width: 100%; text-align: center; box-sizing: border-box; }
    }
  </style>
</head>
<body>
  <span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(preheader || "")}</span>
  <div class="wrap">
    <div class="card">
      <div class="header">
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="content">${bodyContent}</div>
      <div class="footer">
        <p style="margin:0;">Just Gold Cosmetics</p>
        <p style="margin:6px 0 0;">This is an automated transactional email. Please do not reply directly.</p>
      </div>
    </div>
  </div>
</body>
</html>
`.trim();
};

module.exports = {
  escapeHtml,
  renderEmailLayout,
};
