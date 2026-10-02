const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

const money = (n) => 'KES ' + Number(n || 0).toLocaleString();

/**
 * One <table> of order lines, shared by every order email.
 */
function itemsTable(items) {
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:6px 8px; border-bottom:1px solid #ddd;">${i.part_number_snapshot}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #ddd;">${i.name_snapshot}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #ddd; text-align:center;">${i.quantity}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #ddd; text-align:right;">${money(i.line_total)}</td>
      </tr>`
    )
    .join('');

  return `<table style="border-collapse:collapse; width:100%; max-width:600px; font-size:0.95rem;">
    <thead><tr>
      <th style="text-align:left; padding:6px 8px; border-bottom:2px solid #333;">Part #</th>
      <th style="text-align:left; padding:6px 8px; border-bottom:2px solid #333;">Name</th>
      <th style="text-align:center; padding:6px 8px; border-bottom:2px solid #333;">Qty</th>
      <th style="text-align:right; padding:6px 8px; border-bottom:2px solid #333;">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/**
 * Single place where mail actually goes out. Never throws: a failed send is
 * logged and reported back, so it can't roll back an order that already committed.
 */
async function send({ to, subject, html, label }) {
  if (!to) {
    console.error(`${label}: no recipient address, skipped.`);
    return false;
  }
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
    console.log(`${label}: sent to ${to}`);
    return true;
  } catch (err) {
    console.error(`${label}: failed to send to ${to}:`, err.message);
    return false;
  }
}

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
 * Welcome email with sign-in details, sent when an admin creates a customer.
 */
async function sendWelcomeEmail({ toEmail, businessName, contactPerson, username, password, creditLimit }) {
  const loginUrl = (process.env.APP_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/+$/, '') + '/login';
  const html = `
    <p>Dear ${contactPerson || businessName},</p>
    <p>Welcome to <strong>Techno Automotives</strong>. Your trade account for
       <strong>${businessName}</strong> is now open, and you can order parts online right away.</p>

    <table style="border-collapse:collapse; margin:18px 0; font-size:0.95rem;">
      <tr><td style="padding:6px 14px 6px 0; color:#555;">Sign in at</td>
          <td style="padding:6px 0;"><a href="${loginUrl}">${loginUrl}</a></td></tr>
      <tr><td style="padding:6px 14px 6px 0; color:#555;">Username</td>
          <td style="padding:6px 0;"><strong>${username}</strong></td></tr>
      <tr><td style="padding:6px 14px 6px 0; color:#555;">Password</td>
          <td style="padding:6px 0;"><strong>${password}</strong></td></tr>
      <tr><td style="padding:6px 14px 6px 0; color:#555;">Credit limit</td>
          <td style="padding:6px 0;"><strong>${money(creditLimit)}</strong></td></tr>
    </table>

    <p>Search our catalogue by part number, vehicle or brand, add what you need to your cart,
       and check out against your credit. You'll get an email confirming every order and another
       when it is dispatched.</p>
    <p style="color:#555; font-size:0.9rem;">Please keep these details safe and don't share them.
       If you'd like the password changed, just reply to this email and we'll reset it for you.</p>
    <p>&mdash; Techno Automotives Team</p>
  `;
  return send({
    to: toEmail,
    subject: 'Welcome to Techno Automotives — your account details',
    html,
    label: `Welcome email for ${businessName}`
  });
}

/**
 * Order confirmation to the customer, the moment checkout succeeds.
 */
async function sendOrderConfirmationEmail({ toEmail, businessName, orderId, total, items, availableCredit }) {
  const html = `
    <p>Dear ${businessName},</p>
    <p>Thank you for your order. We've received it and it's now being prepared for dispatch.</p>
    <p><strong>Order #${orderId}</strong> &mdash; placed ${new Date().toLocaleString('en-KE')}</p>
    ${itemsTable(items)}
    <p><strong>Order Total: ${money(total)}</strong></p>
    ${
      availableCredit === undefined
        ? ''
        : `<p style="color:#555;">Remaining credit after this order: <strong>${money(availableCredit)}</strong></p>`
    }
    <p>We'll email you again as soon as it has been dispatched. If any item turns out to be unavailable,
    it will be reversed and that amount credited straight back to your account.</p>
    <p>&mdash; Techno Automotives Team</p>
  `;
  return send({
    to: toEmail,
    subject: `Order #${orderId} Confirmed — ${money(total)}`,
    html,
    label: `Order confirmation #${orderId}`
  });
}

/**
 * Tells the customer their order has left the building.
 */
async function sendDispatchEmail({ toEmail, businessName, orderId, total, items, reversedItems = [] }) {
  const reversedBlock = reversedItems.length
    ? `<p style="color:#8a1c13;"><strong>Not included</strong> — the following were unavailable and have been
         credited back to your account:</p>
       <ul>${reversedItems
         .map((i) => `<li>${i.name_snapshot} (${i.part_number_snapshot}) &times; ${i.quantity} — ${money(i.line_total)}</li>`)
         .join('')}</ul>`
    : '';

  const html = `
    <p>Dear ${businessName},</p>
    <p>Good news — your <strong>order #${orderId}</strong> has been dispatched.</p>
    ${itemsTable(items)}
    <p><strong>Dispatched Total: ${money(total)}</strong></p>
    ${reversedBlock}
    <p>Please check the goods on arrival and let us know of any discrepancy within 24 hours.</p>
    <p>&mdash; Techno Automotives Team</p>
  `;
  return send({
    to: toEmail,
    subject: `Order #${orderId} Dispatched`,
    html,
    label: `Dispatch notice #${orderId}`
  });
}

/**
 * Notifies admin(s) that a new order has come in and needs processing.
 */
async function sendNewOrderEmail({ orderId, businessName, customerEmail, total, items }) {
  const html = `
    <p>A new order has been placed and needs processing.</p>
    <p><strong>Order #${orderId}</strong> — ${businessName}${customerEmail ? ` (${customerEmail})` : ''}</p>
    ${itemsTable(items)}
    <p><strong>Order Total: ${money(total)}</strong></p>
    <p>Log in to the admin dashboard to view and print the pick slip.</p>
  `;
  return send({
    to: process.env.ADMIN_EMAIL,
    subject: `🆕 New Order #${orderId} — ${businessName} (${money(total)})`,
    html,
    label: `Admin new-order alert #${orderId}`
  });
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

module.exports = {
  sendWelcomeEmail,
  sendOrderConfirmationEmail,
  sendDispatchEmail,
  sendReversalEmail,
  sendNewOrderEmail,
  sendLowStockReport
};
