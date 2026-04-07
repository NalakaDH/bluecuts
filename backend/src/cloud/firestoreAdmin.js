const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let _app = null;

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

function loadServiceAccountFromPath(p) {
  try {
    const abs = path.resolve(String(p));
    const txt = fs.readFileSync(abs, 'utf8');
    const json = JSON.parse(txt);
    if (json && typeof json === 'object') return json;
  } catch (_e) {
    // ignore
  }
  return null;
}

/**
 * Initialize Firebase Admin SDK once.
 *
 * Supported env:
 * - FIREBASE_SERVICE_ACCOUNT_JSON: JSON string (service account key)
 * - FIREBASE_SERVICE_ACCOUNT_PATH: path to JSON key file
 * - GOOGLE_APPLICATION_CREDENTIALS: path to JSON key file (standard)
 */
function getFirebaseAdminApp() {
  if (_app) return _app;

  const sa =
    parseServiceAccountFromEnv() ||
    (process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? loadServiceAccountFromPath(process.env.FIREBASE_SERVICE_ACCOUNT_PATH) : null) ||
    (process.env.GOOGLE_APPLICATION_CREDENTIALS ? loadServiceAccountFromPath(process.env.GOOGLE_APPLICATION_CREDENTIALS) : null);

  if (sa) {
    _app = admin.initializeApp({ credential: admin.credential.cert(sa) });
  } else {
    // Falls back to Application Default Credentials if present (rare on Windows shop machines).
    _app = admin.initializeApp();
  }

  return _app;
}

function getFirestore() {
  getFirebaseAdminApp();
  return admin.firestore();
}

module.exports = {
  getFirebaseAdminApp,
  getFirestore,
};

