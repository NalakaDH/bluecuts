const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let _app = null;

const backendRoot = path.join(__dirname, '..', '..');

function parseServiceAccountFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || !String(raw).trim()) return null;
  try {
    const json = JSON.parse(String(raw));
    if (json && typeof json === 'object' && json.project_id && json.client_email && json.private_key) {
      return json;
    }
  } catch (_e) {
    // ignore
  }
  return null;
}

function expandWindowsEnvInPath(p) {
  return String(p).replace(/%([^%]+)%/gi, (_, name) => process.env[name] || '');
}

function resolveKeyFilePath(rawPath) {
  if (!rawPath || !String(rawPath).trim()) return null;
  let p = expandWindowsEnvInPath(String(rawPath).trim());
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1);
  }
  if (!path.isAbsolute(p)) {
    p = path.resolve(backendRoot, p);
  }
  return p;
}

function loadServiceAccountFromPath(p) {
  const abs = resolveKeyFilePath(p);
  if (!abs) return { sa: null, resolvedPath: null, error: null };
  if (!fs.existsSync(abs)) {
    return {
      sa: null,
      resolvedPath: abs,
      error: `Firebase key file not found: ${abs}`,
    };
  }
  try {
    const txt = fs.readFileSync(abs, 'utf8');
    const json = JSON.parse(txt);
    if (json && json.project_id && json.client_email && json.private_key) {
      return { sa: json, resolvedPath: abs, error: null };
    }
    return {
      sa: null,
      resolvedPath: abs,
      error: `Invalid service account JSON at ${abs} (need project_id, client_email, private_key).`,
    };
  } catch (e) {
    return {
      sa: null,
      resolvedPath: abs,
      error: `Could not read Firebase key file ${abs}: ${e instanceof Error ? e.message : e}`,
    };
  }
}

function candidateKeyPaths() {
  const paths = [];
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    paths.push(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    paths.push(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  const userData = process.env.BLUECUTS_USER_DATA && String(process.env.BLUECUTS_USER_DATA).trim();
  if (userData) {
    paths.push(path.join(userData, 'firebase-service-account.json'));
  }
  paths.push(path.join(backendRoot, 'keys', 'firebase-service-account.json'));
  return paths;
}

function loadServiceAccount() {
  const fromJson = parseServiceAccountFromEnv();
  if (fromJson) return { sa: fromJson, source: 'FIREBASE_SERVICE_ACCOUNT_JSON', error: null };

  const tried = [];
  const errors = [];
  for (const p of candidateKeyPaths()) {
    const { sa, resolvedPath, error } = loadServiceAccountFromPath(p);
    if (resolvedPath) tried.push(resolvedPath);
    if (sa) return { sa, source: resolvedPath, error: null };
    if (error) errors.push(error);
  }

  const hint = [
    'Firebase Admin credentials are not configured on this PC.',
    '',
    'Add ONE of the following (then restart Blue Cuts):',
    '1) File: %AppData%\\Blue Cuts\\firebase-service-account.json',
    '   (download from Firebase Console → Project settings → Service accounts → Generate new private key)',
    '2) backend/.env → FIREBASE_SERVICE_ACCOUNT_PATH=C:\\path\\to\\that-file.json',
    '3) backend/.env or %AppData%\\Blue Cuts\\cloud-sync.env → same path',
    '',
    'Also required in the same .env file:',
    '- BLUECUTS_SHOP_ID=your-shop-id',
    '- BLUECUTS_CLOUD_SYNC_SECRET=your-secret',
    '',
    tried.length ? `Paths checked:\n- ${tried.join('\n- ')}` : '',
    errors.length ? `\nErrors:\n- ${errors.join('\n- ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const err = new Error(hint);
  err.statusCode = 503;
  err.code = 'FIREBASE_CREDENTIALS_MISSING';
  throw err;
}

/**
 * Initialize Firebase Admin SDK once.
 */
function getFirebaseAdminApp() {
  if (_app) return _app;

  const { sa } = loadServiceAccount();
  _app = admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: sa.project_id,
  });

  return _app;
}

function getFirestore() {
  getFirebaseAdminApp();
  return admin.firestore();
}

/** For health/diagnostics without initializing Firestore. */
function getCloudSyncConfigStatus() {
  try {
    const { sa, source } = loadServiceAccount();
    return {
      ok: true,
      project_id: sa.project_id,
      client_email: sa.client_email,
      credential_source: source,
      shop_id: String(process.env.BLUECUTS_SHOP_ID || '').trim() || null,
      has_sync_secret: Boolean(String(process.env.BLUECUTS_CLOUD_SYNC_SECRET || '').trim()),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      shop_id: String(process.env.BLUECUTS_SHOP_ID || '').trim() || null,
      has_sync_secret: Boolean(String(process.env.BLUECUTS_CLOUD_SYNC_SECRET || '').trim()),
    };
  }
}

module.exports = {
  getFirebaseAdminApp,
  getFirestore,
  getCloudSyncConfigStatus,
  loadServiceAccount,
};
