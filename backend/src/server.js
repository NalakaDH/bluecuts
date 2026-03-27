const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 4000;

const backendRoot = path.join(__dirname, '..');
const bluecutsUserData =
  process.env.BLUECUTS_USER_DATA && String(process.env.BLUECUTS_USER_DATA).trim()
    ? path.resolve(process.env.BLUECUTS_USER_DATA)
    : null;

function ensureDirSync(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error('Failed to create directory', dir, e);
  }
}

const dataDir = bluecutsUserData
  ? path.join(bluecutsUserData, 'data')
  : path.join(backendRoot, 'data');
const uploadsDir = bluecutsUserData
  ? path.join(bluecutsUserData, 'uploads')
  : path.join(backendRoot, 'uploads');

ensureDirSync(dataDir);
ensureDirSync(uploadsDir);

let JWT_SECRET = process.env.JWT_SECRET && String(process.env.JWT_SECRET).trim();
if (!JWT_SECRET && bluecutsUserData) {
  ensureDirSync(bluecutsUserData);
  const secretFile = path.join(bluecutsUserData, 'jwt_secret');
  try {
    JWT_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
  } catch (_) {
    // first run
  }
  if (!JWT_SECRET) {
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, JWT_SECRET, 'utf8');
  }
}
if (!JWT_SECRET) JWT_SECRET = 'dev_secret_change_me';
/** IANA zone for "today" in doc numbers and default memo_date (SQLite date('now') is UTC). */
const BUSINESS_TZ = process.env.BUSINESS_TZ || 'Asia/Bangkok';

/** Calendar date YYYY-MM-DD in BUSINESS_TZ. */
function businessTodayYmd() {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const mo = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && mo && d) return `${y}-${mo}-${d}`;
  } catch (_e) {
    // Invalid BUSINESS_TZ — fall back to server local calendar date
  }
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Start/end instants (UTC ms) for a calendar day YYYY-MM-DD in BUSINESS_TZ (for filtering created_at). */
function businessZonedDayBoundsUtc(ymd) {
  const [Y, M, D] = ymd.split('-').map(Number);
  if (!Number.isFinite(Y) || !Number.isFinite(M) || !Number.isFinite(D)) {
    const now = new Date();
    const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return { startMs, endMs: startMs + 86400000 };
  }
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const zkey = ms => {
    const p = fmt.formatToParts(new Date(ms));
    return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}-${p.find(x => x.type === 'day').value}`;
  };
  let t = Date.UTC(Y, M - 1, D, 12, 0, 0);
  for (let i = 0; i < 96; i++) {
    if (zkey(t) === ymd) break;
    t += 60 * 60 * 1000;
  }
  if (zkey(t) !== ymd) {
    t = Date.UTC(Y, M - 1, D, 0, 0, 0);
    for (let i = 0; i < 168; i++) {
      if (zkey(t) === ymd) break;
      t += 60 * 60 * 1000;
    }
  }
  if (zkey(t) !== ymd) {
    const d0 = Date.UTC(Y, M - 1, D, 0, 0, 0);
    return { startMs: d0, endMs: d0 + 86400000 };
  }
  let startMs = t;
  while (startMs > 0 && zkey(startMs - 60 * 1000) === ymd) startMs -= 60 * 1000;
  let endMs = t;
  while (zkey(endMs + 60 * 1000) === ymd) endMs += 60 * 1000;
  endMs += 60 * 1000;
  return { startMs, endMs };
}

function sqliteUtcFromMs(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/** Add signed calendar days in BUSINESS_TZ (approximate via UTC noon anchor). */
function businessYmdAddCalendarDays(ymd, deltaDays) {
  const { startMs } = businessZonedDayBoundsUtc(ymd);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = fmt.formatToParts(new Date(startMs + deltaDays * 86400000));
  const y = p.find(x => x.type === 'year')?.value;
  const mo = p.find(x => x.type === 'month')?.value;
  const d = p.find(x => x.type === 'day')?.value;
  if (y && mo && d) return `${y}-${mo}-${d}`;
  return ymd;
}

const dbPath = path.join(dataDir, 'blue_cuts_gems.db');
let db = new sqlite3.Database(dbPath);

app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
app.use(express.json());

// Serve uploaded images
app.use('/uploads', express.static(uploadsDir));

const ensureColumn = (table, column, type) => {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`, err => {
    if (!err) return;
    // Ignore "duplicate column" errors, but log other issues.
    if (String(err.message || '').includes('duplicate column')) return;
    console.error(`Failed to add column ${table}.${column}`, err);
  });
};

const ALLOWED_CURRENCIES = new Set([
  'THB',
  'USD',
  'EUR',
  'GBP',
  'CNY',
  'JPY',
  'CHF',
  'HKD',
  'SGD',
  'AUD',
  'MYR',
]);
const SINGLE_INVENTORY_ITEM_TYPES = new Set(['cut single', 'rough single']);

function normalizeCurrencyCode(raw) {
  const code = String(raw == null || raw === '' ? 'THB' : raw)
    .trim()
    .toUpperCase();
  if (ALLOWED_CURRENCIES.has(code)) return code;
  return 'THB';
}

/** Normalize monetary amounts to 2 decimal places (JSON/SQLite REAL float noise). */
function roundMoney2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/** Owner-facing aggregates: convert to THB using exchange_rates (missing row → factor 1). */
const SQL_INV_FX_JOIN = `LEFT JOIN exchange_rates er_i ON er_i.currency_code = COALESCE(NULLIF(TRIM(i.currency_code), ''), 'THB')`;
const SQL_THB_PER_INV = `COALESCE(er_i.thb_per_unit, 1.0)`;
const SQL_MEMO_FX_JOIN = `LEFT JOIN exchange_rates er_m ON er_m.currency_code = COALESCE(NULLIF(TRIM(m.currency_code), ''), 'THB')`;
const SQL_THB_PER_MEMO = `COALESCE(er_m.thb_per_unit, 1.0)`;
const SQL_INVITEM_FX_JOIN = `LEFT JOIN exchange_rates er_inv ON er_inv.currency_code = COALESCE(NULLIF(TRIM(inv.selling_currency), ''), 'THB')`;
const SQL_THB_PER_INVITEM = `COALESCE(er_inv.thb_per_unit, 1.0)`;

// ===== DB schema =====
db.serialize(() => {
  // Users
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'staff'))
    )
  `);
  ensureColumn('users', 'allowed_pages', 'TEXT');

  // Inventory
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      item_type TEXT NOT NULL,
      pieces INTEGER NOT NULL DEFAULT 0,
      pieces_remaining INTEGER NOT NULL DEFAULT 0,
      weight_grams REAL,
      weight_carats REAL,
      purchasing_total_price REAL,
      purchasing_carat_price REAL,
      selling_total_price REAL,
      selling_carat_price REAL,
      image_path TEXT,
      item_sticker TEXT,
      item_code TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'Available',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migrations for existing inventory schemas.
  ensureColumn('inventory_items', 'pieces_remaining', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('inventory_items', 'item_code', 'TEXT');
  ensureColumn('inventory_items', 'item_sticker', 'TEXT');
  ensureColumn('inventory_items', 'selling_currency', "TEXT NOT NULL DEFAULT 'THB'");

  db.run(`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      currency_code TEXT PRIMARY KEY,
      thb_per_unit REAL NOT NULL
    )
  `);

  // Customers
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  ensureColumn('customers', 'notes', 'TEXT');
  ensureColumn('customers', 'updated_at', 'TEXT');
  ensureColumn('customers', 'address_line1', 'TEXT');
  ensureColumn('customers', 'address_line2', 'TEXT');
  ensureColumn('customers', 'city', 'TEXT');
  ensureColumn('customers', 'postal_code', 'TEXT');
  ensureColumn('customers', 'country', 'TEXT');

  // Invoices + items + payments
  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE,
      customer_id INTEGER,
      subtotal REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Unpaid', 'Partial', 'Paid')) DEFAULT 'Unpaid',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);
  ensureColumn('invoices', 'currency_code', "TEXT NOT NULL DEFAULT 'THB'");

  db.run(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      item_code TEXT,
      description TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('Cash', 'Card', 'QR', 'BankTransfer')),
      amount REAL NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )
  `);

  // Selling drafts (saved cart state)
  db.run(`
    CREATE TABLE IF NOT EXISTS selling_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Memos
  db.run(`
    CREATE TABLE IF NOT EXISTS memos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_no TEXT UNIQUE,
      customer_id INTEGER,
      status TEXT NOT NULL CHECK (status IN ('Open', 'Partially Returned', 'Closed')) DEFAULT 'Open',
      memo_date TEXT NOT NULL DEFAULT (date('now')),
      due_date TEXT,
      notes TEXT,
      converted_invoice_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (converted_invoice_id) REFERENCES invoices(id)
    )
  `);
  ensureColumn('memos', 'currency_code', "TEXT NOT NULL DEFAULT 'THB'");

  db.run(`
    CREATE TABLE IF NOT EXISTS memo_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_id INTEGER NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      item_code TEXT,
      description TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      returned_qty INTEGER NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE,
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
    )
  `);

  ensureColumn('memo_items', 'returned_qty', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('invoice_items', 'returned_qty', 'INTEGER NOT NULL DEFAULT 0');

  // THB base: thb_per_unit = how many THB for 1 unit of currency (owner edits via API).
  const defaultFx = [
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
  defaultFx.forEach(([code, v]) => {
    db.run('INSERT OR IGNORE INTO exchange_rates (currency_code, thb_per_unit) VALUES (?, ?)', [code, v]);
  });

  // Stock movements (audit trail)
  db.run(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_item_id INTEGER,
      type TEXT NOT NULL,
      ref_type TEXT,
      ref_id INTEGER,
      qty_change INTEGER NOT NULL,
      note TEXT,
      user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// Seed default owner account (owner / Owner@123)
const seedDefaultUser = async () => {
  db.get('SELECT id FROM users WHERE username = ?', ['owner'], async (err, row) => {
    if (err) return console.error('Seed user lookup error', err);
    if (row) return;
    try {
      const passwordHash = await bcrypt.hash('Owner@123', 10);
      db.run(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        ['owner', passwordHash, 'owner'],
        e => {
          if (e) console.error('Seed user insert error', e);
        }
      );
    } catch (e) {
      console.error('Seed user hash error', e);
    }
  });
};
seedDefaultUser();

// Staff UI pages the owner can grant (JSON array on users.allowed_pages).
const STAFF_PERMISSION_PAGE_IDS = [
  'dashboard',
  'updateInventory',
  'checkInventory',
  'selling',
  'payments',
  'invoiceCheckout',
  'customers',
  'memo',
  'returns',
  'reports',
];
const VALID_STAFF_PAGE_SET = new Set(STAFF_PERMISSION_PAGE_IDS);
const DEFAULT_STAFF_ALLOWED_PAGES = ['updateInventory', 'selling', 'memo'];

function parseAllowedPagesJson(role, allowedPagesRaw) {
  if (role === 'owner') return null;
  if (allowedPagesRaw == null || !String(allowedPagesRaw).trim()) {
    return [...DEFAULT_STAFF_ALLOWED_PAGES];
  }
  try {
    const arr = JSON.parse(allowedPagesRaw);
    if (!Array.isArray(arr)) return [...DEFAULT_STAFF_ALLOWED_PAGES];
    const filtered = [...new Set(arr.map(p => String(p)).filter(p => VALID_STAFF_PAGE_SET.has(p)))];
    return filtered.length ? filtered : [...DEFAULT_STAFF_ALLOWED_PAGES];
  } catch {
    return [...DEFAULT_STAFF_ALLOWED_PAGES];
  }
}

function validateAllowedPagesInput(bodyPages) {
  if (bodyPages == null) return [...DEFAULT_STAFF_ALLOWED_PAGES];
  if (!Array.isArray(bodyPages)) return [...DEFAULT_STAFF_ALLOWED_PAGES];
  const filtered = [...new Set(bodyPages.map(p => String(p)).filter(p => VALID_STAFF_PAGE_SET.has(p)))];
  return filtered.length ? filtered : [...DEFAULT_STAFF_ALLOWED_PAGES];
}

function comparePassword(plain, hash) {
  return new Promise((resolve, reject) => {
    bcrypt.compare(String(plain), hash, (err, ok) => (err ? reject(err) : resolve(ok)));
  });
}

// ===== Auth helpers =====
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, async (err, payload) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const row = await dbGet(
        'SELECT id, username, role, allowed_pages FROM users WHERE id = ?',
        [payload.id]
      );
      if (!row) return res.status(401).json({ error: 'Unauthorized' });
      req.user = {
        id: row.id,
        username: row.username,
        role: row.role,
        allowedPages: parseAllowedPagesJson(row.role, row.allowed_pages),
      };
      next();
    } catch (e) {
      console.error('authMiddleware user load', e);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
}

const requireRole = roles => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

/** YYYY-MM-DD → DD + M (no leading zero for 1–9) + YY, e.g. 2026-03-23 → 23326 */
function docDateSuffixFromYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return docDateSuffixFromYmd(businessTodayYmd());
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) {
    return docDateSuffixFromYmd(businessTodayYmd());
  }
  const day = String(d).padStart(2, '0');
  const yy = String(y).slice(-2);
  return `${day}${mo}${yy}`;
}

const DOC_NO_COLUMN = { invoices: 'invoice_no', memos: 'memo_no' };

/**
 * Next INV-### / MEM-### with daily sequence (001–999) and date tail DDMyy.
 * @param {'INV'|'MEM'} prefix
 * @param {'invoices'|'memos'} tableName
 * @param {string|null} ymd Business date YYYY-MM-DD (null → calendar today in BUSINESS_TZ)
 */
async function nextSerialDocNumber(prefix, tableName, ymd) {
  const col = DOC_NO_COLUMN[tableName];
  if (!col) throw new Error('Invalid document table');
  let dateYmd = ymd;
  if (!dateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateYmd).trim())) {
    dateYmd = businessTodayYmd();
  } else {
    dateYmd = String(dateYmd).trim();
  }
  const dateSuffix = docDateSuffixFromYmd(dateYmd);
  const pfx = `${prefix}-`;
  const expectedLen = pfx.length + 3 + dateSuffix.length;
  const likePat = `${pfx}%${dateSuffix}`;
  const rows = await dbAll(
    `SELECT ${col} AS n FROM ${tableName} WHERE length(${col}) = ? AND ${col} LIKE ?`,
    [expectedLen, likePat]
  );
  let max = 0;
  for (const r of rows) {
    const n = String(r.n || '');
    if (!n.startsWith(pfx) || !n.endsWith(dateSuffix)) continue;
    const seqPart = n.slice(pfx.length, -dateSuffix.length);
    if (!/^\d{3}$/.test(seqPart)) continue;
    max = Math.max(max, parseInt(seqPart, 10));
  }
  const next = max + 1;
  if (next > 999) {
    throw new Error(
      `Daily sequence for ${prefix} exceeded 999 for ${dateSuffix}; try again tomorrow or contact support`
    );
  }
  return `${pfx}${String(next).padStart(3, '0')}${dateSuffix}`;
}

/** Inventory-only detail line (code, type, weights, notes) for receipts / line items. */
function inventoryItemDetailLine(invRow) {
  if (!invRow) return '';
  const parts = [];
  const code = invRow.item_code || invRow.item_sticker;
  if (code) parts.push(String(code));
  const typeLine = `${invRow.category || ''} ${invRow.item_type || ''}`.trim();
  if (typeLine) parts.push(typeLine);
  const wCt = invRow.weight_carats != null ? Number(invRow.weight_carats) : NaN;
  const wG = invRow.weight_grams != null ? Number(invRow.weight_grams) : NaN;
  if (Number.isFinite(wCt)) parts.push(`${wCt} ct`);
  if (Number.isFinite(wG)) parts.push(`${wG} g`);
  const desc = invRow.description != null ? String(invRow.description).trim() : '';
  if (desc) parts.push(desc);
  return parts.filter(Boolean).join(' · ');
}

/**
 * Line description for invoice/memo: merges any client label with full inventory details
 * so receipts always show specs from the system.
 */
function buildInventoryLineDescription(invRow, overrideDescription) {
  const stockLine = inventoryItemDetailLine(invRow);
  const trimmed = overrideDescription != null ? String(overrideDescription).trim() : '';
  if (!trimmed && !stockLine) return null;
  if (!trimmed) return stockLine;
  if (!stockLine) return trimmed;
  const a = trimmed.toLowerCase();
  const b = stockLine.toLowerCase();
  if (a === b) return trimmed;
  if (a.includes(b)) return trimmed;
  if (b.includes(a)) return stockLine;
  return `${trimmed} · ${stockLine}`;
}

/** Re-merge stored line description with current inventory row (fixes older rows + receipts). */
function enrichDescriptionFromInventoryJoin(row) {
  const invRow = {
    item_code: row.inv_item_code != null ? row.inv_item_code : row.item_code,
    item_sticker: row.inv_item_sticker != null ? row.inv_item_sticker : null,
    category: row.inv_category,
    item_type: row.inv_item_type,
    weight_grams: row.weight_grams,
    weight_carats: row.weight_carats,
    description: row.inventory_description,
  };
  const merged = buildInventoryLineDescription(invRow, row.description);
  return merged != null ? merged : row.description;
}

// ===== Upload config =====
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (_req, file, cb) {
    const safe = String(file.originalname || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}-${safe}`);
  },
});
const upload = multer({ storage });
const MOBILE_UPLOAD_TTL_MS = 10 * 60 * 1000;
const mobileUploadSessions = new Map();

