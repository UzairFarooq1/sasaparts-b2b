const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/orders' : '/');
  }
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.query(
      `SELECT u.*, b.business_name, b.credit_limit, b.credit_used, b.status AS business_status
       FROM users u JOIN businesses b ON u.business_id = b.id
       WHERE u.username = ?`,
      [username]
    );

    if (rows.length === 0) {
      return res.render('login', { error: 'Invalid username or password.' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render('login', { error: 'Invalid username or password.' });
    }

    if (user.role === 'reseller' && user.business_status !== 'active') {
      return res.render('login', { error: 'Your account is suspended. Contact us.' });
    }

    req.session.user = {
      id: user.id,
      business_id: user.business_id,
      business_name: user.business_name,
      username: user.username,
      role: user.role
    };

    const returnTo = req.session.returnTo;
    delete req.session.returnTo;
    if (user.role === 'admin') return res.redirect('/admin/orders');
    res.redirect(returnTo || '/');
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Something went wrong. Try again.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
