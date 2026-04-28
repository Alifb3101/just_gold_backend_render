const { escapeHtml, renderEmailLayout } = require("./shared");

const orderConfirmationTemplate = ({ customerName, orderNumber, totalAmount, currency, items = [] }) => {
  const safeName = escapeHtml(customerName || "Customer");
  const safeOrderNumber = escapeHtml(orderNumber || "N/A");
  const safeCurrency = escapeHtml(currency || "AED");

  const itemRows = items
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${Number(item.quantity || 0)}</td>
        <td>${Number(item.price || 0).toFixed(2)} ${safeCurrency}</td>
      </tr>`
    )
    .join("");

  const bodyContent = `
    <p>Hi ${safeName},</p>
    <p>Your order has been placed successfully.</p>
    <p><strong>Order:</strong> ${safeOrderNumber}</p>
    <table class="table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>${itemRows || '<tr><td colspan="3">No line items supplied</td></tr>'}</tbody>
    </table>
    <p style="margin-top:14px;"><strong>Total:</strong> ${Number(totalAmount || 0).toFixed(2)} ${safeCurrency}</p>
    <div class="divider"></div>
    <p class="muted">We will notify you once your order status changes.</p>
  `;

  return renderEmailLayout({
    title: "Order Confirmation",
    preheader: `Order ${safeOrderNumber} received`,
    bodyContent,
  });
};

module.exports = {
  orderConfirmationTemplate,
};
