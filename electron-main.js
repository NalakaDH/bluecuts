const { app, BrowserWindow, dialog, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

const isDev = process.env.NODE_ENV === 'development';

/** Dev: repo root. Packaged: backend is copied to resources/backend (see package.json extraResources). */
function getBackendRoot() {
  if (isDev) return path.join(__dirname, 'backend');
  return path.join(process.resourcesPath, 'backend');
}

function parseDotenvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function postCloudSyncToLocalApi() {
  const envPath = path.join(getBackendRoot(), '.env');
  const env = parseDotenvFile(envPath);
  const secret = String(
    env.BLUECUTS_CLOUD_SYNC_SECRET || process.env.BLUECUTS_CLOUD_SYNC_SECRET || ''
  ).trim();
  if (!secret) {
    dialog.showErrorBox(
      'Cloud sync',
      'BLUECUTS_CLOUD_SYNC_SECRET is not set. Add it to backend/.env (see .env.example), then restart the app.'
    );
    return;
  }
  const port = Number(process.env.PORT || 4000);
  const now = new Date();
  const body = JSON.stringify({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const req = http.request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/cloud/sync',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-bluecuts-sync-secret': secret,
      },
    },
    res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          dialog.showMessageBox({
            type: 'info',
            title: 'Cloud sync',
            message: 'Firestore snapshot updated.',
            detail: data.slice(0, 2000),
          });
        } else {
          dialog.showErrorBox(
            'Cloud sync failed',
            `HTTP ${res.statusCode}\n${data.slice(0, 1500)}`
          );
        }
      });
    }
  );
  req.on('error', err => {
    dialog.showErrorBox(
      'Cloud sync',
      `Could not reach the local API (http://127.0.0.1:${port}). Start Blue Cuts or run the backend.\n\n${err.message}`
    );
  });
  req.write(body);
  req.end();
}

function buildApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Sync cloud dashboard (Firebase)…',
          click: () => postCloudSyncToLocalApi(),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function waitForBackend(maxMs = 45000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOnce = () => {
      const req = http.get('http://127.0.0.1:4000/health', res => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', () => retry());
      function retry() {
        if (Date.now() - start > maxMs) {
          reject(new Error('The local API did not start in time.'));
          return;
        }
        setTimeout(tryOnce, 250);
      }
    };
    tryOnce();
  });
}

function startEmbeddedBackend() {
  process.env.BLUECUTS_USER_DATA = app.getPath('userData');
  process.env.BLUECUTS_ALLOW_LAN = '1';
  if (!process.env.PORT) process.env.PORT = '4000';
  // Loaded in the main process so the client does not need a separate Node install.
  // Packaged backend (with node_modules) must live outside app.asar so require('express') etc. resolve.
  const serverEntry = path.join(getBackendRoot(), 'src', 'server.js');
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(serverEntry);
}

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
    },
    title: 'Blue Cuts',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL || 'http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'build', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      Menu.setApplicationMenu(buildApplicationMenu());
      if (!isDev) {
        startEmbeddedBackend();
        await waitForBackend();
      }
      createWindow();
    } catch (err) {
      console.error(err);
      dialog.showErrorBox('Blue Cuts', String(err.message || err));
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
