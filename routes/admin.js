const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { sendReversalEmail, sendDispatchEmail } = require('../utils/mailer');

const router = express.Router();
router.use(requireAdmin);

// Feedback after an add/edit/delete comes back as ?ok=... or ?err=... on the redirect.
const back = (res, path, params) =>
  res.redirect(path + '?' + new URLSearchParams(params).toString());

// ---------- Orders dashboard ----------
router.get('/orders', async (req, res) => {
  const statusFilter = req.query.status || '';
  let sql = `
    SELECT o.*, b.business_name, b.email AS business_email
    FROM orders o JOIN businesses b ON o.business_id = b.id
  `;
  const params = [];
  if (statusFilter) {
    sql += ` WHERE o.status = ?`;
    params.push(statusFilter);
  }
  sql += ` ORDER BY o.created_at DESC`;

  const [orders] = await pool.query(sql, params);
  res.render('admin_orders', { orders, statusFilter, user: req.session.user });
});

// ---------- Order detail / pick-and-check screen ----------
router.get('/orders/:id', async (req, res) => {
  const [orders] = await pool.query(
    `SELECT o.*, b.business_name, b.email AS business_email, b.credit_limit, b.credit_used
     FROM orders o JOIN businesses b ON o.business_id = b.id WHERE o.id = ?`,
    [req.params.id]
  );
  if (orders.length === 0) return res.status(404).send('Order not found.');

  const [items] = await pool.query(
    `SELECT oi.*, p.stock_qty AS current_stock
     FROM order_items oi LEFT JOIN parts p ON oi.part_id = p.id
     WHERE oi.order_id = ?`,
    [req.params.id]
  );

  res.render('order_detail', { order: orders[0], items, user: req.session.user, isAdmin: true });
});

// ---------- Printable pick slip ----------
router.get('/orders/:id/print', async (req, res) => {
  const [orders] = await pool.query(
    `SELECT o.*, b.business_name FROM orders o JOIN businesses b ON o.business_id = b.id WHERE o.id = ?`,
    [req.params.id]
  );
  if (orders.length === 0) return res.status(404).send('Order not found.');

  const [items] = await pool.query(`SELECT * FROM order_items WHERE order_id = ?`, [req.params.id]);
  res.render('print_slip', { order: orders[0], items });
});

// ---------- Mark as dispatched (everything found & sent out) ----------
router.post('/orders/:id/dispatch', async (req, res) => {
  const orderId = req.params.id;

  const [[order]] = await pool.query(
    `SELECT o.*, b.business_name, b.email AS business_email
     FROM orders o JOIN businesses b ON o.business_id = b.id WHERE o.id = ?`,
    [orderId]
  );
  if (!order) return res.status(404).send('Order not found.');

  await pool.query(
    `UPDATE orders SET status = 'dispatched', dispatched_at = NOW() WHERE id = ?`,
    [orderId]
  );

  // Also decrement live stock for each ok line item
  const [items] = await pool.query(
    `SELECT * FROM order_items WHERE order_id = ? AND status = 'ok'`,
    [orderId]
  );
  for (const item of items) {
    await pool.query(`UPDATE parts SET stock_qty = GREATEST(stock_qty - ?, 0) WHERE id = ?`, [
      item.quantity,
      item.part_id
    ]);
  }

  // Tell the customer it's on its way, noting anything that was reversed earlier.
  const [reversedItems] = await pool.query(
    `SELECT * FROM order_items WHERE order_id = ? AND status = 'reversed'`,
    [orderId]
  );
  await sendDispatchEmail({
    toEmail: order.business_email,
    businessName: order.business_name,
    orderId,
    total: order.total_amount,
    items,
    reversedItems
  });

  res.redirect(`/admin/orders/${orderId}`);
});