function pruneMobileUploadSessions() {
  const now = Date.now();
  for (const [id, s] of mobileUploadSessions.entries()) {
    if (s.expiresAt <= now) mobileUploadSessions.delete(id);
  }
}

function getMobileUploadSession(sessionId) {
  pruneMobileUploadSessions();
  const session = mobileUploadSessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    mobileUploadSessions.delete(sessionId);
    return null;
  }
  return session;
}

function getLanBaseUrls() {
  const set = new Set();
  const ifs = os.networkInterfaces();
  for (const key of Object.keys(ifs)) {
    for (const addr of ifs[key] || []) {
      if (addr.family === 'IPv4' && !addr.internal && addr.address) {
        set.add(`http://${addr.address}:${PORT}`);
      }
    }
  }
  return Array.from(set);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMobileUploadPage(sessionId, session, opts = {}) {
  const error = opts.error ? `<div class="note note-err">${escapeHtml(opts.error)}</div>` : '';
  const done = opts.done ? `<div class="note note-ok">${escapeHtml(opts.done)}</div>` : '';
  const disabled = opts.disabled ? 'disabled' : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Blue Cuts - Mobile Upload</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f8fc;margin:0;padding:24px;color:#0f172a}
    .card{max-width:520px;margin:0 auto;background:#fff;border:1px solid #dbe3f1;border-radius:14px;padding:20px;box-shadow:0 10px 30px rgba(15,23,42,.08)}
    h1{font-size:1.2rem;margin:0 0 8px}
    .muted{color:#475569;font-size:.92rem}
    .meta{margin:14px 0;padding:12px;border-radius:10px;background:#f8fbff;border:1px solid #d8e7ff}
    .meta b{color:#0b3a82}
    .field{margin-top:14px}
    input[type=file]{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:10px;background:#fff}
    button{margin-top:14px;width:100%;background:#0f4cc9;color:#fff;border:none;border-radius:10px;padding:12px;font-weight:600}
    button[disabled]{opacity:.6}
    .note{margin-top:12px;padding:10px;border-radius:8px}
    .note-ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
    .note-err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
    .tiny{margin-top:10px;font-size:.8rem;color:#64748b}
  </style>
</head>
<body>
  <div class="card">
    <h1>Blue Cuts - Mobile Camera Upload</h1>
    <div class="muted">Take a photo and upload directly to this inventory item.</div>
    <div class="meta">
      <div><b>Item:</b> ${escapeHtml(session.category || '-')}</div>
      <div><b>Code:</b> ${escapeHtml(session.item_code || '-')}</div>
      <div><b>Session:</b> ${escapeHtml(sessionId.slice(0, 8))}</div>
    </div>
    ${error}
    ${done}
    <form method="POST" enctype="multipart/form-data" action="/api/mobile-upload/${encodeURIComponent(sessionId)}/file">
      <div class="field">
        <input type="file" name="image" accept="image/*" capture="environment" required ${disabled}/>
      </div>
      <button type="submit" ${disabled}>Upload photo</button>
    </form>
    <div class="tiny">This link expires automatically for security.</div>
  </div>
</body>
</html>`;
}

const restoreTmpDir = path.join(dataDir, '_restore_tmp');
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      try {
        fs.mkdirSync(restoreTmpDir, { recursive: true });
      } catch (e) {
        return cb(e);
      }
      cb(null, restoreTmpDir);
    },
    filename(_req, _file, cb) {
      cb(null, `restore-${Date.now()}.db`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.db')) return cb(null, true);
    cb(new Error('Only .db SQLite backup files are allowed'));
  },
});

function vacuumIntoBackupFile(destFsPath) {
  const normalized = destFsPath.replace(/\\/g, '/').replace(/'/g, "''");
  return new Promise((resolve, reject) => {
    db.run(`VACUUM INTO '${normalized}'`, err => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function copyFileBackup(destFsPath) {
  return new Promise((resolve, reject) => {
    db.run('PRAGMA wal_checkpoint(FULL)', err => {
      if (err) return reject(err);
      try {
        fs.copyFileSync(dbPath, destFsPath);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

function validateSqliteUsersTable(filePath) {
  return new Promise(resolve => {
    const testDb = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, openErr => {
      if (openErr) return resolve(false);
      testDb.get(
        `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1`,
        [],
        (qErr, row) => {
          testDb.close(() => resolve(!qErr && row != null));
        }
      );
    });
  });
}

function closeMainDatabase() {
  return new Promise((resolve, reject) => {
    db.close(err => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function removeSqliteSidecars(basePath) {
  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(basePath + suffix);
    } catch (_) {
      // ignore
    }
  }
}

function openMainDatabase() {
  db = new sqlite3.Database(dbPath);
}

// ===== Routes =====
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

  db.get(
    'SELECT id, username, password_hash, role, allowed_pages FROM users WHERE username = ?',
    [username],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Internal server error' });
      if (!row) return res.status(401).json({ error: 'Invalid username or password' });

      bcrypt.compare(String(password), row.password_hash, (cmpErr, ok) => {
        if (cmpErr) return res.status(500).json({ error: 'Internal server error' });
        if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

        const allowed_pages = parseAllowedPagesJson(row.role, row.allowed_pages);
        const token = jwt.sign(
          { id: row.id, role: row.role, username: row.username },
          JWT_SECRET,
          { expiresIn: '7d' }
        );
        res.json({
          token,
          user: {
            id: row.id,
            username: row.username,
            role: row.role,
            allowed_pages,
          },
        });
      });
    }
  );
});

app.get('/api/account', authMiddleware, async (req, res) => {
  try {
    const row = await dbGet(
      'SELECT id, username, role, allowed_pages FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!row) return res.status(401).json({ error: 'Unauthorized' });
    res.json({
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        allowed_pages: parseAllowedPagesJson(row.role, row.allowed_pages),
      },
    });
  } catch (e) {
    console.error('GET /api/account', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/account', authMiddleware, async (req, res) => {
  const body = req.body || {};
  const currentPassword = body.currentPassword;
  const newUsername = body.newUsername != null ? String(body.newUsername).trim() : '';
  const newPassword = body.newPassword != null ? String(body.newPassword) : '';

  if (currentPassword == null || currentPassword === '') {
    return res.status(400).json({ error: 'currentPassword is required' });
  }
  if (!newUsername && !newPassword) {
    return res.status(400).json({ error: 'Provide newUsername and/or newPassword' });
  }

  try {
    const row = await dbGet('SELECT id, username, password_hash, role, allowed_pages FROM users WHERE id = ?', [
      req.user.id,
    ]);
    if (!row) return res.status(401).json({ error: 'Unauthorized' });

    const ok = await comparePassword(currentPassword, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    if (newUsername) {
      const clash = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?', [
        newUsername,
        req.user.id,
      ]);
      if (clash) return res.status(400).json({ error: 'Username already taken' });
      await dbRun('UPDATE users SET username = ? WHERE id = ?', [newUsername, req.user.id]);
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    }

    const updated = await dbGet(
      'SELECT id, username, role, allowed_pages FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json({
      user: {
        id: updated.id,
        username: updated.username,
        role: updated.role,
        allowed_pages: parseAllowedPagesJson(updated.role, updated.allowed_pages),
      },
    });
  } catch (e) {
    console.error('PATCH /api/account', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/users', authMiddleware, requireRole(['owner']), async (req, res) => {
  try {
    const rows = await dbAll(
      'SELECT id, username, role, allowed_pages FROM users ORDER BY role DESC, username COLLATE NOCASE'
    );
    res.json(
      rows.map(r => ({
        id: r.id,
        username: r.username,
        role: r.role,
        allowed_pages: r.role === 'owner' ? null : parseAllowedPagesJson(r.role, r.allowed_pages),
      }))
    );
  } catch (e) {
    console.error('GET /api/users', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/users', authMiddleware, requireRole(['owner']), async (req, res) => {
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username) return res.status(400).json({ error: 'username is required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  if (!Array.isArray(body.allowed_pages) || body.allowed_pages.length === 0) {
    return res.status(400).json({ error: 'allowed_pages must include at least one page' });
  }
  const pages = [
    ...new Set(body.allowed_pages.map(p => String(p)).filter(p => VALID_STAFF_PAGE_SET.has(p))),
  ];
  if (!pages.length) {
    return res.status(400).json({ error: 'allowed_pages must include at least one valid page id' });
  }
  try {
    const clash = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (clash) return res.status(400).json({ error: 'Username already taken' });
    const hash = await bcrypt.hash(password, 10);
    const ins = await dbRun(
      'INSERT INTO users (username, password_hash, role, allowed_pages) VALUES (?, ?, ?, ?)',
      [username, hash, 'staff', JSON.stringify(pages)]
    );
    const id = ins.lastID;
    const created = await dbGet(
      'SELECT id, username, role, allowed_pages FROM users WHERE id = ?',
      [id]
    );
    res.status(201).json({
      id: created.id,
      username: created.username,
      role: created.role,
      allowed_pages: parseAllowedPagesJson(created.role, created.allowed_pages),
    });
  } catch (e) {
    console.error('POST /api/users', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/users/:id', authMiddleware, requireRole(['owner']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });

  const body = req.body || {};
  try {
    const target = await dbGet(
      'SELECT id, username, role, allowed_pages FROM users WHERE id = ?',
      [id]
    );
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'owner') {
      return res.status(400).json({ error: 'Use Account settings to change your own login' });
    }

    const newUsername = body.username != null ? String(body.username).trim() : null;
    const newPassword = body.password != null ? String(body.password) : null;
    const pagesInput = body.allowed_pages;

    if (newUsername) {
      const clash = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?', [
        newUsername,
        id,
      ]);
      if (clash) return res.status(400).json({ error: 'Username already taken' });
      await dbRun('UPDATE users SET username = ? WHERE id = ?', [newUsername, id]);
    }

    if (newPassword != null) {
      if (newPassword === '') {
        return res.status(400).json({ error: 'password cannot be empty; omit to leave unchanged' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
    }

    if (pagesInput !== undefined) {
      const pages = validateAllowedPagesInput(pagesInput);
      await dbRun('UPDATE users SET allowed_pages = ? WHERE id = ?', [JSON.stringify(pages), id]);
    }

    const updated = await dbGet(
      'SELECT id, username, role, allowed_pages FROM users WHERE id = ?',
      [id]
    );
    res.json({
      id: updated.id,
      username: updated.username,
      role: updated.role,
      allowed_pages: parseAllowedPagesJson(updated.role, updated.allowed_pages),
    });
  } catch (e) {
    console.error('PATCH /api/users/:id', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function loadExchangeRatesThbPerUnit() {
  const rows = await dbAll('SELECT currency_code, thb_per_unit FROM exchange_rates');
  const m = {};
  for (const r of rows) {
    const c = normalizeCurrencyCode(r.currency_code);
    const v = Number(r.thb_per_unit);
    if (Number.isFinite(v) && v > 0) m[c] = v;
  }
  m.THB = 1;
  return m;
}

/** How many THB one unit of each currency is worth (shop base = THB). Owner maintains rates. */
app.get('/api/exchange-rates', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  try {
    const thb_per_unit = await loadExchangeRatesThbPerUnit();
    res.json({ base: 'THB', thb_per_unit });
  } catch (e) {
    console.error('GET /api/exchange-rates', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/exchange-rates', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const body = req.body || {};
  const raw =
    body.thb_per_unit && typeof body.thb_per_unit === 'object' && !Array.isArray(body.thb_per_unit)
      ? body.thb_per_unit
      : body.rates && typeof body.rates === 'object'
        ? body.rates
        : body;
  try {
    await dbRun('INSERT OR REPLACE INTO exchange_rates (currency_code, thb_per_unit) VALUES (?, ?)', [
      'THB',
      1,
    ]);
    for (const [k, val] of Object.entries(raw)) {
      const code = normalizeCurrencyCode(String(k));
      if (code === 'THB' || !ALLOWED_CURRENCIES.has(code)) continue;
      const num = Number(val);
      if (!Number.isFinite(num) || num <= 0) continue;
      await dbRun('INSERT OR REPLACE INTO exchange_rates (currency_code, thb_per_unit) VALUES (?, ?)', [
        code,
        num,
      ]);
    }
    const thb_per_unit = await loadExchangeRatesThbPerUnit();
    res.json({ base: 'THB', thb_per_unit });
  } catch (e) {
    console.error('PUT /api/exchange-rates', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Inventory list (supports status + search)
app.get('/api/inventory', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const search = req.query.search ? String(req.query.search).trim() : '';
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));

  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(item_code LIKE ? OR item_sticker LIKE ? OR category LIKE ? OR item_type LIKE ? OR description LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT
      id, category, item_type,
      pieces, pieces_remaining,
      weight_grams, weight_carats,
      purchasing_total_price, purchasing_carat_price,
      selling_total_price, selling_carat_price,
      IFNULL(selling_currency, 'THB') AS selling_currency,
      image_path,
      item_sticker, item_code,
      description,
      status,
      created_at, updated_at
    FROM inventory_items
    ${whereSql}
    ORDER BY updated_at DESC
    LIMIT ?
  `;

  db.all(sql, [...params, limit], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Internal server error' });
    res.json(rows);
  });
});

app.get('/api/inventory/:id/stock-history', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const id = Number(req.params.id);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid inventory id' });

  const sql = `
    SELECT
      sm.id,
      sm.inventory_item_id,
      sm.type,
      sm.ref_type,
      sm.ref_id,
      sm.qty_change,
      sm.note,
      sm.created_at,
      u.username AS user_name,
      inv.item_code AS item_code
    FROM stock_movements sm
    LEFT JOIN users u ON u.id = sm.user_id
    LEFT JOIN inventory_items inv ON inv.id = sm.inventory_item_id
    WHERE sm.inventory_item_id = ?
    ORDER BY sm.created_at DESC, sm.id DESC
    LIMIT ?
  `;

  db.all(sql, [id, limit], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Internal server error' });
    res.json(rows);
  });
});

// Single inventory row (for invoice edit / hydrate cart)
app.get('/api/inventory/:id', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid inventory id' });

  const sql = `
    SELECT
      id, category, item_type,
      pieces, pieces_remaining,
      weight_grams, weight_carats,
      purchasing_total_price, purchasing_carat_price,
      selling_total_price, selling_carat_price,
      IFNULL(selling_currency, 'THB') AS selling_currency,
      image_path,
      item_sticker, item_code,
      description,
      status,
      created_at, updated_at
    FROM inventory_items
    WHERE id = ?
  `;

  db.get(sql, [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Internal server error' });
    if (!row) return res.status(404).json({ error: 'Inventory item not found' });
    res.json(row);
  });
});

app.post('/api/inventory', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  try {
    const {
      category,
      item_type,
      pieces,
      weight_grams,
      weight_carats,
      purchasing_total_price,
      purchasing_carat_price,
      selling_total_price,
      selling_carat_price,
      selling_currency: sellingCurrencyRaw,
      image_path,
      item_code,
      description,
    } = req.body || {};
    const selling_currency = normalizeCurrencyCode(sellingCurrencyRaw);
    if (!category || !String(category).trim()) return res.status(400).json({ error: 'category is required' });
    if (!item_type || !String(item_type).trim()) return res.status(400).json({ error: 'item_type is required' });
    const normalizedItemType = String(item_type).trim();
    const normalizedItemTypeLower = normalizedItemType.toLowerCase();
    const p = Number(pieces);
    if (!Number.isFinite(p) || p < 1 || !Number.isInteger(p)) {
      return res.status(400).json({ error: 'pieces must be a positive integer' });
    }
    if (SINGLE_INVENTORY_ITEM_TYPES.has(normalizedItemTypeLower) && p !== 1) {
      return res.status(400).json({ error: 'For cut single/rough single, pieces must be exactly 1' });
    }
    const sql = `
      INSERT INTO inventory_items (
        category, item_type, pieces, pieces_remaining,
        weight_grams, weight_carats,
        purchasing_total_price, purchasing_carat_price,
        selling_total_price, selling_carat_price,
        selling_currency,
        image_path, item_code, description,
        status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Available', datetime('now'))
    `;
    const params = [
      String(category).trim(),
      normalizedItemType,
      p,
      p,
      weight_grams != null && weight_grams !== '' ? Number(weight_grams) : null,
      weight_carats != null && weight_carats !== '' ? Number(weight_carats) : null,
      purchasing_total_price != null && purchasing_total_price !== '' ? Number(purchasing_total_price) : null,
      purchasing_carat_price != null && purchasing_carat_price !== '' ? Number(purchasing_carat_price) : null,
      selling_total_price != null && selling_total_price !== '' ? Number(selling_total_price) : null,
      selling_carat_price != null && selling_carat_price !== '' ? Number(selling_carat_price) : null,
      selling_currency,
      image_path ? String(image_path) : null,
      item_code != null && String(item_code).trim() !== '' ? String(item_code).trim() : null,
      description != null && String(description).trim() !== '' ? String(description) : null,
    ];
    const result = await dbRun(sql, params);
    const row = await dbGet('SELECT * FROM inventory_items WHERE id = ?', [result.lastID]);
    res.status(201).json(row);
  } catch (e) {
    console.error('POST /api/inventory', e);
    res.status(500).json({ error: 'Failed to create inventory item' });
  }
});

app.put('/api/inventory/:id', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid inventory id' });
    const existing = await dbGet('SELECT * FROM inventory_items WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Inventory item not found' });
    const {
      category,
      item_type,
      pieces,
      weight_grams,
      weight_carats,
      purchasing_total_price,
      purchasing_carat_price,
      selling_total_price,
      selling_carat_price,
      selling_currency: sellingCurrencyRaw,
      image_path,
      item_code,
      description,
    } = req.body || {};
    const selling_currency =
      sellingCurrencyRaw != null && String(sellingCurrencyRaw).trim() !== ''
        ? normalizeCurrencyCode(sellingCurrencyRaw)
        : normalizeCurrencyCode(existing.selling_currency);
    if (!category || !String(category).trim()) return res.status(400).json({ error: 'category is required' });
    if (!item_type || !String(item_type).trim()) return res.status(400).json({ error: 'item_type is required' });
    const normalizedItemType = String(item_type).trim();
    const normalizedItemTypeLower = normalizedItemType.toLowerCase();
    const newP = Number(pieces);
    if (!Number.isFinite(newP) || newP < 1 || !Number.isInteger(newP)) {
      return res.status(400).json({ error: 'pieces must be a positive integer' });
    }
    if (SINGLE_INVENTORY_ITEM_TYPES.has(normalizedItemTypeLower) && newP !== 1) {
      return res.status(400).json({ error: 'For cut single/rough single, pieces must be exactly 1' });
    }
    const oldP = Number(existing.pieces);
    const oldRem = Number(existing.pieces_remaining);
    const delta = newP - oldP;
    let newRem = oldRem + delta;
    if (newRem < 0) {
      return res.status(400).json({ error: 'Cannot reduce pieces below quantity already sold or on memo' });
    }
    if (newRem > newP) newRem = newP;
    await dbRun(
      `UPDATE inventory_items SET
        category = ?, item_type = ?, pieces = ?, pieces_remaining = ?,
        weight_grams = ?, weight_carats = ?,
        purchasing_total_price = ?, purchasing_carat_price = ?,
        selling_total_price = ?, selling_carat_price = ?,
        selling_currency = ?,
        image_path = ?, item_code = ?, description = ?,
        updated_at = datetime('now')
      WHERE id = ?`,
      [
        String(category).trim(),
        normalizedItemType,
        newP,
        newRem,
        weight_grams != null && weight_grams !== '' ? Number(weight_grams) : null,
        weight_carats != null && weight_carats !== '' ? Number(weight_carats) : null,
        purchasing_total_price != null && purchasing_total_price !== '' ? Number(purchasing_total_price) : null,
        purchasing_carat_price != null && purchasing_carat_price !== '' ? Number(purchasing_carat_price) : null,
        selling_total_price != null && selling_total_price !== '' ? Number(selling_total_price) : null,
        selling_carat_price != null && selling_carat_price !== '' ? Number(selling_carat_price) : null,
        selling_currency,
        image_path ? String(image_path) : null,
        item_code != null && String(item_code).trim() !== '' ? String(item_code).trim() : null,
        description != null && String(description).trim() !== '' ? String(description) : null,
        id,
      ]
    );
    const row = await dbGet('SELECT * FROM inventory_items WHERE id = ?', [id]);
    res.json(row);
  } catch (e) {
    console.error('PUT /api/inventory/:id', e);
    res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

app.delete('/api/inventory/:id', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid inventory id' });
    const existing = await dbGet('SELECT id FROM inventory_items WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Inventory item not found' });
    const invRow = await dbGet(
      'SELECT COUNT(*) AS c FROM invoice_items WHERE inventory_item_id = ?',
      [id]
    );
    const memoRow = await dbGet('SELECT COUNT(*) AS c FROM memo_items WHERE inventory_item_id = ?', [id]);
    const invC = Number(invRow?.c || 0);
    const memoC = Number(memoRow?.c || 0);
    if (invC > 0 || memoC > 0) {
      return res.status(409).json({ error: 'Cannot delete item that appears on invoices or memos' });
    }
    await dbRun('DELETE FROM stock_movements WHERE inventory_item_id = ?', [id]);
    await dbRun('DELETE FROM inventory_items WHERE id = ?', [id]);
    res.status(204).send();
  } catch (e) {
    console.error('DELETE /api/inventory/:id', e);
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

app.post('/api/inventory/upload', authMiddleware, requireRole(['owner', 'staff']), upload.single('image'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ imagePath: file.filename });
});

