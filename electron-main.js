const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

const isDev = process.env.NODE_ENV === 'development';

/** Dev: repo root. Packaged: backend is copied to resources/backend (see package.json extraResources). */
function getBackendRoot() {
  if (isDev) return path.join(__dirname, 'backend');
  return path.join(process.resourcesPath, 'backend');
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