// ---------- Reverse a single line item (item wasn't actually available) ----------
router.post('/orders/:id/items/:itemId/reverse', async (req, res) => {
  const { reason } = req.body;
  const orderId = req.params.id;
  const itemId = req.params.itemId;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [itemRows] = await conn.query(
      `SELECT * FROM order_items WHERE id = ? AND order_id = ? FOR UPDATE`,
      [itemId, orderId]
    );
    if (itemRows.length === 0 || itemRows[0].status === 'reversed') {
      await conn.rollback();
      return res.redirect(`/admin/orders/${orderId}`);
    }
    const item = itemRows[0];

    const [orderRows] = await conn.query(`SELECT * FROM orders WHERE id = ? FOR UPDATE`, [orderId]);
    const order = orderRows[0];

    const [bizRows] = await conn.query(
      `SELECT * FROM businesses WHERE id = ? FOR UPDATE`,
      [order.business_id]
    );
    const biz = bizRows[0];

    // 1. Mark the line item reversed
    await conn.query(
      `UPDATE order_items SET status = 'reversed', reversed_reason = ?, reversed_at = NOW() WHERE id = ?`,
      [reason || 'Item not physically available at dispatch', itemId]
    );

    // 2. Refund the credit for that line
    const newUsed = Math.max(0, biz.credit_used - item.line_total);
    await conn.query(`UPDATE businesses SET credit_used = ? WHERE id = ?`, [newUsed, biz.id]);
    await conn.query(
      `INSERT INTO credit_transactions (business_id, order_id, order_item_id, type, amount, balance_after, note)
       VALUES (?, ?, ?, 'refund', ?, ?, ?)`,
      [
        biz.id,
        orderId,
        itemId,
        item.line_total,
        biz.credit_limit - newUsed,
        `Reversal on order #${orderId}: ${item.name_snapshot}`
      ]
    );

    // 3. Recalculate order total & status
    const newOrderTotal = order.total_amount - item.line_total;
    const [remainingItems] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = ? AND status = 'ok'`,
      [orderId]
    );
    const stillHasOkItems = remainingItems[0].cnt > 0;
    const newStatus = stillHasOkItems ? 'partially_reversed' : 'reversed';

    await conn.query(`UPDATE orders SET total_amount = ?, status = ? WHERE id = ?`, [
      newOrderTotal,
      newStatus,
      orderId
    ]);

    await conn.commit();

    // 4. Email the customer (outside the transaction — don't block DB commit on SMTP)
    await sendReversalEmail({
      toEmail: biz.email,
      businessName: biz.business_name,
      orderId,
      itemName: item.name_snapshot,
      partNumber: item.part_number_snapshot,
      quantity: item.quantity,
      refundAmount: item.line_total,
      reason
    });

    res.redirect(`/admin/orders/${orderId}`);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).send('Reversal failed.');
  } finally {
    conn.release();
  }
});

// ---------- Manage customers (business + its logins) ----------
router.get('/businesses', async (req, res) => {
  const [businesses] = await pool.query(
    `SELECT b.*,
            (SELECT GROUP_CONCAT(u.username ORDER BY u.id SEPARATOR ', ')
               FROM users u WHERE u.business_id = b.id AND u.role = 'reseller') AS logins,
            (SELECT COUNT(*) FROM orders o WHERE o.business_id = b.id) AS order_count
     FROM businesses b
     WHERE b.business_name != 'HQ (Admin)'
     ORDER BY b.business_name`
  );
  res.render('admin_businesses', {
    businesses,
    user: req.session.user,
    ok: req.query.ok || '',
    err: req.query.err || ''
  });
});

// Create a customer: the business row plus its first login, in one transaction.
router.post('/businesses', async (req, res) => {
  const { business_name, contact_person, email, phone, credit_limit, username, password } = req.body;
  if (!business_name || !email || !username || !password) {
    return back(res, '/admin/businesses', { err: 'Business name, email, username and password are all required.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [b] = await conn.query(
      `INSERT INTO businesses (business_name, contact_person, email, phone, credit_limit)
       VALUES (?, ?, ?, ?, ?)`,
      [business_name.trim(), contact_person || null, email.trim(), phone || null, Number(credit_limit) || 0]
    );
    await conn.query(
      `INSERT INTO users (business_id, username, password_hash, role) VALUES (?, ?, ?, 'reseller')`,
      [b.insertId, username.trim(), await bcrypt.hash(password, 10)]
    );
    await conn.commit();
    back(res, '/admin/businesses', { ok: `Added ${business_name} with login "${username}".` });
  } catch (e) {
    await conn.rollback();
    const msg = e.code === 'ER_DUP_ENTRY' ? `The username "${username}" is already taken.` : e.message;
    back(res, '/admin/businesses', { err: msg });
  } finally {
    conn.release();
  }
});

// Edit a customer's details, credit limit and status.
router.post('/businesses/:id', async (req, res) => {
  const { business_name, contact_person, email, phone, credit_limit, status } = req.body;
  if (!business_name || !email) {
    return back(res, '/admin/businesses', { err: 'Business name and email are required.' });
  }
  await pool.query(
    `UPDATE businesses
     SET business_name = ?, contact_person = ?, email = ?, phone = ?, credit_limit = ?, status = ?
     WHERE id = ?`,
    [
      business_name.trim(),
      contact_person || null,
      email.trim(),
      phone || null,
      Number(credit_limit) || 0,
      status === 'suspended' ? 'suspended' : 'active',
      req.params.id
    ]
  );
  back(res, '/admin/businesses', { ok: `Saved ${business_name}.` });
});

// Reset the password on one of a customer's logins.
router.post('/businesses/:id/password', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return back(res, '/admin/businesses', { err: 'Pick a login and type a new password.' });
  }
  const [r] = await pool.query(
    `UPDATE users SET password_hash = ? WHERE username = ? AND business_id = ?`,
    [await bcrypt.hash(password, 10), username.trim(), req.params.id]
  );
  back(
    res,
    '/admin/businesses',
    r.affectedRows
      ? { ok: `New password set for "${username}".` }
      : { err: `No login called "${username}" on that customer.` }
  );
});

// Delete a customer. Refused once they have order history — suspend them instead.
router.post('/businesses/:id/delete', async (req, res) => {
  const [[biz]] = await pool.query(`SELECT business_name FROM businesses WHERE id = ?`, [req.params.id]);
  if (!biz) return back(res, '/admin/businesses', { err: 'That customer no longer exists.' });

  const [[{ c }]] = await pool.query(`SELECT COUNT(*) c FROM orders WHERE business_id = ?`, [req.params.id]);
  if (c > 0) {
    return back(res, '/admin/businesses', {
      err: `${biz.business_name} has ${c} order(s) on record, so deleting would destroy that history. Set the status to Suspended instead — they keep their history but can no longer order.`
    });
  }
  // users cascade with the business; credit_transactions would not, so clear them first.
  await pool.query(`DELETE FROM credit_transactions WHERE business_id = ?`, [req.params.id]);
  await pool.query(`DELETE FROM businesses WHERE id = ?`, [req.params.id]);
  back(res, '/admin/businesses', { ok: `Deleted ${biz.business_name} and its logins.` });
});

// ---------- Manage parts / stock ----------
router.get('/parts', async (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    [rows] = await pool.query(
      `SELECT * FROM parts
       WHERE part_number LIKE ? OR name LIKE ? OR make LIKE ? OR model LIKE ?
       ORDER BY part_number LIMIT 300`,
      [like, like, like, like]
    );
  } else {
    [rows] = await pool.query(`SELECT * FROM parts ORDER BY id DESC LIMIT 200`);
  }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM parts`);
  res.render('admin_parts', {
    parts: rows,
    q,
    total,
    user: req.session.user,
    ok: req.query.ok || '',
    err: req.query.err || ''
  });
});

