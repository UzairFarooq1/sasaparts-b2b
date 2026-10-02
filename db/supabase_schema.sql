-- ============================================================
-- Techno Automotives B2B — PostgreSQL / Supabase schema
-- ============================================================
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is safe to re-run: every object is created only if missing, and the seed
-- rows are upserted rather than duplicated.
--
-- Ported from db/schema.sql (MySQL). Differences worth knowing:
--   AUTO_INCREMENT      -> GENERATED ALWAYS AS IDENTITY
--   ENUM(...)           -> CHECK constraint (simpler to alter later than a PG enum type)
--   TIMESTAMP           -> TIMESTAMPTZ, so times are unambiguous across regions
--   parts.UNIQUE        -> (part_number, make, model), matching migration 001:
--                          the same part number is sold by several suppliers at
--                          different prices, so the number alone is not unique.
-- ============================================================

-- ---------- Businesses (customers) ----------
CREATE TABLE IF NOT EXISTS businesses (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_name  VARCHAR(150)   NOT NULL,
  contact_person VARCHAR(150),
  email          VARCHAR(150)   NOT NULL,
  phone          VARCHAR(30),
  credit_limit   NUMERIC(12,2)  NOT NULL DEFAULT 0,   -- total credit allowed
  credit_used    NUMERIC(12,2)  NOT NULL DEFAULT 0,   -- currently consumed
  status         VARCHAR(10)    NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','suspended')),
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ---------- Login users (each business can have 1+ login) ----------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id   INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'reseller'
                CHECK (role IN ('reseller','admin')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------- Parts catalogue ----------
CREATE TABLE IF NOT EXISTS parts (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  part_number VARCHAR(100)  NOT NULL,
  name        VARCHAR(255)  NOT NULL,
  make        VARCHAR(100)  NOT NULL DEFAULT '',
  model       VARCHAR(100)  NOT NULL DEFAULT '',
  year_from   INTEGER,
  year_to     INTEGER,
  price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_qty   INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_part_line UNIQUE (part_number, make, model)
);

CREATE INDEX IF NOT EXISTS idx_part_number ON parts (part_number);
CREATE INDEX IF NOT EXISTS idx_make_model  ON parts (make, model);
-- Case-insensitive "contains" search over the catalogue (the /catalog page).
CREATE INDEX IF NOT EXISTS idx_parts_name_lower ON parts (LOWER(name));

-- ---------- Orders ----------
CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id     INTEGER       NOT NULL REFERENCES businesses(id),
  user_id         INTEGER       NOT NULL REFERENCES users(id),
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','dispatched','partially_reversed','reversed','completed')),
  total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,  -- current total after any reversals
  original_amount NUMERIC(12,2) NOT NULL DEFAULT 0,  -- total at time of checkout
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  dispatched_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_business ON orders (business_id, created_at DESC);

-- ---------- Order line items ----------
CREATE TABLE IF NOT EXISTS order_items (
  id                   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id             INTEGER       NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  part_id              INTEGER       NOT NULL REFERENCES parts(id),
  part_number_snapshot VARCHAR(100)  NOT NULL,  -- kept even if the part is edited later
  name_snapshot        VARCHAR(255)  NOT NULL,
  quantity             INTEGER       NOT NULL,
  unit_price           NUMERIC(12,2) NOT NULL,
  line_total           NUMERIC(12,2) NOT NULL,
  status               VARCHAR(10)   NOT NULL DEFAULT 'ok'
                       CHECK (status IN ('ok','reversed')),
  reversed_reason      VARCHAR(255),
  reversed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

-- ---------- Credit transaction ledger (audit trail) ----------
CREATE TABLE IF NOT EXISTS credit_transactions (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id   INTEGER       NOT NULL REFERENCES businesses(id),
  order_id      INTEGER       REFERENCES orders(id),
  order_item_id INTEGER,
  type          VARCHAR(12)   NOT NULL CHECK (type IN ('deduct','refund','adjustment')),
  amount        NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  note          VARCHAR(255),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_business ON credit_transactions (business_id, created_at DESC);

-- ============================================================
-- Seed: the admin login and one demo customer.
-- Passwords are bcrypt hashes of:  admin -> admin123 ,  demo_reseller -> password123
-- CHANGE THE ADMIN PASSWORD after your first sign-in.
-- ============================================================
INSERT INTO businesses (business_name, contact_person, email, credit_limit, credit_used)
SELECT 'HQ (Admin)', 'Admin', 'admin@example.com', 0, 0
WHERE NOT EXISTS (SELECT 1 FROM businesses WHERE business_name = 'HQ (Admin)');

INSERT INTO businesses (business_name, contact_person, email, phone, credit_limit, credit_used)
SELECT 'Demo Auto Traders', 'Jane Reseller', 'reseller@example.com', '0700000000', 100000.00, 0
WHERE NOT EXISTS (SELECT 1 FROM businesses WHERE business_name = 'Demo Auto Traders');

INSERT INTO users (business_id, username, password_hash, role)
SELECT b.id, 'admin', '$2b$10$u2d7qu1wko00xf.zHqFKbOM0PIur1.7gInC1Jm3kpCc.Zno8L0iX.', 'admin'
FROM businesses b
WHERE b.business_name = 'HQ (Admin)'
  AND NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');

INSERT INTO users (business_id, username, password_hash, role)
SELECT b.id, 'demo_reseller', '$2b$10$VzLkij3SQe1W/NcySDg4sOj2GASPAoyHhpFfdD0U76nGV2RpzSWwW', 'reseller'
FROM businesses b
WHERE b.business_name = 'Demo Auto Traders'
  AND NOT EXISTS (SELECT 1 FROM users WHERE username = 'demo_reseller');
