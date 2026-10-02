require("dotenv").config();
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const path = require("path");
const cron = require("node-cron");

const authRoutes = require("./routes/auth");
const resellerRoutes = require("./routes/reseller");
const adminRoutes = require("./routes/admin");
const pool = require("./db/pool");
const { categories, popular } = require("./utils/homeContent");
const { sendLowStockReport } = require("./utils/mailer");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Sessions live in Postgres, not in memory: on Vercel each request can hit a
// different (or brand new) instance, so an in-memory store loses the login
// immediately after it is set. connect-pg-simple creates its own table.
app.set("trust proxy", 1); // Vercel terminates TLS in front of us
app.use(
  session({
    store: new pgSession({ pool: pool.pool, tableName: "session", createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  }),
);

// The floating cart button needs the item count on every page a customer sees.
// navActive marks the nav tab for the section being viewed, so /orders/12 still
// lights up "My Orders".
app.use((req, res, next) => {
  const u = req.session.user;
  const path = req.path;
  res.locals.navActive = (prefix) =>
    path === prefix || path.startsWith(prefix + "/") ? "active" : "";
  res.locals.showCartFab = !!u && u.role !== "admin";
  res.locals.fabCartCount = Object.keys(req.session.cart || {}).length;
  next();
});

app.get("/", (req, res) => {
  if (req.session.user && req.session.user.role === "admin") {
    return res.redirect("/admin/orders");
  }
  // Customers land here after logging in; visitors see the same page signed out.
  res.render("home", { categories, popular, user: req.session.user || null });
});

app.use("/", authRoutes);
app.use("/admin", adminRoutes);
app.use("/", resellerRoutes);

// On Vercel the platform handles listening; api/index.js just imports this app.
// Locally (npm start, or any direct `node app.js`) we bind a port ourselves.
const isServerless = !!process.env.VERCEL;
if (!isServerless) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Techno Automotives B2B running at http://localhost:${PORT}`);
  });
}

// ---------- Daily low-stock report ----------
const LOW_STOCK_THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD, 10) || 10;

async function runLowStockCheck() {
  try {
    const [parts] = await pool.query(
      `SELECT * FROM parts WHERE stock_qty <= ? ORDER BY stock_qty ASC`,
      [LOW_STOCK_THRESHOLD],
    );
    await sendLowStockReport(parts, LOW_STOCK_THRESHOLD);
    console.log(
      `Low-stock check run: ${parts.length} part(s) at/under ${LOW_STOCK_THRESHOLD}.`,
    );
  } catch (err) {
    console.error("Low-stock check failed:", err);
  }
}

// Runs every day at 7:00 AM server time. node-cron needs a process that stays
// alive, which serverless does not have. On Vercel the daily report therefore
// does NOT run yet; it needs a Vercel Cron Job hitting a token-protected
// endpoint (the current one requires an admin session, which cron cannot have).
if (!isServerless) {
  cron.schedule("0 7 * * *", runLowStockCheck);
}

// Lets an admin trigger it manually to test (visit /admin/low-stock-check while logged in)
app.get("/admin/low-stock-check", async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("Admins only.");
  }
  await runLowStockCheck();
  res.send("Low-stock check run — check your email (and server console).");
});

module.exports = app;
