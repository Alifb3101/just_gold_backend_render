const { escapeHtml, renderEmailLayout } = require("./shared");

const contactAutoReplyTemplate = ({ name }) => {
  const safeName = escapeHtml(name || "there");

  const bodyContent = `
    <p>Hi ${safeName},</p>
    <p>Thank you for contacting Just Gold Cosmetics. We received your message and our support team will respond shortly.</p>
    <p>For urgent order questions, include your order number in your next reply through our support channels.</p>
    <div class="divider"></div>
    <p class="muted">We appreciate your patience and trust.</p>
  `;

  return renderEmailLayout({
    title: "We Received Your Message",
    preheader: "Your Just Gold support request is in our queue",
    bodyContent,
  });
};

module.exports = {
  contactAutoReplyTemplate,
};