const partFields = (body) => [
  (body.part_number || '').trim(),
  (body.name || '').trim(),
  (body.make || '').trim(),
  (body.model || '').trim(),
  body.year_from ? Number(body.year_from) : null,
  body.year_to ? Number(body.year_to) : null,
  Number(body.price) || 0,
  Number(body.stock_qty) || 0
];

// Add a part.
router.post('/parts', async (req, res) => {
  const f = partFields(req.body);
  if (!f[0] || !f[1]) {
    return back(res, '/admin/parts', { err: 'Part number and name are required.' });
  }
  try {
    await pool.query(
      `INSERT INTO parts (part_number, name, make, model, year_from, year_to, price, stock_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      f
    );
    back(res, '/admin/parts', { ok: `Added ${f[0]} — ${f[1]}.`, q: f[0] });
  } catch (e) {
    const msg =
      e.code === 'ER_DUP_ENTRY'
        ? `${f[0]} already exists for that brand and vehicle. Edit the existing row, or give this one a different brand.`
        : e.message;
    back(res, '/admin/parts', { err: msg });
  }
});

// Edit a part.
router.post('/parts/:id', async (req, res) => {
  const f = partFields(req.body);
  if (!f[0] || !f[1]) {
    return back(res, '/admin/parts', { err: 'Part number and name are required.', q: req.body.q || '' });
  }
  try {
    await pool.query(
      `UPDATE parts SET part_number = ?, name = ?, make = ?, model = ?,
              year_from = ?, year_to = ?, price = ?, stock_qty = ?
       WHERE id = ?`,
      [...f, req.params.id]
    );
    back(res, '/admin/parts', { ok: `Saved ${f[0]}.`, q: req.body.q || '' });
  } catch (e) {
    const msg = e.code === 'ER_DUP_ENTRY' ? `${f[0]} already exists for that brand and vehicle.` : e.message;
    back(res, '/admin/parts', { err: msg, q: req.body.q || '' });
  }
});

// Delete a part. Refused if it appears on an order, so line items keep pointing somewhere.
router.post('/parts/:id/delete', async (req, res) => {
  const q = req.body.q || '';
  const [[part]] = await pool.query(`SELECT part_number, name FROM parts WHERE id = ?`, [req.params.id]);
  if (!part) return back(res, '/admin/parts', { err: 'That part no longer exists.', q });

  const [[{ c }]] = await pool.query(`SELECT COUNT(*) c FROM order_items WHERE part_id = ?`, [req.params.id]);
  if (c > 0) {
    return back(res, '/admin/parts', {
      err: `${part.part_number} appears on ${c} order line(s), so it can't be deleted without breaking that history. Set its stock to 0 to take it out of circulation.`,
      q
    });
  }
  await pool.query(`DELETE FROM parts WHERE id = ?`, [req.params.id]);
  back(res, '/admin/parts', { ok: `Deleted ${part.part_number} — ${part.name}.`, q });
});

module.exports = router;
