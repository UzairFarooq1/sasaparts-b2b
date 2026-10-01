-- ============================================================
-- Sasaparts B2B Reseller Ordering System — Database Schema
-- ============================================================
CREATE DATABASE IF NOT EXISTS sasaparts_b2b CHARACTER SET utf8mb4;
USE sasaparts_b2b;

-- ---------- Businesses (resellers) ----------
CREATE TABLE businesses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_name VARCHAR(150) NOT NULL,
  contact_person VARCHAR(150),
  email VARCHAR(150) NOT NULL,
  phone VARCHAR(30),
  credit_limit DECIMAL(12,2) NOT NULL DEFAULT 0,      -- total credit allowed
  credit_used DECIMAL(12,2) NOT NULL DEFAULT 0,       -- currently consumed
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Login users (each business can have 1+ login) ----------
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('reseller','admin') NOT NULL DEFAULT 'reseller',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- ---------- Parts catalog ----------
CREATE TABLE parts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  part_number VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  make VARCHAR(100),
  model VARCHAR(100),
  year_from INT,
  year_to INT,
  price DECIMAL(12,2) NOT NULL,
  stock_qty INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_part_number (part_number),
  INDEX idx_part_number (part_number),
  INDEX idx_make_model (make, model)
);

-- ---------- Orders ----------
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id INT NOT NULL,               -- who placed it
  status ENUM('pending','dispatched','partially_reversed','reversed','completed') NOT NULL DEFAULT 'pending',
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,   -- current total after any reversals
  original_amount DECIMAL(12,2) NOT NULL DEFAULT 0, -- total at time of checkout
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TIMESTAMP NULL,
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ---------- Order line items ----------
CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  part_id INT NOT NULL,
  part_number_snapshot VARCHAR(100) NOT NULL,  -- keep even if part edited later
  name_snapshot VARCHAR(255) NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  status ENUM('ok','reversed') NOT NULL DEFAULT 'ok',
  reversed_reason VARCHAR(255) NULL,
  reversed_at TIMESTAMP NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES parts(id)
);

-- ---------- Credit transaction ledger (audit trail) ----------
CREATE TABLE credit_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  order_id INT NULL,
  order_item_id INT NULL,
  type ENUM('deduct','refund','adjustment') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  note VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- ---------- Seed: one admin user, one demo business/user, a few parts ----------
INSERT INTO businesses (business_name, contact_person, email, phone, credit_limit, credit_used)
VALUES ('Demo Auto Traders', 'Jane Reseller', 'reseller@example.com', '0700000000', 100000.00, 0);

-- password for both = "password123" (bcrypt hash generated at setup time — see seed.js)
