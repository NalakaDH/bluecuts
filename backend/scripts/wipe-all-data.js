/**
 * Deletes all business data from the shop database, clears uploaded images,
 * and reseeds the default owner login + exchange rates.
 *
 * Paths match server.js (BLUECUTS_USER_DATA overrides data/uploads dirs).
 * Stop the API server before running, or SQLite may be locked.
 *
 * Usage: node scripts/wipe-all-data.js
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const backendRoot = path.join(__dirname, '..');
const bluecutsUserData =
  process.env.BLUECUTS_USER_DATA && String(process.env.BLUECUTS_USER_DATA).trim()
    ? path.resolve(process.env.BLUECUTS_USER_DATA)
    : null;

const dataDir = bluecutsUserData ? path.join(bluecutsUserData, 'data') : path.join(backendRoot, 'data');
const uploadsDir = bluecutsUserData ? path.join(bluecutsUserData, 'uploads') : path.join(backendRoot, 'uploads');
const dbPath = path.join(dataDir, 'blue_cuts_gems.db');

const TABLES_IN_DELETE_ORDER = [
  'payments',
  'invoice_items',
  'memo_items',
  'selling_drafts',
  'stock_movements',
  'invoices',
  'memos',
  'customers',
  'inventory_items',
  'users',
  'exchange_rates',
];

const DEFAULT_FX = [
  ['THB', 1],
  ['USD', 34],
  ['EUR', 37],
  ['GBP', 44],
  ['CNY', 4.65],
  ['JPY', 0.22],
  ['CHF', 39],
  ['HKD', 4.3],
  ['SGD', 25],
  ['AUD', 22],
  ['MYR', 7.4],
];

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function emptyUploadsDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      fs.rmSync(p, { recursive: true, force: true });
    } else {
      fs.unlinkSync(p);
    }
  }
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error('Database not found:', dbPath);
    process.exit(1);
  }

  console.log('Using database:', dbPath);

  const db = new sqlite3.Database(dbPath);

  try {
    await run(db, 'PRAGMA busy_timeout = 15000');
    await run(db, 'BEGIN IMMEDIATE');
    await run(db, 'PRAGMA foreign_keys = OFF');
    for (const t of TABLES_IN_DELETE_ORDER) {
      await run(db, `DELETE FROM ${t}`);
    }
    try {
      await run(db, 'DELETE FROM sqlite_sequence');
    } catch (_) {
      /* optional table */
    }
    await run(db, 'PRAGMA foreign_keys = ON');

    for (const [code, v] of DEFAULT_FX) {
      await run(db, 'INSERT OR REPLACE INTO exchange_rates (currency_code, thb_per_unit) VALUES (?, ?)', [
        code,
        v,
      ]);
    }

    const passwordHash = await bcrypt.hash('Owner@123', 10);
    await run(db, 'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [
      'owner',
      passwordHash,
      'owner',
    ]);

    await run(db, 'COMMIT');

    emptyUploadsDir(uploadsDir);
  } catch (e) {
    try {
      await run(db, 'ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    await new Promise((resolve, reject) => {
      db.close(err => (err ? reject(err) : resolve()));
    });
  }

  console.log('Wiped all data.');
  console.log('Database:', dbPath);
  console.log('Uploads cleared:', uploadsDir);
  console.log('Default login: owner / Owner@123');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
