function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).send('Admins only.');
  }
  next();
}

function requireReseller(req, res, next) {
  if (!req.session.user) {
    // Let visitors coming from the public home page finish their search after logging in.
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'reseller') {
    return res.status(403).send('Resellers only.');
  }
  next();
}

module.exports = { requireLogin, requireAdmin, requireReseller };