app.post('/api/mobile-upload/session', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  try {
    const rawId = req.body?.inventory_item_id;
    const hasInventoryItemId = rawId != null && String(rawId).trim() !== '';
    const inventoryItemId = hasInventoryItemId ? Number(rawId) : null;
    if (hasInventoryItemId && (!Number.isInteger(inventoryItemId) || Number(inventoryItemId) <= 0)) {
      return res.status(400).json({ error: 'inventory_item_id is invalid' });
    }
    let category = String(req.body?.category || '').trim();
    let itemCode = String(req.body?.item_code || '').trim();
    if (inventoryItemId != null) {
      const row = await dbGet(
        'SELECT id, category, item_code FROM inventory_items WHERE id = ?',
        [inventoryItemId]
      );
      if (!row) return res.status(404).json({ error: 'Inventory item not found' });
      category = row.category || category;
      itemCode = row.item_code || itemCode;
    }

    pruneMobileUploadSessions();
    const sessionId = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + MOBILE_UPLOAD_TTL_MS;
    const session = {
      id: sessionId,
      inventoryItemId,
      category,
      item_code: itemCode,
      createdByUserId: req.user.id,
      createdAt: Date.now(),
      expiresAt,
      usedAt: null,
      imagePath: null,
    };
    mobileUploadSessions.set(sessionId, session);

    const paths = [`/mobile-upload/${sessionId}`];
    const urls = getLanBaseUrls().map(base => `${base}${paths[0]}`);

    res.json({
      session_id: sessionId,
      expires_at: new Date(expiresAt).toISOString(),
      inventory_item_id: inventoryItemId,
      category: session.category,
      item_code: session.item_code,
      paths,
      urls,
    });
  } catch (e) {
    console.error('POST /api/mobile-upload/session', e);
    res.status(500).json({ error: 'Could not create mobile upload session' });
  }
});

app.get('/api/mobile-upload/session/:id', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const session = getMobileUploadSession(String(req.params.id || '').trim());
  if (!session) return res.status(404).json({ error: 'Upload session not found or expired' });
  res.json({
    session_id: session.id,
    inventory_item_id: session.inventoryItemId ?? null,
    category: session.category,
    item_code: session.item_code,
    expires_at: new Date(session.expiresAt).toISOString(),
    used: Boolean(session.usedAt),
    used_at: session.usedAt ? new Date(session.usedAt).toISOString() : null,
    image_path: session.imagePath,
  });
});

app.delete('/api/mobile-upload/session/:id', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const id = String(req.params.id || '').trim();
  mobileUploadSessions.delete(id);
  res.status(204).send();
});

app.get('/mobile-upload/:id', (req, res) => {
  const sessionId = String(req.params.id || '').trim();
  const session = getMobileUploadSession(sessionId);
  if (!session) {
    return res
      .status(410)
      .send('<!doctype html><html><body style="font-family:sans-serif;padding:24px">This mobile upload link is expired.</body></html>');
  }
  if (session.usedAt) {
    return res.status(200).send(
      renderMobileUploadPage(sessionId, session, {
        done: 'Photo already uploaded successfully.',
        disabled: true,
      })
    );
  }
  return res.status(200).send(renderMobileUploadPage(sessionId, session));
});

app.post('/api/mobile-upload/:id/file', upload.single('image'), async (req, res) => {
  const sessionId = String(req.params.id || '').trim();
  const session = getMobileUploadSession(sessionId);
  if (!session) {
    return res
      .status(410)
      .send('<!doctype html><html><body style="font-family:sans-serif;padding:24px">This mobile upload link is expired.</body></html>');
  }
  if (session.usedAt) {
    return res.status(200).send(
      renderMobileUploadPage(sessionId, session, {
        done: 'Photo already uploaded successfully.',
        disabled: true,
      })
    );
  }
  const file = req.file;
  if (!file) {
    return res.status(400).send(renderMobileUploadPage(sessionId, session, { error: 'Please choose an image.' }));
  }
  if (!String(file.mimetype || '').startsWith('image/')) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {
      // ignore
    }
    return res.status(400).send(renderMobileUploadPage(sessionId, session, { error: 'Only image files are allowed.' }));
  }
  try {
    if (session.inventoryItemId != null) {
      await dbRun(
        "UPDATE inventory_items SET image_path = ?, updated_at = datetime('now') WHERE id = ?",
        [file.filename, session.inventoryItemId]
      );
    }
    session.usedAt = Date.now();
    session.imagePath = file.filename;
    return res
      .status(200)
      .send(renderMobileUploadPage(sessionId, session, { done: 'Upload successful. You can return to the laptop.' , disabled: true }));
  } catch (e) {
    console.error('POST /api/mobile-upload/:id/file', e);
    return res.status(500).send(renderMobileUploadPage(sessionId, session, { error: 'Upload failed. Please try again.' }));
  }
});

