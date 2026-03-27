/**
 * Rebuild backend native modules (sqlite3, bcrypt) for the Electron version
 * declared in the root package.json. Stop the API server first (port 4000) so
 * sqlite3's .node file is not locked on Windows.
 */
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const backend = path.join(root, 'backend');
const electronVer = require(path.join(root, 'node_modules', 'electron', 'package.json'))
  .version;

const cmd = `npx electron-rebuild -f -w sqlite3,bcrypt --version=${electronVer}`;
execSync(cmd, { cwd: backend, stdio: 'inherit', env: process.env, shell: true });
