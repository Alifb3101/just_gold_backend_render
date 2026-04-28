const { escapeHtml, renderEmailLayout } = require("./shared");

const statusToPillColor = (status) => {
  switch (String(status || "").toLowerCase()) {
    case "processing":
      return { bg: "#fef3c7", fg: "#92400e" };
    case "shipped":
      return { bg: "#dbeafe", fg: "#1e3a8a" };
    case "delivered":
      return { bg: "#dcfce7", fg: "#166534" };
    case "cancelled":
      return { bg: "#fee2e2", fg: "#991b1b" };
    default:
      return { bg: "#e2e8f0", fg: "#334155" };
  }
};

const orderStatusTemplate = ({ customerName, orderNumber, status }) => {
  const safeName = escapeHtml(customerName || "Customer");
  const safeOrderNumber = escapeHtml(orderNumber || "N/A");
  const normalizedStatus = String(status || "pending").toLowerCase();
  const titleStatus = normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1);
  const colors = statusToPillColor(normalizedStatus);

  const bodyContent = `
    <p>Hi ${safeName},</p>
    <p>Your order status has been updated.</p>
    <p><strong>Order:</strong> ${safeOrderNumber}</p>
    <p>
      <span style="display:inline-block;border-radius:999px;padding:6px 12px;background:${colors.bg};color:${colors.fg};font-weight:700;font-size:12px;">
        ${escapeHtml(titleStatus)}
      </span>
    </p>
    <div class="divider"></div>
    <p class="muted">Need help? Contact our support team with your order number.</p>
  `;

  return renderEmailLayout({
    title: "Order Status Updated",
    preheader: `Order ${safeOrderNumber} is now ${titleStatus}`,
    bodyContent,
  });
};

module.exports = {
  orderStatusTemplate,
};