// Memos list (used by Dashboard "Open Memos")
app.get('/api/memos', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 150));
  const status = req.query.status ? String(req.query.status) : 'All';
  const search = req.query.search ? String(req.query.search).trim() : '';

  const where = [];
  const params = [];
  if (status && status !== 'All') {
    where.push('m.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(m.memo_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      m.id,
      m.memo_no,
      m.customer_id,
      c.name AS customer_name,
      c.phone AS customer_phone,
      m.status,
      m.memo_date,
      m.due_date,
      m.notes,
      m.converted_invoice_id,
      m.created_at,
      m.updated_at,
      IFNULL(m.currency_code, 'THB') AS currency_code,
      (
        SELECT IFNULL(COUNT(*), 0) FROM memo_items mi WHERE mi.memo_id = m.id
      ) AS items_count,
      (
        SELECT IFNULL(SUM(
          mi.unit_price * (CASE WHEN mi.quantity > mi.returned_qty THEN mi.quantity - mi.returned_qty ELSE 0 END)
        ), 0)
        FROM memo_items mi WHERE mi.memo_id = m.id
      ) AS total_value
    FROM memos m
    LEFT JOIN customers c ON c.id = m.customer_id
    ${whereSql}
    ORDER BY m.created_at DESC
    LIMIT ?
  `;

  db.all(sql, [...params, limit], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Internal server error' });
    res.json(rows);
  });
});

/** Memo KPIs over all rows matching list filters (no LIMIT). */
app.get('/api/memos/stats', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const status = req.query.status ? String(req.query.status) : 'All';
  const search = req.query.search ? String(req.query.search).trim() : '';
  const businessToday = businessTodayYmd();

  const where = [];
  const params = [];
  if (status && status !== 'All') {
    where.push('m.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(m.memo_no LIKE ? OR IFNULL(c.name, "") LIKE ? OR IFNULL(c.phone, "") LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      COUNT(*) AS memos_in_scope,
      SUM(CASE WHEN m.status IN ('Open', 'Partially Returned') THEN 1 ELSE 0 END) AS open_memo_count,
      SUM(CASE
        WHEN m.status != 'Closed'
          AND m.due_date IS NOT NULL
          AND TRIM(m.due_date) != ''
          AND date(m.due_date) < date(?)
        THEN 1 ELSE 0 END) AS overdue_memo_count,
      IFNULL(SUM(
        CASE WHEN m.status IN ('Open', 'Partially Returned') THEN
          (SELECT IFNULL(COUNT(*), 0) FROM memo_items mi WHERE mi.memo_id = m.id)
        ELSE 0 END
      ), 0) AS items_on_open_memos,
      IFNULL(SUM(
        CASE WHEN m.status IN ('Open', 'Partially Returned') THEN
          (SELECT IFNULL(SUM(
            mi.unit_price * (CASE WHEN mi.quantity > mi.returned_qty THEN mi.quantity - mi.returned_qty ELSE 0 END)
          ), 0) FROM memo_items mi WHERE mi.memo_id = m.id) * ${SQL_THB_PER_MEMO}
        ELSE 0 END
      ), 0) AS open_memos_value_thb
    FROM memos m
    LEFT JOIN customers c ON c.id = m.customer_id
    ${SQL_MEMO_FX_JOIN}
    ${whereSql}
  `;

  db.get(sql, [...params, businessToday], (err, row) => {
    if (err) {
      console.error('memos stats', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.json({
      memos_in_scope: Number(row?.memos_in_scope || 0),
      open_memo_count: Number(row?.open_memo_count || 0),
      overdue_memo_count: Number(row?.overdue_memo_count || 0),
      items_on_open_memos: Number(row?.items_on_open_memos || 0),
      open_memos_value_thb: Number(row?.open_memos_value_thb || 0),
    });
  });
});

app.post('/api/memos', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const body = req.body || {};
  const customerId =
    body.customer_id == null || body.customer_id === '' ? null : Number(body.customer_id);
  const memoDate = body.memo_date ? String(body.memo_date).trim() : null;
  const dueDate = body.due_date == null || body.due_date === '' ? null : String(body.due_date).trim();
  const notes = body.notes == null ? null : String(body.notes).trim() || null;
  const items = Array.isArray(body.items) ? body.items : [];
  const currency_code = normalizeCurrencyCode(body.currency_code);

  if (!items.length) return res.status(400).json({ error: 'At least one item is required' });
  if (customerId != null && (!Number.isFinite(customerId) || customerId <= 0)) {
    return res.status(400).json({ error: 'Invalid customer id' });
  }

  let subtotal = 0;
  for (const it of items) {
    const inventoryItemId = Number(it.inventory_item_id);
    const unitPrice = Number(it.unit_price || 0);
    const quantity = Math.floor(Number(it.quantity ?? 0));
    if (!Number.isFinite(inventoryItemId) || inventoryItemId <= 0) {
      return res.status(400).json({ error: 'Invalid inventory_item_id' });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(400).json({ error: 'Invalid item price (negative amounts are not allowed)' });
    }
    if (!Number.isFinite(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'Each line must have a quantity of at least 1' });
    }
    subtotal += unitPrice * quantity;
  }

  try {
    const businessToday = businessTodayYmd();
    if (dueDate) {
      const effectiveMemoDate = memoDate || businessToday || null;
      if (effectiveMemoDate && dueDate < effectiveMemoDate) {
        return res.status(400).json({
          error: 'Due date must be on or after the memo date (negative duration is not allowed)',
        });
      }
    }

    if (customerId != null) {
      const cust = await dbGet('SELECT id FROM customers WHERE id = ?', [customerId]);
      if (!cust) return res.status(400).json({ error: 'Customer not found' });
    }

    const effectiveMemoYmd =
      memoDate && /^\d{4}-\d{2}-\d{2}$/.test(String(memoDate).trim())
        ? String(memoDate).trim()
        : businessToday;

    await dbRun('BEGIN TRANSACTION');

    const memoInsert = await dbRun(
      `
      INSERT INTO memos (memo_no, customer_id, status, memo_date, due_date, notes, currency_code, created_at, updated_at)
      VALUES (?, ?, 'Open', COALESCE(?, ?), ?, ?, ?, datetime('now'), datetime('now'))
    `,
      [null, customerId, memoDate, businessToday, dueDate, notes, currency_code]
    );
    const memoId = memoInsert.lastID;
    const memoNo = await nextSerialDocNumber('MEM', 'memos', effectiveMemoYmd);
    await dbRun(`UPDATE memos SET memo_no = ? WHERE id = ?`, [memoNo, memoId]);

    for (const it of items) {
      const inventoryItemId = Number(it.inventory_item_id);
      const unitPrice = Number(it.unit_price || 0);
      const quantity = Math.floor(Number(it.quantity ?? 0));
      const lineTotal = unitPrice * quantity;
      const reqCode = it.item_code != null ? String(it.item_code).trim() || null : null;
      const reqDesc = it.description != null ? String(it.description) : null;

      const stockRow = await dbGet(
        `
        SELECT id, pieces_remaining, status, category, item_type, weight_grams, weight_carats,
               item_code, item_sticker, description
        FROM inventory_items
        WHERE id = ?
      `,
        [inventoryItemId]
      );
      if (!stockRow) throw new Error(`Inventory item ${inventoryItemId} not found`);
      const remaining = Number(stockRow.pieces_remaining || 0);
      const itemCode = reqCode || stockRow.item_code || stockRow.item_sticker || null;
      if (remaining <= 0) {
        throw new Error(`Item ${itemCode || `#${inventoryItemId}`} is out of stock`);
      }
      if (quantity > remaining) {
        throw new Error(
          `Not enough pieces for ${itemCode || `#${inventoryItemId}`}: requested ${quantity}, available ${remaining}`
        );
      }

      const description = buildInventoryLineDescription(stockRow, reqDesc);

      await dbRun(
        `
        INSERT INTO memo_items (
          memo_id, inventory_item_id, item_code, description, quantity, returned_qty, unit_price, line_total
        )
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `,
        [memoId, inventoryItemId, itemCode, description, quantity, unitPrice, lineTotal]
      );

      await dbRun(
        `
        UPDATE inventory_items
        SET
          pieces_remaining = MAX(0, pieces_remaining - ?),
          status = CASE WHEN MAX(0, pieces_remaining - ?) <= 0 THEN 'Out of stock' ELSE 'Available' END,
          updated_at = datetime('now')
        WHERE id = ?
      `,
        [quantity, quantity, inventoryItemId]
      );

      await dbRun(
        `
        INSERT INTO stock_movements (inventory_item_id, type, ref_type, ref_id, qty_change, note, user_id)
        VALUES (?, 'MEMO_OUT', 'MEMO', ?, ?, ?, ?)
      `,
        [inventoryItemId, memoId, -quantity, `On memo ${memoNo} (${quantity} pc)`, req.user.id]
      );
    }

    await dbRun('COMMIT');

    return res.status(201).json({
      id: memoId,
      memo_no: memoNo,
      customer_id: customerId,
      status: 'Open',
      memo_date: memoDate || null,
      due_date: dueDate,
      notes,
      total: subtotal,
      currency_code,
    });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (_e) {
      // ignore
    }
    const msg = err instanceof Error ? err.message : 'Failed to create memo';
    return res.status(400).json({ error: msg });
  }
});

app.get('/api/memos/:id', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid memo id' });

  const sqlMemo = `
    SELECT
      m.id,
      m.memo_no,
      m.customer_id,
      c.name AS customer_name,
      c.phone AS customer_phone,
      c.email AS customer_email,
      c.address_line1 AS customer_address_line1,
      c.address_line2 AS customer_address_line2,
      c.city AS customer_city,
      c.postal_code AS customer_postal_code,
      c.country AS customer_country,
      m.status,
      m.memo_date,
      m.due_date,
      m.notes,
      m.converted_invoice_id,
      m.created_at,
      m.updated_at,
      IFNULL(m.currency_code, 'THB') AS currency_code
    FROM memos m
    LEFT JOIN customers c ON c.id = m.customer_id
    WHERE m.id = ?
  `;

  const sqlItems = `
    SELECT
      mi.id,
      mi.inventory_item_id,
      mi.item_code,
      mi.description,
      mi.quantity,
      mi.returned_qty,
      mi.unit_price,
      mi.line_total,
      inv.image_path,
      inv.category AS inv_category,
      inv.item_type AS inv_item_type,
      inv.item_code AS inv_item_code,
      inv.item_sticker AS inv_item_sticker,
      inv.weight_grams,
      inv.weight_carats,
      inv.description AS inventory_description
    FROM memo_items mi
    JOIN inventory_items inv ON inv.id = mi.inventory_item_id
    WHERE mi.memo_id = ?
    ORDER BY mi.id ASC
  `;

  db.get(sqlMemo, [id], (err, memoRow) => {
    if (err) return res.status(500).json({ error: 'Internal server error' });
    if (!memoRow) return res.status(404).json({ error: 'Memo not found' });

    db.all(sqlItems, [id], (err2, items) => {
      if (err2) return res.status(500).json({ error: 'Internal server error' });
      const itemsOut = (items || []).map(row => ({
        id: row.id,
        inventory_item_id: row.inventory_item_id,
        item_code: row.item_code,
        description: enrichDescriptionFromInventoryJoin(row),
        quantity: row.quantity,
        returned_qty: row.returned_qty,
        unit_price: row.unit_price,
        line_total: row.line_total,
        image_path: row.image_path,
        category: row.inv_category,
        item_type: row.inv_item_type,
        weight_grams: row.weight_grams,
        weight_carats: row.weight_carats,
      }));
      res.json({ ...memoRow, items: itemsOut });
    });
  });
});

app.patch('/api/memos/:id', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const memoId = Number(req.params.id);
  if (!Number.isFinite(memoId) || memoId <= 0) return res.status(400).json({ error: 'Invalid memo id' });
  const body = req.body || {};

  try {
    const memo = await dbGet(
      `SELECT id, memo_date, due_date, notes, customer_id, converted_invoice_id FROM memos WHERE id = ?`,
      [memoId]
    );
    if (!memo) return res.status(404).json({ error: 'Memo not found' });

    const nextMemoDate =
      body.memo_date !== undefined ? String(body.memo_date || '').trim() || null : memo.memo_date;
    const nextDue =
      body.due_date !== undefined
        ? body.due_date == null || body.due_date === ''
          ? null
          : String(body.due_date).trim()
        : memo.due_date;
    const nextNotes =
      body.notes !== undefined
        ? body.notes == null || String(body.notes).trim() === ''
          ? null
          : String(body.notes).trim()
        : memo.notes;

    if (!nextMemoDate) {
      return res.status(400).json({ error: 'memo_date is required' });
    }
    if (nextDue && nextDue < nextMemoDate) {
      return res.status(400).json({ error: 'Due date must be on or after the memo date' });
    }

    let nextCustomerId = memo.customer_id;
    if (Object.prototype.hasOwnProperty.call(body, 'customer_id')) {
      if (memo.converted_invoice_id) {
        return res.status(400).json({
          error: 'Cannot change customer on a memo that was converted to an invoice',
        });
      }
      const raw = body.customer_id;
      if (raw == null || raw === '') {
        nextCustomerId = null;
      } else {
        const cid = Number(raw);
        if (!Number.isFinite(cid) || cid <= 0) {
          return res.status(400).json({ error: 'Invalid customer id' });
        }
        const cust = await dbGet('SELECT id FROM customers WHERE id = ?', [cid]);
        if (!cust) return res.status(400).json({ error: 'Customer not found' });
        nextCustomerId = cid;
      }
    }

    await dbRun(
      `UPDATE memos SET memo_date = ?, due_date = ?, notes = ?, customer_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [nextMemoDate, nextDue, nextNotes, nextCustomerId, memoId]
    );

    const updated = await dbGet(
      `
      SELECT
        m.id,
        m.memo_no,
        m.customer_id,
        c.name AS customer_name,
        c.phone AS customer_phone,
        m.status,
        m.memo_date,
        m.due_date,
        m.notes,
        m.converted_invoice_id,
        IFNULL(m.currency_code, 'THB') AS currency_code
      FROM memos m
      LEFT JOIN customers c ON c.id = m.customer_id
      WHERE m.id = ?
    `,
      [memoId]
    );
    return res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update memo';
    return res.status(400).json({ error: msg });
  }
});

app.delete('/api/memos/:id', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const memoId = Number(req.params.id);
  if (!Number.isFinite(memoId) || memoId <= 0) return res.status(400).json({ error: 'Invalid memo id' });

  try {
    const memo = await dbGet(
      `SELECT id, memo_no, converted_invoice_id FROM memos WHERE id = ?`,
      [memoId]
    );
    if (!memo) return res.status(404).json({ error: 'Memo not found' });
    if (memo.converted_invoice_id) {
      return res.status(400).json({
        error: 'Cannot delete a memo that was converted to an invoice',
      });
    }

    const lines = await dbAll(
      `SELECT inventory_item_id, quantity, IFNULL(returned_qty, 0) AS returned_qty FROM memo_items WHERE memo_id = ?`,
      [memoId]
    );
    const memoNo = String(memo.memo_no || `MEM-${memoId}`);

    await dbRun('BEGIN TRANSACTION');

    for (const line of lines) {
      const q = Math.floor(Number(line.quantity || 0));
      const rq = Math.floor(Number(line.returned_qty || 0));
      const out = Math.max(0, q - rq);
      if (out <= 0) continue;
      await dbRun(
        `
        UPDATE inventory_items
        SET
          pieces_remaining = pieces_remaining + ?,
          status = CASE WHEN (pieces_remaining + ?) > 0 THEN 'Available' ELSE status END,
          updated_at = datetime('now')
        WHERE id = ?
      `,
        [out, out, line.inventory_item_id]
      );
      await dbRun(
        `
        INSERT INTO stock_movements (inventory_item_id, type, ref_type, ref_id, qty_change, note, user_id)
        VALUES (?, 'MEMO_VOID', 'MEMO', ?, ?, ?, ?)
      `,
        [line.inventory_item_id, memoId, out, `Memo ${memoNo} deleted — restocked ${out} pc(s)`, req.user.id]
      );
    }

    await dbRun(`DELETE FROM memo_items WHERE memo_id = ?`, [memoId]);
    await dbRun(`DELETE FROM memos WHERE id = ?`, [memoId]);
    await dbRun('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (_e) {
      // ignore
    }
    const msg = err instanceof Error ? err.message : 'Failed to delete memo';
    return res.status(400).json({ error: msg });
  }
});

app.post('/api/memos/:id/return', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const memoId = Number(req.params.id);
  if (!Number.isFinite(memoId) || memoId <= 0) return res.status(400).json({ error: 'Invalid memo id' });

  const body = req.body || {};
  const rawPlan = Array.isArray(body.items) ? body.items : null;

  try {
    const memo = await dbGet(`SELECT id, memo_no, status FROM memos WHERE id = ?`, [memoId]);
    if (!memo) return res.status(404).json({ error: 'Memo not found' });
    if (memo.status === 'Closed') return res.status(400).json({ error: 'Memo is already closed' });

    const lines = await dbAll(`SELECT * FROM memo_items WHERE memo_id = ? ORDER BY id ASC`, [memoId]);
    if (!lines.length) return res.status(400).json({ error: 'Memo has no items' });

    /** memo_item_id -> qty to return this request */
    const planMap = new Map();
    if (rawPlan && rawPlan.length) {
      for (const p of rawPlan) {
        const mid = Number(p.memo_item_id);
        const q = Math.max(0, Math.floor(Number(p.quantity || 0)));
        if (!Number.isFinite(mid) || mid <= 0 || q <= 0) continue;
        planMap.set(mid, (planMap.get(mid) || 0) + q);
      }
    } else {
      for (const line of lines) {
        const rem = Math.max(0, Math.floor(Number(line.quantity || 0)) - Math.floor(Number(line.returned_qty || 0)));
        if (rem > 0) planMap.set(line.id, rem);
      }
    }

    if (planMap.size === 0) {
      return res.status(400).json({ error: 'Nothing to return' });
    }

    await dbRun('BEGIN TRANSACTION');

    const memoNo = String(memo.memo_no || `MEM-${memoId}`);

    for (const line of lines) {
      const want = planMap.get(line.id);
      if (!want) continue;
      const qLine = Math.floor(Number(line.quantity || 0));
      const already = Math.floor(Number(line.returned_qty || 0));
      const canReturn = Math.max(0, qLine - already);
      const take = Math.min(canReturn, want);
      if (take <= 0) continue;

      await dbRun(
        `UPDATE memo_items SET returned_qty = returned_qty + ? WHERE id = ? AND memo_id = ?`,
        [take, line.id, memoId]
      );

      await dbRun(
        `
        UPDATE inventory_items
        SET
          pieces_remaining = pieces_remaining + ?,
          status = CASE WHEN (pieces_remaining + ?) > 0 THEN 'Available' ELSE status END,
          updated_at = datetime('now')
        WHERE id = ?
      `,
        [take, take, line.inventory_item_id]
      );

      await dbRun(
        `
        INSERT INTO stock_movements (inventory_item_id, type, ref_type, ref_id, qty_change, note, user_id)
        VALUES (?, 'MEMO_RETURN', 'MEMO', ?, ?, ?, ?)
      `,
        [line.inventory_item_id, memoId, take, `Returned to stock from ${memoNo}`, req.user.id]
      );
    }

    const refreshed = await dbAll(`SELECT quantity, returned_qty FROM memo_items WHERE memo_id = ?`, [memoId]);
    let allBack = true;
    let anyBack = false;
    for (const r of refreshed) {
      const q = Math.floor(Number(r.quantity || 0));
      const rq = Math.floor(Number(r.returned_qty || 0));
      if (rq < q) allBack = false;
      if (rq > 0) anyBack = true;
    }

    const newStatus = allBack ? 'Closed' : anyBack ? 'Partially Returned' : 'Open';
    await dbRun(`UPDATE memos SET status = ?, updated_at = datetime('now') WHERE id = ?`, [newStatus, memoId]);

    await dbRun('COMMIT');

    return res.json({ ok: true, status: newStatus });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (_e) {
      // ignore
    }
    const msg = err instanceof Error ? err.message : 'Failed to process return';
    return res.status(400).json({ error: msg });
  }
});

app.post('/api/memos/:id/convert-to-invoice', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const memoId = Number(req.params.id);
  if (!Number.isFinite(memoId) || memoId <= 0) return res.status(400).json({ error: 'Invalid memo id' });

  try {
    const memo = await dbGet(
      `SELECT id, memo_no, customer_id, converted_invoice_id, status, currency_code FROM memos WHERE id = ?`,
      [memoId]
    );
    if (!memo) return res.status(404).json({ error: 'Memo not found' });
    if (memo.converted_invoice_id) {
      return res.status(400).json({ error: 'Memo was already converted to an invoice' });
    }
    if (memo.status === 'Closed') {
      return res.status(400).json({ error: 'Cannot convert a closed memo' });
    }

    const lines = await dbAll(`SELECT * FROM memo_items WHERE memo_id = ? ORDER BY id ASC`, [memoId]);
    const toBill = lines
      .map(l => {
        const q = Math.floor(Number(l.quantity || 0));
        const rq = Math.floor(Number(l.returned_qty || 0));
        const remaining = Math.max(0, q - rq);
        return { ...l, remaining };
      })
      .filter(l => l.remaining > 0);

    if (!toBill.length) return res.status(400).json({ error: 'No items left on memo to invoice' });

    let subtotal = 0;
    for (const l of toBill) {
      subtotal += Number(l.unit_price || 0) * l.remaining;
    }
    const total = Math.max(0, subtotal);
    const customerId =
      memo.customer_id == null || memo.customer_id === '' ? null : Number(memo.customer_id);
    const invCurrency = normalizeCurrencyCode(memo.currency_code);

    await dbRun('BEGIN TRANSACTION');

    const invInsert = await dbRun(
      `
      INSERT INTO invoices (invoice_no, customer_id, subtotal, discount, total, status, currency_code, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, 'Unpaid', ?, datetime('now'), datetime('now'))
    `,
      [null, customerId, subtotal, total, invCurrency]
    );
    const invoiceId = invInsert.lastID;
    const invoiceNo = await nextSerialDocNumber('INV', 'invoices', null);

    for (const l of toBill) {
      const lineTotal = Number(l.unit_price || 0) * l.remaining;
      await dbRun(
        `
        INSERT INTO invoice_items (
          invoice_id, inventory_item_id, item_code, description, quantity, unit_price, line_total
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [invoiceId, l.inventory_item_id, l.item_code, l.description, l.remaining, l.unit_price, lineTotal]
      );

      await dbRun(
        `
        INSERT INTO stock_movements (inventory_item_id, type, ref_type, ref_id, qty_change, note, user_id)
        VALUES (?, 'SALE', 'INVOICE', ?, 0, ?, ?)
      `,
        [
          l.inventory_item_id,
          invoiceId,
          `Billed from memo ${memo.memo_no} (${l.remaining} pc) — no stock change`,
          req.user.id,
        ]
      );
    }

    await dbRun(`UPDATE invoices SET invoice_no = ? WHERE id = ?`, [invoiceNo, invoiceId]);
    await dbRun(
      `UPDATE memos SET converted_invoice_id = ?, status = 'Closed', updated_at = datetime('now') WHERE id = ?`,
      [invoiceId, memoId]
    );

    await dbRun('COMMIT');

    return res.status(201).json({
      ok: true,
      invoice_id: invoiceId,
      invoice_no: invoiceNo,
      total,
    });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (_e) {
      // ignore
    }
    const msg = err instanceof Error ? err.message : 'Failed to convert memo';
    return res.status(400).json({ error: msg });
  }
});

