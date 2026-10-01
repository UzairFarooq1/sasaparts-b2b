# Techno Automotives B2B Ordering System

A localhost web app for running a credit-based, invite-only spare parts ordering
system for reseller businesses.

## How it works

- **You (admin)** create reseller business accounts and set each one's **credit limit**.
- **Resellers** log in, search parts **by part number** (or name/make/model), add to cart, and check out.
  Checkout **deducts the order total from their credit** — no online payment happens here.
- **You get emailed immediately** when a new order is placed (plus it shows in the Admin → Orders
  dashboard), and can **print a pick slip** for warehouse staff.
- Once picked, mark the order **Dispatched**, or, if an item wasn't actually available:
  click **Reverse** on that line item. This:
  1. Refunds that line's amount back to the reseller's credit
  2. Emails the reseller telling them what was reversed and why
  3. Updates the order status (`partially_reversed` or fully `reversed` if everything was reversed)
- **Every day at 7:00 AM**, an automated email lists every part at or below the low-stock
  threshold (default: 10 units) so you know what to reorder.

Everything — app + database — runs on your own computer. No internet/cloud dependency
required once installed (email sending needs internet, but the app and DB do not).

## 1. Prerequisites

- **Node.js** (v18+) — https://nodejs.org
- **MySQL** installed locally (MySQL Community Server or via XAMPP/WAMP) — you mentioned
  you already have a MySQL DB from another system; you can point this app at that same
  server (different database name) or set up a fresh local one for testing.

## 2. Setup

```bash
# 1. Install dependencies
npm install

# 2. Create the database + tables
mysql -u root -p < db/schema.sql

# 3. Configure environment
cp .env.example .env
# then edit .env with your MySQL credentials + email (SMTP) settings

# 4. Seed demo data (admin login, one demo reseller, sample parts)
npm run seed

# 5. Start the app
npm start
```

Then open **http://localhost:3000**

**Demo logins (after seeding):**
- Admin: `admin` / `admin123`
- Reseller: `demo_reseller` / `password123`

⚠️ Change these passwords / remove the demo accounts before real use.

## 3. Connecting to your real stock database

Right now `parts.stock_qty` and `parts.price` live in this app's own `parts` table.
Since you already run a separate MySQL system for stock, you have two options:

**Option A — Point this app directly at your existing parts table**
If your existing DB has a compatible `parts` table (or a view that looks like one),
just change `DB_NAME` in `.env` to that database, and adjust the column names in
`routes/reseller.js` / `routes/admin.js` queries to match your existing schema.

**Option B — Keep this app's `parts` table as a synced mirror**
Write a small scheduled script (cron job or Windows Task Scheduler) that copies
part_number/name/price/stock_qty from your main system into this app's `parts` table
every few minutes. This keeps the two systems decoupled — recommended if your main
system also handles other logic you don't want this app touching.

Given you said you'd "create one locally as a test," Option B is the simplest way to
start: get this fully working with a local test DB first, then decide how tightly to
couple it to the real one.

## 4. Adding new reseller businesses

There's no "create business" form yet (kept out of MVP scope) — for now, insert directly:

```sql
INSERT INTO businesses (business_name, contact_person, email, phone, credit_limit, credit_used)
VALUES ('New Business Ltd', 'John Doe', 'john@newbiz.com', '0711111111', 50000, 0);

-- then create their login (replace <hash> with a bcrypt hash — see db/seed.js for how)
INSERT INTO users (business_id, username, password_hash, role)
VALUES (LAST_INSERT_ID(), 'newbiz_user', '<hash>', 'reseller');
```

I'm happy to add a proper "Create Reseller" admin form next if useful — just ask.

## 5. Emails sent by the system

| Trigger | Sent to | Content |
|---|---|---|
| New order placed | You (`ADMIN_EMAIL`) | Order #, business, line items, total |
| Item reversed by admin | The reseller | Which item, why, how much credit was refunded |
| Daily at 7:00 AM | You (`ADMIN_EMAIL`) | Every part at/below `LOW_STOCK_THRESHOLD` (default 10) |

To change the daily report time, edit the cron expression in `app.js`:
```js
cron.schedule('0 7 * * *', runLowStockCheck); // minute hour * * *  → 7:00 AM daily
```
To test the low-stock email immediately without waiting for 7 AM, log in as admin and
visit `http://localhost:3000/admin/low-stock-check` — it runs the check on demand.

⚠️ The app must be **running continuously** (`npm start` left open, or run via a process
manager like `pm2`) for the 7 AM email to fire — it's not a separate OS-level cron job.

## 6. Key design notes

- **Credit is a ledger, not a live balance guess.** Every deduction and refund is
  recorded in `credit_transactions` so you always have an audit trail of why a
  business's available credit changed.
- **Reversals are per line item**, not whole-order — if 4 of 5 items were in stock,
  you dispatch those 4 and reverse just the missing one; the customer is only refunded
  for what wasn't available.
- **Stock is only decremented on dispatch**, not at checkout — this matches your
  workflow where checkout is really "request/reservation," and the real stock check
  happens physically when you pick the order.
- **Sessions are server-side (in-memory)** for simplicity. Fine for local single-machine
  use; if several staff will use this over a LAN at once, consider swapping to a
  persistent session store (e.g. `connect-mysql-session`) so logins survive a server restart.

## 6. Known gaps to close before "real business" use

- Add HTTPS / a reverse proxy if any device other than the server itself will access it over LAN.
- Add a proper "create reseller" admin UI (see above).
- Consider low-stock alerts and a "days since last order" report.
- Back up the MySQL database regularly (e.g. `mysqldump` on a schedule).
