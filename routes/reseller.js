const express = require('express');
const pool = require('../db/pool');
const { requireReseller } = require('../middleware/auth');
const { sendNewOrderEmail, sendOrderConfirmationEmail } = require('../utils/mailer');

const router = express.Router();
router.use(requireReseller);

// Cart lives in session: { partId: { part, quantity } }
function getCart(req) {
  if (!req.session.cart) req.session.cart = {};
  return req.session.cart;
}

// ---------- Catalog / search ----------
router.get('/catalog', async (req, res) => {
  const q = (req.query.q || '').trim();
  let rows = [];
  if (q) {
    // Search primarily by part number, but also fall back to name/make/model
    const like = `%${q}%`;
    [rows] = await pool.query(
      `SELECT * FROM parts
       WHERE part_number ILIKE ? OR name ILIKE ? OR make ILIKE ? OR model ILIKE ?
       ORDER BY (UPPER(part_number) = UPPER(?)) DESC, part_number ASC
       LIMIT 100`,
      [like, like, like, like, q]
    );
  }

  const [bizRows] = await pool.query(
    `SELECT credit_limit, credit_used FROM businesses WHERE id = ?`,
    [req.session.user.business_id]
  );
  const available = bizRows[0].credit_limit - bizRows[0].credit_used;

  res.render('catalog', {
    q,
    results: rows,
    cartCount: Object.keys(getCart(req)).length,
    availableCredit: available,
    user: req.session.user
  });
});

// ---------- Cart ----------
router.post('/cart/add', async (req, res) => {
  const { part_id, quantity } = req.body;
  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  const [rows] = await pool.query(`SELECT * FROM parts WHERE id = ?`, [part_id]);
  if (rows.length === 0) return res.redirect('/catalog');

  const cart = getCart(req);
  const part = rows[0];
  if (cart[part_id]) {
    cart[part_id].quantity += qty;
  } else {
    cart[part_id] = { part, quantity: qty };
  }
  res.redirect(req.get('Referer') || '/catalog');
});

router.post('/cart/update', (req, res) => {
  const { part_id, quantity } = req.body;
  const cart = getCart(req);
  const qty = parseInt(quantity, 10);
  if (cart[part_id]) {
    if (qty <= 0) delete cart[part_id];
    else cart[part_id].quantity = qty;
  }
  res.redirect('/cart');
});

router.post('/cart/remove', (req, res) => {
  const { part_id } = req.body;
  const cart = getCart(req);
  delete cart[part_id];
  res.redirect('/cart');
});

router.get('/cart', async (req, res) => {
  const cart = getCart(req);
  const items = Object.values(cart);
  const total = items.reduce((sum, i) => sum + i.part.price * i.quantity, 0);

  const [bizRows] = await pool.query(
    `SELECT credit_limit, credit_used FROM businesses WHERE id = ?`,
    [req.session.user.business_id]
  );
  const available = bizRows[0].credit_limit - bizRows[0].credit_used;

  res.render('cart', {
    items,
    total,
    availableCredit: available,
    canCheckout: items.length > 0 && total <= available,
    user: req.session.user
  });
});

// ---------- Checkout ----------
router.post('/checkout', async (req, res) => {
  const cart = getCart(req);
  const items = Object.values(cart);
  if (items.length === 0) return res.redirect('/cart');

  const total = items.reduce((sum, i) => sum + i.part.price * i.quantity, 0);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Lock the business row to safely check/deduct credit
    const [bizRows] = await conn.query(
      `SELECT * FROM businesses WHERE id = ? FOR UPDATE`,
      [req.session.user.business_id]
    );
    const biz = bizRows[0];
    const available = biz.credit_limit - biz.credit_used;

    if (total > available) {
      await conn.rollback();
      return res.render('cart', {
        items,
        total,
        availableCredit: available,
        canCheckout: false,
        user: req.session.user,
        error: 'Order total exceeds your available credit.'
      });
    }

    // Create order
    const [orderRes] = await conn.query(
      `INSERT INTO orders (business_id, user_id, status, total_amount, original_amount)
       VALUES (?, ?, 'pending', ?, ?)`,
      [req.session.user.business_id, req.session.user.id, total, total]
    );
    const orderId = orderRes.insertId;

    // Create line items (snapshot part number/name/price at time of order)
    for (const item of items) {
      const lineTotal = item.part.price * item.quantity;
      await conn.query(
        `INSERT INTO order_items (order_id, part_id, part_number_snapshot, name_snapshot, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.part.id, item.part.part_number, item.part.name, item.quantity, item.part.price, lineTotal]
      );
    }

    // Deduct credit + ledger entry
    const newUsed = biz.credit_used + total;
    await conn.query(`UPDATE businesses SET credit_used = ? WHERE id = ?`, [newUsed, biz.id]);
    await conn.query(
      `INSERT INTO credit_transactions (business_id, order_id, type, amount, balance_after, note)
       VALUES (?, ?, 'deduct', ?, ?, ?)`,
      [biz.id, orderId, total, biz.credit_limit - newUsed, `Order #${orderId} placed`]
    );

    await conn.commit();

    // Clear cart
    req.session.cart = {};

    // Email both sides (outside the transaction — a dead SMTP server must not
    // undo an order that has already committed; both helpers swallow failures).
    const emailItems = items.map((i) => ({
      part_number_snapshot: i.part.part_number,
      name_snapshot: i.part.name,
      quantity: i.quantity,
      line_total: i.part.price * i.quantity
    }));

    await Promise.all([
      sendOrderConfirmationEmail({
        toEmail: biz.email,
        businessName: biz.business_name,
        orderId,
        total,
        items: emailItems,
        availableCredit: biz.credit_limit - newUsed
      }),
      sendNewOrderEmail({
        orderId,
        businessName: biz.business_name,
        customerEmail: biz.email,
        total,
        items: emailItems
      })
    ]);

    res.redirect(`/orders/${orderId}`);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).send('Checkout failed. Please try again.');
  } finally {
    conn.release();
  }
});

// ---------- Order history / detail ----------
router.get('/orders', async (req, res) => {
  const [orders] = await pool.query(
    `SELECT * FROM orders WHERE business_id = ? ORDER BY created_at DESC`,
    [req.session.user.business_id]
  );
  res.render('orders_list', { orders, user: req.session.user });
});

router.get('/orders/:id', async (req, res) => {
  const [orders] = await pool.query(
    `SELECT * FROM orders WHERE id = ? AND business_id = ?`,
    [req.params.id, req.session.user.business_id]
  );
  if (orders.length === 0) return res.status(404).send('Order not found.');

  const [items] = await pool.query(`SELECT * FROM order_items WHERE order_id = ?`, [req.params.id]);
  res.render('order_detail', { order: orders[0], items, user: req.session.user, isAdmin: false });
});

module.exports = router;
