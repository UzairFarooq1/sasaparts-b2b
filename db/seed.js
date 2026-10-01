// Run with: npm run seed
// Creates an admin login, a demo reseller login, and a handful of sample parts.
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./pool');

async function main() {
  const conn = await pool.getConnection();
  try {
    // 1. Admin user (not tied to a "reseller" business — role = admin)
    const [adminBiz] = await conn.query(
      `SELECT id FROM businesses WHERE business_name = 'HQ (Admin)'`
    );
    let adminBizId;
    if (adminBiz.length === 0) {
      const [res] = await conn.query(
        `INSERT INTO businesses (business_name, contact_person, email, credit_limit, credit_used)
         VALUES ('HQ (Admin)', 'Admin', 'admin@example.com', 0, 0)`
      );
      adminBizId = res.insertId;
    } else {
      adminBizId = adminBiz[0].id;
    }

    const adminPasswordHash = await bcrypt.hash('admin123', 10);
    await conn.query(
      `INSERT INTO users (business_id, username, password_hash, role)
       VALUES (?, 'admin', ?, 'admin')
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
      [adminBizId, adminPasswordHash]
    );

    // 2. Demo reseller (business already seeded in schema.sql)
    const [demoBiz] = await conn.query(
      `SELECT id FROM businesses WHERE business_name = 'Demo Auto Traders'`
    );
    if (demoBiz.length > 0) {
      const demoBizId = demoBiz[0].id;
      const resellerPasswordHash = await bcrypt.hash('password123', 10);
      await conn.query(
        `INSERT INTO users (business_id, username, password_hash, role)
         VALUES (?, 'demo_reseller', ?, 'reseller')
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
        [demoBizId, resellerPasswordHash]
      );
    }

    // 3. Sample parts
    const sampleParts = [
      ['BP-1001', 'Front Brake Pad Set', 'Toyota', 'Corolla', 2010, 2018, 3500, 25],
      ['BP-1002', 'Rear Brake Pad Set', 'Toyota', 'Corolla', 2010, 2018, 3200, 15],
      ['OF-2001', 'Oil Filter', 'Toyota', 'Hilux', 2015, 2023, 800, 50],
      ['AF-3001', 'Air Filter', 'Nissan', 'X-Trail', 2012, 2020, 1500, 30],
      ['SP-4001', 'Spark Plug (each)', 'Mazda', 'Demio', 2010, 2019, 450, 100],
      ['SH-5001', 'Front Shock Absorber', 'Subaru', 'Forester', 2013, 2021, 6800, 8],
      ['CB-6001', 'Clutch Kit', 'Isuzu', 'D-Max', 2014, 2022, 15500, 5],
      ['RB-7001', 'Radiator', 'Toyota', 'Prado', 2010, 2020, 22000, 3]
    ];

    for (const p of sampleParts) {
      await conn.query(
        `INSERT INTO parts (part_number, name, make, model, year_from, year_to, price, stock_qty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        p
      );
    }

    console.log('✅ Seed complete.');
    console.log('   Admin login:    username=admin      password=admin123');
    console.log('   Reseller login: username=demo_reseller  password=password123');
  } finally {
    conn.release();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
