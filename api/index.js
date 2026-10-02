// Vercel serverless entry point.
// Vercel cannot run a long-lived `app.listen()` server; it invokes a handler per
// request instead. app.js exports the Express app, and an Express app IS a
// (req, res) handler, so it can be exported straight through.
module.exports = require('../app');
