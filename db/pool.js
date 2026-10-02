// PostgreSQL (Supabase) connection pool.
//
// The rest of the app was written against mysql2/promise, so this module keeps
// that same shape — `const [rows] = await pool.query(sql, params)` and
// `conn.beginTransaction()/commit()/rollback()/release()` — and translates to pg
// underneath. That way the routes did not have to be rewritten query by query.
//
// Two translations happen on every call:
//   1. `?` placeholders become $1, $2, ... (pg's numbered form). Question marks
//      inside string literals are left alone.
//   2. INSERTs get `RETURNING id` appended when they don't already return
//      something, so `result.insertId` keeps working.
const { Pool, types } = require('pg');
require('dotenv').config();

// pg hands back NUMERIC and BIGINT as strings to avoid precision loss. Prices and
// credit limits here are small enough for a JS number, and the views call
// .toLocaleString() on them, so parse them like mysql2's decimalNumbers did.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8

const connectionString = process.env.DATABASE_URL;

const pool = new Pool(
  connectionString
    ? {
        connectionString,
        // Supabase terminates TLS with its own CA; node doesn't ship it.
        ssl: { rejectUnauthorized: false },
        max: Number(process.env.DB_POOL_MAX) || 10
      }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
        max: Number(process.env.DB_POOL_MAX) || 10
      }
);

pool.on('error', (err) => console.error('Unexpected database pool error:', err.message));

/** Rewrite `?` placeholders to $1, $2, ... ignoring any inside quoted strings. */
function toPgPlaceholders(sql) {
  let out = '';
  let n = 0;
  let quote = null; // "'" or '"' when inside a literal/identifier
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      out += c;
      if (c === quote) {
        if (sql[i + 1] === quote) { out += sql[++i]; } // doubled escape
        else quote = null;
      }
    } else if (c === "'" || c === '"') {
      quote = c;
      out += c;
    } else if (c === '?') {
      out += '$' + ++n;
    } else {
      out += c;
    }
  }
  return out;
}

/** Append RETURNING id to plain INSERTs so result.insertId is available. */
function withReturning(sql) {
  return /^\s*insert\s/i.test(sql) && !/\breturning\b/i.test(sql) ? sql.trimEnd().replace(/;?\s*$/, '') + ' RETURNING id' : sql;
}

/** Run one statement and shape the result like mysql2 does. */
async function run(client, sql, params = []) {
  let text = withReturning(toPgPlaceholders(sql));
  let res;
  try {
    res = await client.query(text, params);
  } catch (err) {
    // A RETURNING id we added ourselves fails on tables without an id column;
    // retry without it rather than surfacing a confusing error.
    if (text !== sql && /column "id" does not exist/i.test(err.message)) {
      res = await client.query(toPgPlaceholders(sql), params);
    } else {
      err.message = `${err.message}  [sql: ${sql.replace(/\s+/g, ' ').trim().slice(0, 200)}]`;
      throw err;
    }
  }

  const meta = {
    affectedRows: res.rowCount,
    rowCount: res.rowCount,
    insertId: res.rows && res.rows[0] ? res.rows[0].id : undefined
  };
  // mysql2 returns [rows, fields] for SELECT and [resultMeta, fields] for writes.
  const isSelect = /^\s*(select|with)\b/i.test(sql);
  return [isSelect ? res.rows : meta, res.fields];
}

/** mysql2-style pooled query. */
async function query(sql, params) {
  return run(pool, sql, params);
}

/** mysql2-style connection with transaction helpers. */
async function getConnection() {
  const client = await pool.connect();
  let released = false;
  return {
    query: (sql, params) => run(client, sql, params),
    beginTransaction: () => client.query('BEGIN'),
    commit: () => client.query('COMMIT'),
    rollback: () => client.query('ROLLBACK'),
    release: () => { if (!released) { released = true; client.release(); } }
  };
}

module.exports = { query, getConnection, pool, end: () => pool.end(), toPgPlaceholders };