// Invoices list + detail
app.get('/api/invoices', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
  const customerId = req.query.customer_id ? Number(req.query.customer_id) : null;
  const search = req.query.search ? String(req.query.search).trim() : '';
  const statusQ = req.query.status ? String(req.query.status) : '';

  const where = [];
  const params = [];
  if (Number.isFinite(customerId) && customerId && customerId > 0) {
    where.push('i.customer_id = ?');
    params.push(customerId);
  }
  if (search) {
    where.push('(i.invoice_no LIKE ? OR IFNULL(c.name, "") LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s);
  }
  if (['Unpaid', 'Partial', 'Paid'].includes(statusQ)) {
    where.push('i.status = ?');
    params.push(statusQ);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const paymentsAgg = `(SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) ip`;

  const sql = `
    SELECT
      i.id,
      i.invoice_no,
      c.name AS customer_name,
      i.total,
      IFNULL(ip.paid, 0) AS paid,
      i.status,
      i.created_at,
      IFNULL(i.currency_code, 'THB') AS currency_code
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${whereSql}
    ORDER BY i.created_at DESC
    LIMIT ?
  `;

  db.all(sql, [...params, limit], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Internal server error' });
    res.json(rows);
  });
});

/** Invoice KPIs: full matching set (no LIMIT), same optional filters as list + status tab. */
app.get('/api/invoices/stats', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const search = req.query.search ? String(req.query.search).trim() : '';
  const rawStatus = req.query.status ? String(req.query.status) : 'all';
  const statusFilter = ['all', 'Unpaid', 'Partial', 'Paid'].includes(rawStatus) ? rawStatus : 'all';
  const customerId = req.query.customer_id ? Number(req.query.customer_id) : null;

  const where = [];
  const params = [];
  if (Number.isFinite(customerId) && customerId && customerId > 0) {
    where.push('i.customer_id = ?');
    params.push(customerId);
  }
  if (search) {
    where.push('(i.invoice_no LIKE ? OR IFNULL(c.name, "") LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s);
  }
  if (statusFilter !== 'all') {
    where.push('i.status = ?');
    params.push(statusFilter);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const paymentsAgg = `(SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) ip`;

  const sql = `
    SELECT
      COUNT(i.id) AS invoices_count,
      SUM(CASE WHEN i.status = 'Unpaid' THEN 1 ELSE 0 END) AS unpaid_count,
      SUM(CASE WHEN i.status = 'Partial' THEN 1 ELSE 0 END) AS partial_count,
      SUM(CASE WHEN i.status = 'Paid' THEN 1 ELSE 0 END) AS paid_count,
      SUM(CASE WHEN i.status IN ('Unpaid', 'Partial') THEN 1 ELSE 0 END) AS return_eligible_count,
      IFNULL(SUM(MAX(0, i.total - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}), 0) AS outstanding_thb,
      IFNULL(SUM(IFNULL(ip.paid, 0) * ${SQL_THB_PER_INV}), 0) AS collected_thb
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    ${whereSql}
  `;

  db.get(sql, params, (err, row) => {
    if (err) {
      console.error('invoices stats', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.json({
      invoices_count: Number(row?.invoices_count || 0),
      unpaid_count: Number(row?.unpaid_count || 0),
      partial_count: Number(row?.partial_count || 0),
      paid_count: Number(row?.paid_count || 0),
      return_eligible_count: Number(row?.return_eligible_count || 0),
      outstanding_thb: Number(row?.outstanding_thb || 0),
      collected_thb: Number(row?.collected_thb || 0),
    });
  });
});

app.get('/api/invoices/:id', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid invoice id' });

  const paymentsAgg = `(SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) ip`;

  const sqlInvoice = `
    SELECT
      i.id,
      i.invoice_no,
      c.id AS customer_id,
      c.name AS customer_name,
      c.phone AS customer_phone,
      c.email AS customer_email,
      c.address_line1 AS customer_address_line1,
      c.address_line2 AS customer_address_line2,
      c.city AS customer_city,
      c.postal_code AS customer_postal_code,
      c.country AS customer_country,
      i.subtotal,
      i.discount,
      i.total,
      i.status,
      IFNULL(ip.paid, 0) AS paid,
      i.created_at,
      i.updated_at,
      IFNULL(i.currency_code, 'THB') AS currency_code
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    WHERE i.id = ?
  `;

  const sqlItems = `
    SELECT
      ii.id,
      ii.invoice_id,
      ii.inventory_item_id,
      ii.item_code,
      ii.description,
      ii.quantity,
      IFNULL(ii.returned_qty, 0) AS returned_qty,
      ii.unit_price,
      ii.line_total,
      inv.category AS inv_category,
      inv.item_type AS inv_item_type,
      inv.item_code AS inv_item_code,
      inv.item_sticker AS inv_item_sticker,
      inv.weight_grams AS weight_grams,
      inv.weight_carats AS weight_carats,
      inv.description AS inventory_description
    FROM invoice_items ii
    LEFT JOIN inventory_items inv ON inv.id = ii.inventory_item_id
    WHERE ii.invoice_id = ?
    ORDER BY ii.id ASC
  `;

  const sqlPayments = `
    SELECT
      id, invoice_id, method, amount, note, created_at
    FROM payments
    WHERE invoice_id = ?
    ORDER BY created_at ASC
  `;

  db.get(sqlInvoice, [id], (err, invRow) => {
    if (err) return res.status(500).json({ error: 'Internal server error' });
    if (!invRow) return res.status(404).json({ error: 'Invoice not found' });

    db.all(sqlItems, [id], (err2, items) => {
      if (err2) return res.status(500).json({ error: 'Internal server error' });
      const itemsOut = (items || []).map(row => ({
        id: row.id,
        invoice_id: row.invoice_id,
        inventory_item_id: row.inventory_item_id,
        item_code: row.item_code,
        description: enrichDescriptionFromInventoryJoin(row),
        quantity: row.quantity,
        returned_qty: Math.floor(Number(row.returned_qty || 0)),
        unit_price: row.unit_price,
        line_total: row.line_total,
        weight_grams: row.weight_grams,
        weight_carats: row.weight_carats,
      }));
      db.all(sqlPayments, [id], (err3, payments) => {
        if (err3) return res.status(500).json({ error: 'Internal server error' });
        res.json({ ...invRow, items: itemsOut, payments, derived_status: invRow.status });
      });
    });
  });
});

/** Return sold goods from an invoice back to inventory (increment returned_qty, restock). */
app.post('/api/returns/from-invoice', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const body = req.body || {};
  const invoiceId = Number(body.invoice_id);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const note = body.note != null && String(body.note).trim() ? String(body.note).trim() : 'Customer return';

  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ error: 'invoice_id is required' });
  }
  if (!rawItems.length) {
    return res.status(400).json({ error: 'At least one line item is required' });
  }

  /** invoice_item_id -> total qty requested this call */
  const planMap = new Map();
  for (const p of rawItems) {
    const iid = Number(p.invoice_item_id);
    const q = Math.max(0, Math.floor(Number(p.quantity || 0)));
    if (!Number.isFinite(iid) || iid <= 0 || q <= 0) continue;
    planMap.set(iid, (planMap.get(iid) || 0) + q);
  }
  if (planMap.size === 0) {
    return res.status(400).json({ error: 'No valid return quantities' });
  }

  try {
    const inv = await dbGet(`SELECT id, invoice_no FROM invoices WHERE id = ?`, [invoiceId]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const lines = await dbAll(
      `SELECT id, invoice_id, inventory_item_id, quantity, IFNULL(returned_qty, 0) AS returned_qty
       FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC`,
      [invoiceId]
    );
    if (!lines.length) return res.status(400).json({ error: 'Invoice has no line items' });

    const lineById = new Map(lines.map(l => [l.id, l]));
    let any = false;

    await dbRun('BEGIN TRANSACTION');
    const invNo = String(inv.invoice_no || `INV-${invoiceId}`);

    for (const [itemId, want] of planMap.entries()) {
      const line = lineById.get(itemId);
      if (!line) {
        await dbRun('ROLLBACK');
        return res.status(400).json({ error: `Invoice line ${itemId} is not on this invoice` });
      }
      const qLine = Math.floor(Number(line.quantity || 0));
      const already = Math.floor(Number(line.returned_qty || 0));
      const canReturn = Math.max(0, qLine - already);
      const take = Math.min(canReturn, want);
      if (take <= 0) continue;
      any = true;

      await dbRun(`UPDATE invoice_items SET returned_qty = IFNULL(returned_qty, 0) + ? WHERE id = ? AND invoice_id = ?`, [
        take,
        itemId,
        invoiceId,
      ]);

      await dbRun(
        `
        UPDATE inventory_items
        SET
          pieces_remaining = pieces_remaining + ?,
          status = CASE WHEN (pieces_remaining + ?) > 0 THEN 'Available' ELSE status END,
          updated_at = datetime('now')
        WHERE id = ?
      `,
        [take, take, line.inventory_item_id]
      );

      await dbRun(
        `
        INSERT INTO stock_movements (inventory_item_id, type, ref_type, ref_id, qty_change, note, user_id)
        VALUES (?, 'INVOICE_RETURN', 'INVOICE', ?, ?, ?, ?)
      `,
        [line.inventory_item_id, invoiceId, take, `${note} (${invNo})`, req.user.id]
      );
    }

    if (!any) {
      await dbRun('ROLLBACK');
      return res.status(400).json({ error: 'Nothing left to return for the selected lines' });
    }

    await dbRun('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (_e) {
      // ignore
    }
    const msg = err instanceof Error ? err.message : 'Failed to process return';
    return res.status(400).json({ error: msg });
  }
});

/** Ad-hoc restock (no invoice): increase pieces_remaining and log movement. */
app.post('/api/restock', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const body = req.body || {};
  const inventoryItemId = Number(body.inventory_item_id);
  const qty = Math.max(0, Math.floor(Number(body.quantity || 0)));
  const note = body.note != null && String(body.note).trim() ? String(body.note).trim() : null;

  if (!Number.isFinite(inventoryItemId) || inventoryItemId <= 0) {
    return res.status(400).json({ error: 'inventory_item_id is required' });
  }
  if (qty <= 0) return res.status(400).json({ error: 'quantity must be greater than zero' });

  try {
    const row = await dbGet(`SELECT id FROM inventory_items WHERE id = ?`, [inventoryItemId]);
    if (!row) return res.status(404).json({ error: 'Inventory item not found' });

    await dbRun(
      `
      UPDATE inventory_items
      SET
        pieces_remaining = pieces_remaining + ?,
        status = CASE WHEN (pieces_remaining + ?) > 0 THEN 'Available' ELSE status END,
        updated_at = datetime('now')
      WHERE id = ?
    `,
      [qty, qty, inventoryItemId]
    );

    await dbRun(
      `
      INSERT INTO stock_movements (inventory_item_id, type, ref_type, ref_id, qty_change, note, user_id)
      VALUES (?, 'RESTOCK', NULL, NULL, ?, ?, ?)
    `,
      [inventoryItemId, qty, note || 'Manual restock', req.user.id]
    );

    return res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to restock';
    return res.status(400).json({ error: msg });
  }
});

