const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

/**
 * Sends the "item reversed" email to the reseller.
 */
async function sendReversalEmail({ toEmail, businessName, orderId, itemName, partNumber, quantity, refundAmount, reason }) {
  const subject = `Order #${orderId} — Item Unavailable & Credit Refunded`;
  const html = `
    <p>Dear ${businessName},</p>
    <p>We're writing to let you know that the following item on your order
    <strong>#${orderId}</strong> could not be fulfilled and has been reversed:</p>
    <ul>
      <li><strong>Part:</strong> ${itemName} (${partNumber})</li>
      <li><strong>Quantity:</strong> ${quantity}</li>
      <li><strong>Reason:</strong> ${reason || 'Item out of stock at time of dispatch'}</li>
      <li><strong>Amount refunded to your credit:</strong> KES ${refundAmount.toLocaleString()}</li>
    </ul>
    <p>Your available credit has been updated accordingly. We apologize for the inconvenience.</p>
    <p>— Techno Automotives Team</p>
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: toEmail,
      subject,
      html
    });
    return true;
  } catch (err) {
    console.error('Failed to send reversal email:', err.message);
    return false; // Don't block the reversal flow if email fails
  }
}

/**
 * Notifies admin(s) that a new order has come in and needs processing.
 */
async function sendNewOrderEmail({ orderId, businessName, total, items }) {
  const subject = `🆕 New Order #${orderId} — ${businessName} (KES ${total.toLocaleString()})`;
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:4px 8px; border-bottom:1px solid #ddd;">${i.part_number_snapshot}</td>
        <td style="padding:4px 8px; border-bottom:1px solid #ddd;">${i.name_snapshot}</td>
        <td style="padding:4px 8px; border-bottom:1px solid #ddd;">${i.quantity}</td>
        <td style="padding:4px 8px; border-bottom:1px solid #ddd;">KES ${i.line_total.toLocaleString()}</td>
      </tr>`
    )
    .join('');

  const html = `
    <p>A new order has been placed and needs processing.</p>
    <p><strong>Order #${orderId}</strong> — ${businessName}</p>
    <table style="border-collapse: collapse; width:100%; max-width:600px;">
      <thead>
        <tr>
          <th style="text-align:left; padding:4px 8px; border-bottom:2px solid #333;">Part #</th>
          <th style="text-align:left; padding:4px 8px; border-bottom:2px solid #333;">Name</th>
          <th style="text-align:left; padding:4px 8px; border-bottom:2px solid #333;">Qty</th>
          <th style="text-align:left; padding:4px 8px; border-bottom:2px solid #333;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p><strong>Order Total: KES ${total.toLocaleString()}</strong></p>
    <p>Log in to the admin dashboard to view and print the pick slip.</p>
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.ADMIN_EMAIL,
      subject,
      html
    });
    return true;
  } catch (err) {
    console.error('Failed to send new-order email:', err.message);
    return false;
  }
}

/**
 * Sends the daily low-stock report to admin(s).
 */
async function sendLowStockReport(parts, threshold) {
  if (parts.length === 0) {
    console.log('Low-stock report: nothing below threshold, skipping email.');
    return true;
  }

  const subject = `⚠️ Low Stock Report — ${parts.length} part(s) below ${threshold} units`;
  const rows = parts
    .map(
      (p) => `<tr>
        <td style="padding:4px 8px; border-bottom:1px solid #ddd;">${p.part_number}</td>
        <td style="padding:4px 8px; border-bottom:1px solid #ddd;">${p.name}</td>
        <td style="padding:4px 8px; border-bottom:1px solid #ddd;">${p.make || ''} ${p.model || ''}</td>
        <td style="padding:4px 8px; border-bottom:1px solid #ddd; color:${p.stock_qty === 0 ? '#b8291f' : '#b7791f'}; font-weight:bold;">
          ${p.stock_qty}
        </td>
      </tr>`
    )
    .join('');

  const html = `
    <p>The following parts are at or below the low-stock threshold of <strong>${threshold}</strong> units:</p>
    <table style="border-collapse: collapse; width:100%; max-width:600px;">
      <thead>
        <tr>
          <th style="text-align:left; padding:4px 8px; border-bottom:2px solid #333;">Part #</th>
          <th style="text-align:left; padding:4px 8px; border-bottom:2px solid #333;">Name</th>
          <th style="text-align:left; padding:4px 8px; border-bottom:2px solid #333;">Fits</th>
          <th style="text-align:left; padding:4px 8px; border-bottom:2px solid #333;">Stock</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#666; font-size:0.9rem;">This is your automated daily low-stock check from Techno Automotives.</p>
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.ADMIN_EMAIL,
      subject,
      html
    });
    return true;
  } catch (err) {
    console.error('Failed to send low-stock report:', err.message);
    return false;
  }
}

module.exports = { sendReversalEmail, sendNewOrderEmail, sendLowStockReport };