app.post('/api/invoices', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const body = req.body || {};
  const customerId =
    body.customer_id == null || body.customer_id === ''
      ? null
      : Number(body.customer_id);
  const orderDiscount = Number(body.discount || 0);
  const items = Array.isArray(body.items) ? body.items : [];
  const currency_code = normalizeCurrencyCode(body.currency_code);

  if (!items.length) return res.status(400).json({ error: 'At least one item is required' });
  if (orderDiscount < 0) return res.status(400).json({ error: 'discount must be >= 0' });
  if (customerId != null && (!Number.isFinite(customerId) || customerId <= 0)) {
    return res.status(400).json({ error: 'Invalid customer id' });
  }

  let subtotal = 0;
  let itemsDiscountTotal = 0;
  for (const it of items) {
    const inventoryItemId = Number(it.inventory_item_id);
    const unitPrice = Number(it.price || 0);
    const discount = Number(it.discount || 0);
    const quantity = Math.max(1, Math.floor(Number(it.quantity ?? 1)));
    if (!Number.isFinite(inventoryItemId) || inventoryItemId <= 0) {
      return res.status(400).json({ error: 'Invalid inventory_item_id' });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(400).json({ error: 'Invalid item price' });
    }
    if (!Number.isFinite(discount) || discount < 0) {
      return res.status(400).json({ error: 'Invalid item discount' });
    }
    if (!Number.isFinite(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }
    const lineGross = unitPrice * quantity;
    subtotal += lineGross;
    itemsDiscountTotal += Math.min(discount, lineGross);
  }

  const totalDiscount = Math.min(subtotal, itemsDiscountTotal + orderDiscount);
  const total = Math.max(0, subtotal - totalDiscount);

  try {
    await dbRun('BEGIN TRANSACTION');

    const invInsert = await dbRun(
      `
      INSERT INTO invoices (invoice_no, customer_id, subtotal, discount, total, status, currency_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Unpaid', ?, datetime('now'), datetime('now'))
    `,
      [null, customerId, subtotal, totalDiscount, total, currency_code]
    );
    const invoiceId = invInsert.lastID;
    const invoiceNo = await nextSerialDocNumber('INV', 'invoices', null);

    for (const it of items) {
      const inventoryItemId = Number(it.inventory_item_id);
      const unitPrice = Number(it.price || 0);
      const discount = Number(it.discount || 0);
      const quantity = Math.max(1, Math.floor(Number(it.quantity ?? 1)));
      const lineGross = unitPrice * quantity;
      const lineTotal = Math.max(0, lineGross - Math.min(discount, lineGross));
      const stockRow = await dbGet(
        `
        SELECT id, pieces_remaining, status, category, item_type, weight_grams, weight_carats,
               item_code, item_sticker, description
        FROM inventory_items
        WHERE id = ?
      `,
        [inventoryItemId]
      );
      if (!stockRow) throw new Error(`Inventory item ${inventoryItemId} not found`);
      const remaining = Number(stockRow.pieces_remaining || 0);
      const itemCode =
        it.item_code != null && String(it.item_code).trim()
          ? String(it.item_code).trim()
          : stockRow.item_code || stockRow.item_sticker || null;
      const description = buildInventoryLineDescription(stockRow, it.description);
      if (remaining <= 0) {
        throw new Error(`Item ${itemCode || `#${inventoryItemId}`} is out of stock`);
      }
      if (quantity > remaining) {
        throw new Error(
          `Not enough pieces for ${itemCode || `#${inventoryItemId}`}: requested ${quantity}, available ${remaining}`
        );
      }

      await dbRun(
        `
        INSERT INTO invoice_items (
          invoice_id, inventory_item_id, item_code, description, quantity, unit_price, line_total
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [invoiceId, inventoryItemId, itemCode, description, quantity, unitPrice, lineTotal]
      );

      await dbRun(
        `
        UPDATE inventory_items
        SET
          pieces_remaining = MAX(0, pieces_remaining - ?),
          status = CASE WHEN MAX(0, pieces_remaining - ?) <= 0 THEN 'Out of stock' ELSE 'Available' END,
          updated_at = datetime('now')
        WHERE id = ?
      `,
        [quantity, quantity, inventoryItemId]
      );

      await dbRun(
        `
        INSERT INTO stock_movements (inventory_item_id, type, ref_type, ref_id, qty_change, note, user_id)
        VALUES (?, 'SALE', 'INVOICE', ?, ?, ?, ?)
      `,
        [inventoryItemId, invoiceId, -quantity, `Sold ${quantity} pc(s) via ${invoiceNo}`, req.user.id]
      );
    }

    await dbRun(`UPDATE invoices SET invoice_no = ? WHERE id = ?`, [invoiceNo, invoiceId]);
    await dbRun('COMMIT');

    let customer_name = null;
    if (customerId != null) {
      const cRow = await dbGet('SELECT name FROM customers WHERE id = ?', [customerId]);
      if (cRow && cRow.name != null && String(cRow.name).trim() !== '') {
        customer_name = String(cRow.name).trim();
      }
    }

    return res.status(201).json({
      id: invoiceId,
      invoice_no: invoiceNo,
      customer_name,
      total,
      paid: 0,
      status: 'Unpaid',
      created_at: new Date().toISOString(),
      customer_id: customerId,
      subtotal,
      discount: totalDiscount,
      currency_code,
    });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (_e) {
      // ignore rollback errors
    }
    const msg = err instanceof Error ? err.message : 'Failed to create invoice';
    return res.status(400).json({ error: msg });
  }
});

// Replace invoice line items + totals (unpaid, no payments). Reverts old stock, applies new lines.
app.put('/api/invoices/:id', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid invoice id' });

  const body = req.body || {};
  const customerId =
    body.customer_id == null || body.customer_id === ''
      ? null
      : Number(body.customer_id);
  const orderDiscount = Number(body.discount || 0);
  const items = Array.isArray(body.items) ? body.items : [];
  const requestedCurrency =
    body.currency_code != null && body.currency_code !== ''
      ? normalizeCurrencyCode(body.currency_code)
      : null;

  if (!items.length) return res.status(400).json({ error: 'At least one item is required' });
  if (orderDiscount < 0) return res.status(400).json({ error: 'discount must be >= 0' });
  if (customerId != null && (!Number.isFinite(customerId) || customerId <= 0)) {
    return res.status(400).json({ error: 'Invalid customer id' });
  }

  let subtotal = 0;
  let itemsDiscountTotal = 0;
  for (const it of items) {
    const inventoryItemId = Number(it.inventory_item_id);
    const unitPrice = Number(it.price || 0);
    const discount = Number(it.discount || 0);
    const quantity = Math.max(1, Math.floor(Number(it.quantity ?? 1)));
    if (!Number.isFinite(inventoryItemId) || inventoryItemId <= 0) {
      return res.status(400).json({ error: 'Invalid inventory_item_id' });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(400).json({ error: 'Invalid item price' });
    }
    if (!Number.isFinite(discount) || discount < 0) {
      return res.status(400).json({ error: 'Invalid item discount' });
    }
    if (!Number.isFinite(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }
    const lineGross = unitPrice * quantity;
    subtotal += lineGross;
    itemsDiscountTotal += Math.min(discount, lineGross);
  }

  const totalDiscount = Math.min(subtotal, itemsDiscountTotal + orderDiscount);
  const total = Math.max(0, subtotal - totalDiscount);

  try {
    const inv = await dbGet(
      `SELECT id, invoice_no, IFNULL(currency_code, 'THB') AS currency_code FROM invoices WHERE id = ?`,
      [id]
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const paymentsAgg = await dbGet(
      `SELECT IFNULL(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ?`,
      [id]
    );
    const paid = Number(paymentsAgg?.paid || 0);
    if (paid > 0) {
      return res.status(400).json({ error: 'Cannot replace items on an invoice that has recorded payments' });
    }

    const currency_code = requestedCurrency || normalizeCurrencyCode(inv.currency_code);

    const oldLines = await dbAll(
      `SELECT inventory_item_id, quantity FROM invoice_items WHERE invoice_id = ?`,
      [id]
    );

    await dbRun('BEGIN TRANSACTION');

    for (const line of oldLines) {
      const qty = Math.max(0, Math.floor(Number(line.quantity || 0)));
      if (qty <= 0) continue;
      await dbRun(
        `
        UPDATE inventory_items
        SET
          pieces_remaining = pieces_remaining + ?,
          status = CASE WHEN (pieces_remaining + ?) > 0 THEN 'Available' ELSE 'Out of stock' END,
          updated_at = datetime('now')
        WHERE id = ?
      `,
        [qty, qty, line.inventory_item_id]
      );
    }

    await dbRun(`DELETE FROM stock_movements WHERE ref_type = 'INVOICE' AND ref_id = ?`, [id]);
    await dbRun(`DELETE FROM invoice_items WHERE invoice_id = ?`, [id]);

    const invoiceNo = String(inv.invoice_no || `INV-#${id}`);

    await dbRun(
      `
      UPDATE invoices
      SET customer_id = ?, subtotal = ?, discount = ?, total = ?, status = 'Unpaid', currency_code = ?, updated_at = datetime('now')
      WHERE id = ?
    `,
      [customerId, subtotal, totalDiscount, total, currency_code, id]
    );

    for (const it of items) {
      const inventoryItemId = Number(it.inventory_item_id);
      const unitPrice = Number(it.price || 0);
      const discount = Number(it.discount || 0);
      const quantity = Math.max(1, Math.floor(Number(it.quantity ?? 1)));
      const lineGross = unitPrice * quantity;
      const lineTotal = Math.max(0, lineGross - Math.min(discount, lineGross));
      const stockRow = await dbGet(
        `
        SELECT id, pieces_remaining, status, category, item_type, weight_grams, weight_carats,
               item_code, item_sticker, description
        FROM inventory_items
        WHERE id = ?
      `,
        [inventoryItemId]
      );
      if (!stockRow) throw new Error(`Inventory item ${inventoryItemId} not found`);
      const remaining = Number(stockRow.pieces_remaining || 0);
      const itemCode =
        it.item_code != null && String(it.item_code).trim()
          ? String(it.item_code).trim()
          : stockRow.item_code || stockRow.item_sticker || null;
      const description = buildInventoryLineDescription(stockRow, it.description);
      if (remaining <= 0) {
        throw new Error(`Item ${itemCode || `#${inventoryItemId}`} is out of stock`);
      }
      if (quantity > remaining) {
        throw new Error(
          `Not enough pieces for ${itemCode || `#${inventoryItemId}`}: requested ${quantity}, available ${remaining}`
        );
      }

      await dbRun(
        `
        INSERT INTO invoice_items (
          invoice_id, inventory_item_id, item_code, description, quantity, unit_price, line_total
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [id, inventoryItemId, itemCode, description, quantity, unitPrice, lineTotal]
      );

      await dbRun(
        `
        UPDATE inventory_items
        SET
          pieces_remaining = MAX(0, pieces_remaining - ?),
          status = CASE WHEN MAX(0, pieces_remaining - ?) <= 0 THEN 'Out of stock' ELSE 'Available' END,
          updated_at = datetime('now')
        WHERE id = ?
      `,
        [quantity, quantity, inventoryItemId]
      );

      await dbRun(
        `
        INSERT INTO stock_movements (inventory_item_id, type, ref_type, ref_id, qty_change, note, user_id)
        VALUES (?, 'SALE', 'INVOICE', ?, ?, ?, ?)
      `,
        [inventoryItemId, id, -quantity, `Sold ${quantity} pc(s) via ${invoiceNo}`, req.user.id]
      );
    }

    await dbRun('COMMIT');

    const row = await dbGet(
      `
      SELECT
        i.id,
        i.invoice_no,
        c.name AS customer_name,
        i.total,
        IFNULL(p.paid, 0) AS paid,
        i.status,
        i.created_at,
        IFNULL(i.currency_code, 'THB') AS currency_code
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
      WHERE i.id = ?
    `,
      [id]
    );

    return res.json(row);
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (_e) {
      // ignore
    }
    const msg = err instanceof Error ? err.message : 'Failed to update invoice';
    return res.status(400).json({ error: msg });
  }
});

app.patch('/api/invoices/:id', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid invoice id' });
  const body = req.body || {};

  try {
    const inv = await dbGet(
      `SELECT id, invoice_no, customer_id, subtotal, discount, total, status FROM invoices WHERE id = ?`,
      [id]
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const paymentsAgg = await dbGet(
      `SELECT IFNULL(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ?`,
      [id]
    );
    const paid = Number(paymentsAgg?.paid || 0);
    if (paid > 0) {
      return res.status(400).json({ error: 'Cannot edit an invoice that has recorded payments' });
    }

    const items = await dbAll(
      `SELECT quantity, unit_price, line_total FROM invoice_items WHERE invoice_id = ?`,
      [id]
    );
    const gross = items.reduce((s, row) => s + Number(row.quantity || 0) * Number(row.unit_price || 0), 0);
    const linesNet = items.reduce((s, row) => s + Number(row.line_total || 0), 0);
    const minDiscount = Math.max(0, gross - linesNet);

    const hasCustomer = Object.prototype.hasOwnProperty.call(body, 'customer_id');
    const hasDiscount = Object.prototype.hasOwnProperty.call(body, 'discount');
    if (!hasCustomer && !hasDiscount) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    let nextCustomerId = inv.customer_id;
    if (hasCustomer) {
      const raw = body.customer_id;
      if (raw === null || raw === '') {
        nextCustomerId = null;
      } else {
        const cid = Number(raw);
        if (!Number.isFinite(cid) || cid <= 0) {
          return res.status(400).json({ error: 'Invalid customer_id' });
        }
        const cust = await dbGet('SELECT id FROM customers WHERE id = ?', [cid]);
        if (!cust) return res.status(400).json({ error: 'Customer not found' });
        nextCustomerId = cid;
      }
    }

    let nextDiscount = Number(inv.discount);
    if (hasDiscount) {
      const d = Number(body.discount);
      if (!Number.isFinite(d) || d < minDiscount - 1e-9 || d > gross + 1e-9) {
        return res.status(400).json({
          error: `discount must be between line-item minimum (${minDiscount.toFixed(2)}) and subtotal (${gross.toFixed(2)})`,
        });
      }
      nextDiscount = d;
    }

    if (nextDiscount < minDiscount - 1e-9 || nextDiscount > gross + 1e-9) {
      return res.status(400).json({ error: 'Current invoice discount is inconsistent; reload and try again' });
    }

    const nextTotal = Math.max(0, gross - nextDiscount);

    await dbRun(
      `
      UPDATE invoices
      SET customer_id = ?, subtotal = ?, discount = ?, total = ?, status = 'Unpaid', updated_at = datetime('now')
      WHERE id = ?
    `,
      [nextCustomerId, gross, nextDiscount, nextTotal, id]
    );

    const row = await dbGet(
      `
      SELECT
        i.id,
        i.invoice_no,
        c.name AS customer_name,
        i.total,
        IFNULL(p.paid, 0) AS paid,
        i.status,
        i.created_at
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
      WHERE i.id = ?
    `,
      [id]
    );

    return res.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update invoice';
    return res.status(400).json({ error: msg });
  }
});

app.delete('/api/invoices/:id', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid invoice id' });

  try {
    const paymentsAgg = await dbGet(
      `SELECT IFNULL(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ?`,
      [id]
    );
    const paid = Number(paymentsAgg?.paid || 0);
    if (paid > 0) {
      return res.status(400).json({ error: 'Cannot delete an invoice that has recorded payments' });
    }

    const inv = await dbGet('SELECT id FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const items = await dbAll(
      `SELECT inventory_item_id, quantity FROM invoice_items WHERE invoice_id = ?`,
      [id]
    );

    await dbRun('BEGIN TRANSACTION');
    for (const line of items) {
      const qty = Math.max(0, Math.floor(Number(line.quantity || 0)));
      if (qty <= 0) continue;
      await dbRun(
        `
        UPDATE inventory_items
        SET
          pieces_remaining = pieces_remaining + ?,
          status = CASE WHEN (pieces_remaining + ?) > 0 THEN 'Available' ELSE 'Out of stock' END,
          updated_at = datetime('now')
        WHERE id = ?
      `,
        [qty, qty, line.inventory_item_id]
      );
    }

    await dbRun(`DELETE FROM stock_movements WHERE ref_type = 'INVOICE' AND ref_id = ?`, [id]);
    await dbRun(`DELETE FROM invoices WHERE id = ?`, [id]);
    await dbRun('COMMIT');

    return res.json({ ok: true, id });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (_e) {
      // ignore
    }
    const msg = err instanceof Error ? err.message : 'Failed to delete invoice';
    return res.status(400).json({ error: msg });
  }
});

app.post('/api/invoices/:id/payments', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const invoiceId = Number(req.params.id);
  const method = String(req.body?.method || '');
  const amount = roundMoney2(req.body?.amount || 0);
  const note = req.body?.note ? String(req.body.note) : null;

  if (!Number.isFinite(invoiceId) || invoiceId <= 0) return res.status(400).json({ error: 'Invalid invoice id' });
  if (!['Cash', 'Card', 'QR', 'BankTransfer'].includes(method)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Payment amount must be greater than zero' });
  }

  try {
    const invoice = await dbGet('SELECT id, invoice_no, total FROM invoices WHERE id = ?', [invoiceId]);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const paymentInsert = await dbRun(
      `
      INSERT INTO payments (invoice_id, method, amount, note, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `,
      [invoiceId, method, amount, note]
    );

    const paidRow = await dbGet('SELECT IFNULL(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ?', [invoiceId]);
    const paid = Number(paidRow?.paid || 0);
    const total = Number(invoice.total || 0);
    const newStatus = paid >= total ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';

    await dbRun('UPDATE invoices SET status = ?, updated_at = datetime(\'now\') WHERE id = ?', [newStatus, invoiceId]);

    const payment = await dbGet(
      `
      SELECT id, invoice_id, method, amount, note, created_at
      FROM payments
      WHERE id = ?
    `,
      [paymentInsert.lastID]
    );

    return res.json({
      payment,
      invoice: {
        id: invoiceId,
        invoice_no: invoice.invoice_no,
        total,
        status: newStatus,
        paid,
      },
    });
  } catch (_err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Selling drafts
app.post('/api/selling/drafts', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const payload = req.body?.payload;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'payload is required' });
  }

  const payloadJson = JSON.stringify(payload);
  db.run(
    `
    INSERT INTO selling_drafts (user_id, payload_json, created_at, updated_at)
    VALUES (?, ?, datetime('now'), datetime('now'))
  `,
    [req.user.id, payloadJson],
    function (err) {
      if (err) return res.status(500).json({ error: 'Internal server error' });
      return res.status(201).json({ id: this.lastID, ok: true });
    }
  );
});

app.get('/api/selling/drafts/latest', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  db.get(
    `
    SELECT id, payload_json, created_at, updated_at
    FROM selling_drafts
    WHERE user_id = ?
    ORDER BY datetime(updated_at) DESC, id DESC
    LIMIT 1
  `,
    [req.user.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Internal server error' });
      if (!row) return res.status(404).json({ error: 'No draft found' });

      let payload = null;
      try {
        payload = JSON.parse(row.payload_json || '{}');
      } catch (_e) {
        payload = {};
      }

      return res.json({
        id: row.id,
        payload,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }
  );
});

// ===== Customers =====
/** Full-database aggregates for KPIs (same filters as list; no row LIMIT). */
app.get('/api/customers/stats', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const search = req.query.search ? String(req.query.search).trim() : '';
  const onlyBalance =
    req.query.only_with_balance === '1' || req.query.only_with_balance === 'true';

  const paymentsAgg = `(SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) ip`;

  const whereCustomer = [];
  const params = [];
  if (search) {
    whereCustomer.push(
      '(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR IFNULL(c.city,"") LIKE ? OR IFNULL(c.address_line1,"") LIKE ?)'
    );
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }
  const whereCustomerSql = whereCustomer.length ? `WHERE ${whereCustomer.join(' AND ')}` : '';

  const innerSql = `
    SELECT
      c.id,
      IFNULL(SUM(i.total * ${SQL_THB_PER_INV}), 0) AS total_invoiced,
      IFNULL(SUM(IFNULL(ip.paid, 0) * ${SQL_THB_PER_INV}), 0) AS total_paid,
      IFNULL(
        SUM(MAX(0, IFNULL(i.total, 0) - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}),
        0
      ) AS total_owed
    FROM customers c
    LEFT JOIN invoices i ON i.customer_id = c.id
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    ${whereCustomerSql}
    GROUP BY c.id
  `;

  const sql = onlyBalance
    ? `
    SELECT
      COUNT(*) AS customer_count,
      IFNULL(SUM(x.total_invoiced), 0) AS total_invoiced,
      IFNULL(SUM(x.total_paid), 0) AS total_paid,
      IFNULL(SUM(x.total_owed), 0) AS total_owed,
      IFNULL(SUM(x.total_invoiced - x.total_owed), 0) AS applied_to_invoices_thb
    FROM (${innerSql}) x
    WHERE x.total_owed > 0.0001
  `
    : `
    SELECT
      COUNT(*) AS customer_count,
      IFNULL(SUM(x.total_invoiced), 0) AS total_invoiced,
      IFNULL(SUM(x.total_paid), 0) AS total_paid,
      IFNULL(SUM(x.total_owed), 0) AS total_owed,
      IFNULL(SUM(x.total_invoiced - x.total_owed), 0) AS applied_to_invoices_thb
    FROM (${innerSql}) x
  `;

  db.get(sql, params, (err, row) => {
    if (err) {
      console.error('customers stats', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    const totalInvoiced = roundMoney2(Number(row?.total_invoiced || 0));
    const totalPaid = roundMoney2(Number(row?.total_paid || 0));
    const totalOwed = roundMoney2(Number(row?.total_owed || 0));
    const appliedThb = roundMoney2(Number(row?.applied_to_invoices_thb || 0));
    const overpaymentThb = roundMoney2(Math.max(0, totalPaid - appliedThb));
    res.json({
      customer_count: Number(row?.customer_count || 0),
      total_invoiced: totalInvoiced,
      total_paid: totalPaid,
      total_owed: totalOwed,
      applied_to_invoices_thb: appliedThb,
      overpayment_thb: overpaymentThb,
    });
  });
});

app.get('/api/customers', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  const search = req.query.search ? String(req.query.search).trim() : '';
  const onlyBalance =
    req.query.only_with_balance === '1' || req.query.only_with_balance === 'true';

  const where = [];
  const params = [];
  if (search) {
    where.push(
      '(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR IFNULL(c.city,"") LIKE ? OR IFNULL(c.address_line1,"") LIKE ?)'
    );
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const havingSql = onlyBalance
    ? `HAVING IFNULL(SUM(MAX(0, IFNULL(i.total, 0) - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}), 0) > 0.0001`
    : '';

  const paymentsAgg = `(SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) ip`;

  const sql = `
    SELECT
      c.id,
      c.name,
      c.phone,
      c.email,
      c.notes,
      c.address_line1,
      c.address_line2,
      c.city,
      c.postal_code,
      c.country,
      c.created_at,
      c.updated_at,
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(i.total * ${SQL_THB_PER_INV}), 0) AS total_invoiced,
      IFNULL(SUM(IFNULL(ip.paid, 0) * ${SQL_THB_PER_INV}), 0) AS total_paid,
      IFNULL(
        SUM(MAX(0, IFNULL(i.total, 0) - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}),
        0
      ) AS total_owed,
      MAX(i.created_at) AS last_invoice_at
    FROM customers c
    LEFT JOIN invoices i ON i.customer_id = c.id
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    ${whereSql}
    GROUP BY c.id
    ${havingSql}
    ORDER BY total_owed DESC, last_invoice_at DESC
    LIMIT ?
  `;

  db.all(sql, [...params, limit], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Internal server error' });
    res.json(rows);
  });
});

app.get('/api/customers/:id', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid customer id' });

  const paymentsAgg = `(SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) ip`;

  const sqlCustomer = `
    SELECT
      c.id,
      c.name,
      c.phone,
      c.email,
      c.notes,
      c.address_line1,
      c.address_line2,
      c.city,
      c.postal_code,
      c.country,
      c.created_at,
      c.updated_at,
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(i.total * ${SQL_THB_PER_INV}), 0) AS total_invoiced,
      IFNULL(SUM(IFNULL(ip.paid, 0) * ${SQL_THB_PER_INV}), 0) AS total_paid,
      IFNULL(
        SUM(MAX(0, IFNULL(i.total, 0) - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}),
        0
      ) AS total_owed,
      MAX(i.created_at) AS last_invoice_at
    FROM customers c
    LEFT JOIN invoices i ON i.customer_id = c.id
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE c.id = ?
    GROUP BY c.id
  `;

  const sqlInvoices = `
    SELECT
      i.id,
      i.invoice_no,
      i.created_at,
      IFNULL(i.total, 0) AS total,
      IFNULL(ip.paid, 0) AS paid,
      (IFNULL(i.total, 0) - IFNULL(ip.paid, 0)) AS balance,
      i.status,
      IFNULL(i.currency_code, 'THB') AS currency_code,
      IFNULL(SUM(ii.quantity), 0) AS items_count
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
    WHERE i.customer_id = ?
    GROUP BY i.id
    ORDER BY i.created_at DESC
  `;

  db.get(sqlCustomer, [id], (err, customerRow) => {
    if (err) return res.status(500).json({ error: 'Internal server error' });
    if (!customerRow) return res.status(404).json({ error: 'Customer not found' });

    db.all(sqlInvoices, [id], (err2, invoices) => {
      if (err2) return res.status(500).json({ error: 'Internal server error' });

      const sqlMemos = `
        SELECT
          m.id,
          m.memo_no,
          m.status,
          m.memo_date,
          m.due_date,
          m.notes,
          m.converted_invoice_id,
          IFNULL(m.currency_code, 'THB') AS currency_code,
          m.created_at,
          (
            SELECT IFNULL(COUNT(*), 0) FROM memo_items mi WHERE mi.memo_id = m.id
          ) AS items_count,
          (
            SELECT IFNULL(SUM(
              mi.unit_price * (CASE WHEN mi.quantity > mi.returned_qty THEN mi.quantity - mi.returned_qty ELSE 0 END)
            ), 0)
            FROM memo_items mi WHERE mi.memo_id = m.id
          ) AS total_value
        FROM memos m
        WHERE m.customer_id = ?
        ORDER BY
          CASE m.status
            WHEN 'Open' THEN 0
            WHEN 'Partially Returned' THEN 1
            ELSE 2
          END,
          m.created_at DESC
      `;

      db.all(sqlMemos, [id], (err3, memos) => {
        if (err3) return res.status(500).json({ error: 'Internal server error' });
        res.json({ customer: customerRow, invoices, memos: memos || [] });
      });
    });
  });
});

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

app.post('/api/customers', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const body = req.body || {};
  const forceDuplicate = body.force_duplicate === true || body.force_duplicate === 'true';
  const customerName = String(body.name || '').trim();
  if (!customerName) return res.status(400).json({ error: 'Customer name is required' });

  const phoneVal = strOrNull(body.phone);
  const emailVal = strOrNull(body.email);
  const notesVal = strOrNull(body.notes);
  const a1 = strOrNull(body.address_line1);
  const a2 = strOrNull(body.address_line2);
  const city = strOrNull(body.city);
  const postal = strOrNull(body.postal_code);
  const country = strOrNull(body.country);

  const normPhoneDigits = phoneVal ? String(phoneVal).replace(/\D/g, '') : '';
  const emailNorm = emailVal ? String(emailVal).toLowerCase().trim() : '';

  const runInsert = () => {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO customers (name, phone, email, notes, address_line1, address_line2, city, postal_code, country, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customerName, phoneVal, emailVal, notesVal, a1, a2, city, postal, country, now],
      function (err) {
        if (err) return res.status(500).json({ error: 'Internal server error' });
        const id = this.lastID;
        db.get(
          `SELECT id, name, phone, email, notes, address_line1, address_line2, city, postal_code, country, created_at, updated_at
           FROM customers WHERE id = ?`,
          [id],
          (e2, row) => {
            if (e2) return res.status(500).json({ error: 'Internal server error' });
            res.status(201).json(row);
          }
        );
      }
    );
  };

  if (forceDuplicate) {
    runInsert();
    return;
  }

  db.all('SELECT id, name, phone, email FROM customers', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Internal server error' });
    const duplicates = (rows || []).filter(c => {
      const cPhone = c.phone ? String(c.phone).replace(/\D/g, '') : '';
      const phoneDup =
        normPhoneDigits.length >= 7 && cPhone.length >= 7 && cPhone === normPhoneDigits;
      const emailDup =
        Boolean(emailNorm) &&
        c.email &&
        String(c.email).toLowerCase().trim() === emailNorm;
      return phoneDup || emailDup;
    });
    if (duplicates.length) {
      return res.status(409).json({
        error: 'A customer with this phone number or email already exists.',
        duplicates: duplicates.map(d => ({
          id: d.id,
          name: d.name,
          phone: d.phone,
          email: d.email,
        })),
      });
    }
    runInsert();
  });
});

app.patch('/api/customers/:id', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid customer id' });
  const body = req.body || {};

  db.get(
    `SELECT id, name, phone, email, notes, address_line1, address_line2, city, postal_code, country FROM customers WHERE id = ?`,
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Internal server error' });
      if (!row) return res.status(404).json({ error: 'Customer not found' });

      const name =
        body.name !== undefined ? String(body.name || '').trim() : String(row.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Customer name is required' });

      const next = {
        name,
        phone: body.phone !== undefined ? strOrNull(body.phone) : row.phone,
        email: body.email !== undefined ? strOrNull(body.email) : row.email,
        notes: body.notes !== undefined ? strOrNull(body.notes) : row.notes,
        address_line1:
          body.address_line1 !== undefined ? strOrNull(body.address_line1) : row.address_line1,
        address_line2:
          body.address_line2 !== undefined ? strOrNull(body.address_line2) : row.address_line2,
        city: body.city !== undefined ? strOrNull(body.city) : row.city,
        postal_code:
          body.postal_code !== undefined ? strOrNull(body.postal_code) : row.postal_code,
        country: body.country !== undefined ? strOrNull(body.country) : row.country,
      };

      const now = new Date().toISOString();

      db.run(
        `UPDATE customers SET name = ?, phone = ?, email = ?, notes = ?, address_line1 = ?, address_line2 = ?,
         city = ?, postal_code = ?, country = ?, updated_at = ? WHERE id = ?`,
        [
          next.name,
          next.phone,
          next.email,
          next.notes,
          next.address_line1,
          next.address_line2,
          next.city,
          next.postal_code,
          next.country,
          now,
          id,
        ],
        function (uErr) {
          if (uErr) return res.status(500).json({ error: 'Internal server error' });
          db.get(
            `SELECT id, name, phone, email, notes, address_line1, address_line2, city, postal_code, country, created_at, updated_at
             FROM customers WHERE id = ?`,
            [id],
            (e2, updated) => {
              if (e2) return res.status(500).json({ error: 'Internal server error' });
              res.json(updated);
            }
          );
        }
      );
    }
  );
});

app.delete('/api/customers/:id', authMiddleware, requireRole(['owner', 'staff']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid customer id' });
  try {
    const row = await dbGet(`SELECT id FROM customers WHERE id = ?`, [id]);
    if (!row) return res.status(404).json({ error: 'Customer not found' });
    const invC = await dbGet(`SELECT COUNT(*) AS c FROM invoices WHERE customer_id = ?`, [id]);
    const memoC = await dbGet(`SELECT COUNT(*) AS c FROM memos WHERE customer_id = ?`, [id]);
    const nInv = Number(invC?.c || 0);
    const nMemo = Number(memoC?.c || 0);
    if (nInv > 0 || nMemo > 0) {
      return res.status(409).json({
        error:
          'Cannot delete this customer while they have invoices or memos on file. Reassign or remove those records first.',
      });
    }
    await dbRun(`DELETE FROM customers WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete customer';
    return res.status(400).json({ error: msg });
  }
});

// ===== Reports =====
function normalizeDateParam(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

app.get('/api/reports/summary', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const top = Number(req.query.top) || 5;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fromDefault = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = normalizeDateParam(req.query.from) || fromDefault;
  const to = normalizeDateParam(req.query.to) || today;

  const dateWhereSales = 'date(i.created_at) BETWEEN date(?) AND date(?)';
  const dateWhereInvoices = 'date(i.created_at) BETWEEN date(?) AND date(?)';
  const dateWhereMemos = 'date(m.memo_date) BETWEEN date(?) AND date(?)';

  const paymentsAgg = `(SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) ip`;

  const salesSql = `
    SELECT
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(i.total * ${SQL_THB_PER_INV}), 0) AS sales_total,
      IFNULL(SUM(IFNULL(ip.paid, 0) * ${SQL_THB_PER_INV}), 0) AS collected_total,
      IFNULL(SUM(MAX(0, i.total - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}), 0) AS outstanding_total,
      SUM(CASE WHEN i.status = 'Paid' THEN 1 ELSE 0 END) AS paid_invoices,
      SUM(CASE WHEN i.status = 'Partial' THEN 1 ELSE 0 END) AS partial_invoices,
      SUM(CASE WHEN i.status = 'Unpaid' THEN 1 ELSE 0 END) AS unpaid_invoices
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE ${dateWhereSales}
  `;

  const profitSql = `
    SELECT
      IFNULL(SUM(ii.line_total * ${SQL_THB_PER_INV}), 0) AS selling_total,
      IFNULL(SUM(ii.quantity * IFNULL(inv.purchasing_total_price, 0) * ${SQL_THB_PER_INV}), 0) AS cost_total,
      IFNULL(SUM((ii.line_total - (ii.quantity * IFNULL(inv.purchasing_total_price, 0))) * ${SQL_THB_PER_INV}), 0) AS profit_total,
      CASE
        WHEN IFNULL(SUM(ii.line_total * ${SQL_THB_PER_INV}), 0) > 0
        THEN ROUND(
          (SUM((ii.line_total - (ii.quantity * IFNULL(inv.purchasing_total_price, 0))) * ${SQL_THB_PER_INV}) * 100.0)
          / SUM(ii.line_total * ${SQL_THB_PER_INV}),
          2
        )
        ELSE 0
      END AS profit_margin_pct
    FROM invoices i
    JOIN invoice_items ii ON ii.invoice_id = i.id
    JOIN inventory_items inv ON inv.id = ii.inventory_item_id
    ${SQL_INV_FX_JOIN}
    WHERE ${dateWhereInvoices}
  `;

  const inventoryValueSql = `
    SELECT
      IFNULL(SUM(inv.pieces_remaining), 0) AS remaining_pcs,
      IFNULL(SUM(inv.pieces_remaining * IFNULL(inv.selling_total_price, 0) * ${SQL_THB_PER_INVITEM}), 0) AS inventory_value
    FROM inventory_items inv
    ${SQL_INVITEM_FX_JOIN}
  `;

  const inventoryByStatusSql = `
    SELECT
      inv.status AS status,
      IFNULL(SUM(inv.pieces_remaining), 0) AS pcs_remaining,
      IFNULL(SUM(inv.pieces_remaining * IFNULL(inv.selling_total_price, 0) * ${SQL_THB_PER_INVITEM}), 0) AS value
    FROM inventory_items inv
    ${SQL_INVITEM_FX_JOIN}
    GROUP BY inv.status
    ORDER BY value DESC
  `;

  const memosSql = `
    SELECT
      m.status,
      COUNT(*) AS memo_count,
      IFNULL(SUM(mi.quantity - mi.returned_qty), 0) AS remaining_qty,
      IFNULL(SUM((mi.quantity - mi.returned_qty) * mi.unit_price * ${SQL_THB_PER_MEMO}), 0) AS value
    FROM memos m
    ${SQL_MEMO_FX_JOIN}
    LEFT JOIN memo_items mi ON mi.memo_id = m.id
    WHERE ${dateWhereMemos}
    GROUP BY m.status
  `;

  const topCustomersSql = `
    SELECT
      c.id,
      c.name,
      c.phone,
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(i.total * ${SQL_THB_PER_INV}), 0) AS total_invoiced,
      IFNULL(SUM(IFNULL(ip.paid, 0) * ${SQL_THB_PER_INV}), 0) AS total_paid,
      IFNULL(SUM(MAX(0, i.total - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}), 0) AS total_owed,
      MAX(i.created_at) AS last_invoice_at
    FROM customers c
    JOIN invoices i ON i.customer_id = c.id
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE ${dateWhereInvoices}
    GROUP BY c.id
    ORDER BY total_owed DESC
    LIMIT ?
  `;

  const topItemsSql = `
    SELECT
      inv.id AS inventory_item_id,
      COALESCE(inv.item_code, inv.item_sticker) AS item_code,
      inv.category,
      inv.item_type,
      IFNULL(SUM(ii.quantity), 0) AS qty_sold,
      IFNULL(SUM(ii.line_total * ${SQL_THB_PER_INV}), 0) AS sales_value,
      IFNULL(SUM(ii.quantity * IFNULL(inv.purchasing_total_price, 0) * ${SQL_THB_PER_INV}), 0) AS cost_total,
      IFNULL(SUM((ii.line_total - (ii.quantity * IFNULL(inv.purchasing_total_price, 0))) * ${SQL_THB_PER_INV}), 0) AS profit_value
    FROM invoices i
    JOIN invoice_items ii ON ii.invoice_id = i.id
    JOIN inventory_items inv ON inv.id = ii.inventory_item_id
    ${SQL_INV_FX_JOIN}
    WHERE ${dateWhereInvoices}
    GROUP BY inv.id
    ORDER BY qty_sold DESC, sales_value DESC
    LIMIT ?
  `;

  const latestStockMovementsSql = `
    SELECT
      sm.id,
      sm.inventory_item_id,
      sm.type,
      sm.ref_type,
      sm.ref_id,
      sm.qty_change,
      sm.note,
      sm.created_at,
      u.username AS user_name
    FROM stock_movements sm
    LEFT JOIN users u ON u.id = sm.user_id
    ORDER BY sm.created_at DESC, sm.id DESC
    LIMIT 20
  `;

  const q = (sql, params) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });

  (async () => {
    try {
      // Sequential for SQLite safety.
      const salesRows = await q(salesSql, [from, to]);
      const profitRows = await q(profitSql, [from, to]);
      const invRows = await q(inventoryValueSql, []);
      const invByStatusRows = await q(inventoryByStatusSql, []);
      const memoRows = await q(memosSql, [from, to]);
      const topCustRows = await q(topCustomersSql, [from, to, top]);
      const topItemsRows = await q(topItemsSql, [from, to, top]);
      const latestRows = await q(latestStockMovementsSql, []);

      res.json({
        range: { from, to },
        sales: salesRows[0] || {
          invoices_count: 0,
          sales_total: 0,
          collected_total: 0,
          outstanding_total: 0,
          paid_invoices: 0,
          partial_invoices: 0,
          unpaid_invoices: 0,
        },
        profit: profitRows[0] || { selling_total: 0, cost_total: 0, profit_total: 0, profit_margin_pct: 0 },
        inventory: invRows[0] || { remaining_pcs: 0, inventory_value: 0 },
        inventory_by_status: invByStatusRows || [],
        memos_by_status: memoRows || [],
        top_customers: topCustRows || [],
        top_items: topItemsRows || [],
        latest_stock_movements: latestRows || [],
      });
    } catch (err) {
      console.error('Error generating reports summary', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  })();
});

app.get('/api/reports/sales-trend', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const group = String(req.query.group || 'daily');
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fromDefault = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = normalizeDateParam(req.query.from) || fromDefault;
  const to = normalizeDateParam(req.query.to) || today;

  const periodExpr = group === 'monthly' ? `strftime('%Y-%m', i.created_at)` : `date(i.created_at)`;
  const paymentsAgg = `(SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) ip`;

  const sql = `
    SELECT
      ${periodExpr} AS period,
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(i.total * ${SQL_THB_PER_INV}), 0) AS sales_total,
      IFNULL(SUM(IFNULL(ip.paid, 0) * ${SQL_THB_PER_INV}), 0) AS collected_total,
      IFNULL(SUM(MAX(0, i.total - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}), 0) AS outstanding_total
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE date(i.created_at) BETWEEN date(?) AND date(?)
    GROUP BY period
    ORDER BY period ASC
  `;

  db.all(sql, [from, to], (err, rows) => {
    if (err) {
      console.error('Error generating sales trend', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.json({ range: { from, to }, group, rows });
  });
});

app.get('/api/reports/profit-trend', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const group = String(req.query.group || 'daily');
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fromDefault = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = normalizeDateParam(req.query.from) || fromDefault;
  const to = normalizeDateParam(req.query.to) || today;

  const periodExpr = group === 'monthly' ? `strftime('%Y-%m', i.created_at)` : `date(i.created_at)`;

  const sql = `
    SELECT
      ${periodExpr} AS period,
      IFNULL(SUM(ii.line_total * ${SQL_THB_PER_INV}), 0) AS selling_total,
      IFNULL(SUM(ii.quantity * IFNULL(inv.purchasing_total_price, 0) * ${SQL_THB_PER_INV}), 0) AS cost_total,
      IFNULL(SUM((ii.line_total - (ii.quantity * IFNULL(inv.purchasing_total_price, 0))) * ${SQL_THB_PER_INV}), 0) AS profit_total
    FROM invoices i
    JOIN invoice_items ii ON ii.invoice_id = i.id
    JOIN inventory_items inv ON inv.id = ii.inventory_item_id
    ${SQL_INV_FX_JOIN}
    WHERE date(i.created_at) BETWEEN date(?) AND date(?)
    GROUP BY period
    ORDER BY period ASC
  `;

  db.all(sql, [from, to], (err, rows) => {
    if (err) {
      console.error('Error generating profit trend', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.json({ range: { from, to }, group, rows });
  });
});

// Dashboard overview (Collected + Outstanding + trends + latest stock movements)
app.get('/api/dashboard/overview', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const days = Math.max(2, Math.min(366, Number(req.query.days) || 7));

  const businessToday = businessTodayYmd();
  const trendToYmd = businessToday;
  const trendFromYmd = businessYmdAddCalendarDays(businessToday, -(days - 1));
  const trendFromBounds = businessZonedDayBoundsUtc(trendFromYmd);
  const trendToBounds = businessZonedDayBoundsUtc(trendToYmd);
  const trendFromSql = sqliteUtcFromMs(trendFromBounds.startMs);
  const trendToSql = sqliteUtcFromMs(trendToBounds.endMs);

  const todayBounds = businessZonedDayBoundsUtc(businessToday);
  const todayStartSql = sqliteUtcFromMs(todayBounds.startMs);
  const todayEndSql = sqliteUtcFromMs(todayBounds.endMs);

  const paymentsAgg = `(SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) ip`;

  const todaySalesSql = `
    SELECT
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(i.total * ${SQL_THB_PER_INV}), 0) AS sales_total,
      IFNULL(SUM(IFNULL(ip.paid, 0) * ${SQL_THB_PER_INV}), 0) AS collected_total,
      IFNULL(SUM(MAX(0, i.total - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}), 0) AS outstanding_total,
      SUM(CASE WHEN i.status = 'Paid' THEN 1 ELSE 0 END) AS paid_invoices,
      SUM(CASE WHEN i.status = 'Partial' THEN 1 ELSE 0 END) AS partial_invoices,
      SUM(CASE WHEN i.status = 'Unpaid' THEN 1 ELSE 0 END) AS unpaid_invoices
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE i.created_at >= ? AND i.created_at < ?
  `;

  const itemsSoldTodaySql = `
    SELECT IFNULL(SUM(ii.quantity), 0) AS items_sold
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.created_at >= ? AND i.created_at < ?
  `;

  const outstandingAllSql = `
    SELECT
      IFNULL(SUM(MAX(0, i.total - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}), 0) AS outstanding_total,
      COUNT(*) AS outstanding_invoice_count
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE (i.total - IFNULL(ip.paid, 0)) > 0.0001
  `;

  const openMemosSql = `
    SELECT COUNT(*) AS open_memos FROM memos m WHERE m.status != 'Closed'
  `;

  const memosDueSoonSql = `
    SELECT COUNT(*) AS due_soon
    FROM memos m
    WHERE m.status != 'Closed'
      AND m.due_date IS NOT NULL
      AND TRIM(m.due_date) != ''
      AND date(m.due_date) >= date(?)
      AND date(m.due_date) <= date(?, '+3 days')
  `;

  const trendsSalesSql = `
    SELECT
      date(i.created_at) AS period,
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(i.total * ${SQL_THB_PER_INV}), 0) AS sales_total,
      IFNULL(SUM(IFNULL(ip.paid, 0) * ${SQL_THB_PER_INV}), 0) AS collected_total,
      IFNULL(SUM(MAX(0, i.total - IFNULL(ip.paid, 0)) * ${SQL_THB_PER_INV}), 0) AS outstanding_total
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE i.created_at >= ? AND i.created_at < ?
    GROUP BY period
    ORDER BY period ASC
  `;

  const latestStockSql = `
    SELECT
      sm.id,
      sm.type,
      sm.qty_change,
      sm.note,
      sm.created_at,
      u.username AS user_name,
      inv.item_code AS item_code,
      inv.item_sticker AS item_sticker
    FROM stock_movements sm
    LEFT JOIN users u ON u.id = sm.user_id
    LEFT JOIN inventory_items inv ON inv.id = sm.inventory_item_id
    ORDER BY sm.created_at DESC, sm.id DESC
    LIMIT 8
  `;

  const q = (sql, params) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

  (async () => {
    try {
      const todayParams = [todayStartSql, todayEndSql];
      const todayRows = await q(todaySalesSql, todayParams);
      let todaySales = todayRows[0] || null;

      if (!todaySales) {
        todaySales = {
          invoices_count: 0,
          sales_total: 0,
          collected_total: 0,
          outstanding_total: 0,
          paid_invoices: 0,
          partial_invoices: 0,
          unpaid_invoices: 0,
        };
      }

      const itemsSoldRows = await q(itemsSoldTodaySql, todayParams);
      const items_sold_today = Number(itemsSoldRows?.[0]?.items_sold || 0);

      const outstandingRows = await q(outstandingAllSql, []);
      const outstanding_all = outstandingRows?.[0] || {
        outstanding_total: 0,
        outstanding_invoice_count: 0,
      };

      const openMemoRows = await q(openMemosSql, []);
      const memosDueRows = await q(memosDueSoonSql, [businessToday, businessToday]);

      const trendRows = await q(trendsSalesSql, [trendFromSql, trendToSql]);
      const latestRows = await q(latestStockSql, []);

      res.json({
        days,
        business_today: businessToday,
        business_tz: BUSINESS_TZ,
        today_sales_bounds: { start: todayStartSql, end: todayEndSql },
        trend_range_ymd: { from: trendFromYmd, to: trendToYmd },
        todaySales,
        items_sold_today,
        outstanding_all: {
          outstanding_total: Number(outstanding_all.outstanding_total || 0),
          invoice_count: Number(outstanding_all.outstanding_invoice_count || 0),
        },
        memos_summary: {
          open_count: Number(openMemoRows?.[0]?.open_memos || 0),
          due_within_3_days: Number(memosDueRows?.[0]?.due_soon || 0),
        },
        trends: {
          sales: trendRows,
        },
        latest_stock_movements: latestRows,
      });
    } catch (e) {
      console.error('Dashboard overview error', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  })();
});

// ----- Database backup (download: owner + staff; restore: owner only) -----
app.get('/api/backup/download', authMiddleware, requireRole(['owner', 'staff']), (req, res) => {
  const tmp = path.join(os.tmpdir(), `blue-cuts-backup-${Date.now()}.db`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fname = `blue-cuts-backup-${stamp}.db`;

  const sendFile = () => {
    res.download(tmp, fname, dlErr => {
      fs.unlink(tmp, () => {});
      if (dlErr) console.error('backup download', dlErr);
    });
  };

  vacuumIntoBackupFile(tmp)
    .then(sendFile)
    .catch(vacErr => {
      console.warn('VACUUM INTO backup; falling back to file copy', vacErr?.message || vacErr);
      copyFileBackup(tmp)
        .then(sendFile)
        .catch(e2 => {
          console.error('backup', e2);
          try {
            fs.unlinkSync(tmp);
          } catch (_) {
            // ignore
          }
          res.status(500).json({ error: 'Could not create database backup' });
        });
    });
});

app.post(
  '/api/backup/restore',
  authMiddleware,
  requireRole(['owner']),
  (req, res, next) => {
    restoreUpload.single('backup')(req, res, err => {
      if (err) {
        return res.status(400).json({ error: String(err.message || err) });
      }
      next();
    });
  },
  (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No backup file uploaded' });

    const uploadedPath = file.path;
    const staging = path.join(path.dirname(dbPath), `blue-cuts-restore-${Date.now()}.db`);

    validateSqliteUsersTable(uploadedPath).then(ok => {
      if (!ok) {
        fs.unlink(uploadedPath, () => {});
        return res.status(400).json({
          error: 'Invalid backup file. Use a .db export from this app (must contain a users table).',
        });
      }

      closeMainDatabase()
        .then(() => {
          removeSqliteSidecars(dbPath);
          fs.copyFileSync(uploadedPath, staging);
          try {
            fs.unlinkSync(dbPath);
          } catch (_) {
            // ignore if missing
          }
          fs.renameSync(staging, dbPath);
          openMainDatabase();
          fs.unlink(uploadedPath, () => {});
          return res.json({
            ok: true,
            message: 'Database restored. Refresh the browser; all users should sign in again if needed.',
          });
        })
        .catch(e => {
          console.error('restore', e);
          fs.unlink(uploadedPath, () => {});
          try {
            fs.unlinkSync(staging);
          } catch (_) {
            // ignore
          }
          try {
            openMainDatabase();
          } catch (_) {
            // ignore
          }
          res.status(500).json({
            error:
              'Restore failed. If the app no longer loads, restore the previous .db file manually and restart the server.',
          });
        });
    });
  }
);

const allowLanForMobileUpload = String(process.env.BLUECUTS_ALLOW_LAN || '').trim() === '1';
const listenHost = bluecutsUserData
  ? (allowLanForMobileUpload ? '0.0.0.0' : '127.0.0.1')
  : undefined;
if (listenHost) {
  app.listen(PORT, listenHost, () => {
    console.log(`Backend API running on http://${listenHost}:${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Backend API running on http://localhost:${PORT}`);
  });
}

