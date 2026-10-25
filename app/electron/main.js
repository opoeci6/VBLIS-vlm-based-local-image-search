import { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..');

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
// Packaged builds ignore it: the window trusts that page and hands it the API token
export const VITE_DEV_SERVER_URL = app.isPackaged ? undefined : process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

// The built renderer is served from app://vblis instead of file://. It gets a real origin, which
// the backend's CORS rule names (api/security.py), and file:// pages lose the extra file access
// Electron gives them by default (grantFileProtocolExtraPrivileges fuse, package.json).
const APP_SCHEME = 'app';
const APP_HOST = 'vblis';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// Must be called before the app is ready. "standard" parses app:// URLs like http (an origin,
// relative URLs, localStorage); "secure" makes it a secure context, like https.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// The backend (api/main.py, app/src/config.js)
const API_HOST = '127.0.0.1';
const API_PORT = 8000;
const API_ORIGIN = `http://${API_HOST}:${API_PORT}`;

// Sent with every app:// response. Dev doesn't get it: the Vite dev server needs inline scripts
// and eval. Thumbnails and API calls go to the local backend only.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  `img-src 'self' data: blob: ${API_ORIGIN}`,
  `connect-src ${API_ORIGIN}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Parsed once, so a malformed dev URL fails at startup instead of inside a navigation check
const DEV_SERVER_ORIGIN = VITE_DEV_SERVER_URL ? new URL(VITE_DEV_SERVER_URL).origin : null;

// Our own pages: app://vblis in builds, the Vite dev server in dev. Node's URL gives custom
// schemes an opaque origin ("null"), so app:// is matched by protocol and host, and an opaque
// origin never matches the dev server.
function isTrustedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (DEV_SERVER_ORIGIN) return parsed.origin !== 'null' && parsed.origin === DEV_SERVER_ORIGIN;
  return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
}

// The preload hands the API token to whatever page runs in the window, so the window only ever
// shows our own pages: no popups, no navigating elsewhere (a link, a redirect, a dropped file),
// no <webview>.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const blockForeignNavigation = (event) => {
    if (isTrustedUrl(event.url)) return;
    event.preventDefault();
    console.warn(`[Security] Blocked navigation to ${event.url}`);
  };
  contents.on('will-navigate', blockForeignNavigation);
  contents.on('will-redirect', blockForeignNavigation);
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

let win;
let pythonProcess;

// Shared secret between this app and its backend: the API is on localhost, so without it any
// website or local process could call it (read files, delete folders). Dev may reuse
// VBLIS_API_TOKEN so a plain browser tab on the Vite dev server can share it; packaged builds
// always use a fresh one.
const apiToken = (!app.isPackaged && process.env.VBLIS_API_TOKEN) || crypto.randomBytes(32).toString('hex');

// Folder where the backend keeps models, the index and caches (VBLIS_DATA_DIR, see api/paths.py).
// Dev leaves it unset so the backend keeps using api/. Installed builds (NSIS puts an uninstaller
// next to the exe) use a per-user folder outside the install directory that updates replace;
// the portable build keeps its data in a folder beside the exe so it stays self-contained.
// Must match "build.productName" in package.json, which names the exe and the NSIS uninstaller.
// app.getName() can't be used: Electron only reads a top-level productName, so it returns "app".
const PRODUCT_NAME = 'VBLIS';

function isSameOrInside(child, parent) {
  const relative = path.relative(parent, child);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isInstalledBuild() {
  return fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${PRODUCT_NAME}.exe`));
}

function resolveDataDir() {
  if (process.env.VBLIS_DATA_DIR) return process.env.VBLIS_DATA_DIR;
  if (!app.isPackaged) return null;

  const exeDir = path.dirname(process.execPath);
  if (isInstalledBuild()) {
    const localAppData = process.env.LOCALAPPDATA || app.getPath('appData');
    const dataDir = path.join(localAppData, PRODUCT_NAME);
    // Installed straight into that folder: keep the data out of the directory updates replace
    return isSameOrInside(dataDir, exeDir) ? path.join(localAppData, `${PRODUCT_NAME}-data`) : dataDir;
  }
  return path.join(exeDir, `${PRODUCT_NAME}-data`);
}

// Electron's own profile (userData: Chromium storage such as localStorage, and the
// single-instance lock). With package.json's name "app" it was %APPDATA%\app, shared by dev and
// every build; that folder is left alone, since another app may use the name. Dev and installed
// builds now get their own folder in %APPDATA%, the portable build keeps it with its data.
function resolveUserDataDir() {
  const appData = app.getPath('appData');
  if (!app.isPackaged) return path.join(appData, `${PRODUCT_NAME}-dev`);
  if (isInstalledBuild()) return path.join(appData, PRODUCT_NAME);
  return path.join(path.dirname(process.execPath), `${PRODUCT_NAME}-data`, 'electron');
}

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Per process, so two instances started at once don't delete each other's probe
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

// A portable copy unzipped where the user can't write (Program Files) can't keep its profile or
// data there: say so, instead of quitting silently when the profile lock fails
const userDataDir = resolveUserDataDir();
const canWriteUserData = isWritableDir(userDataDir);
if (canWriteUserData) {
  app.setPath('userData', userDataDir);
} else {
  // Chromium still writes some caches while quitting; keep them out of the old %APPDATA%\app
  app.setPath('userData', path.join(app.getPath('temp'), `${PRODUCT_NAME}-startup-error`));
  dialog.showErrorBox(
    `${PRODUCT_NAME} can't start`,
    `${PRODUCT_NAME} keeps its data in\n${userDataDir}\nbut can't write there.\n\n` +
      'If this is the portable version, move its folder somewhere you can write to (not Program Files), or use the installer.'
  );
}

// One instance per profile: a second one would start a second backend on the same data folder.
// Requested after userData is set, because the lock lives there.
const hasSingleInstanceLock = canWriteUserData && app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// The lock is per profile, so dev, portable and installed copies can run side by side, but each
// starts a backend on the same port. Wait a moment for the port (the backend of a window that was
// just closed takes a moment to exit) before refusing to start.
function isPortFree(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function waitForPortFree(port, host, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await isPortFree(port, host))) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return true;
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });

// Serves app://vblis/<path> from RENDERER_DIST and nothing outside it
function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== APP_HOST) return notFound();
    let filePath;
    try {
      filePath = path.resolve(RENDERER_DIST, `.${decodeURIComponent(pathname)}`);
    } catch {
      return notFound(); // malformed %-escape
    }
    if (filePath.includes('\0') || !isSameOrInside(filePath, RENDERER_DIST)) return notFound();
    try {
      if (!(await fs.promises.stat(filePath)).isFile()) return notFound();
    } catch {
      return notFound();
    }
    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
}

// Electron grants every permission request by default. The app needs none (camera, notifications,
// clipboard, devices...), so all are denied.
function denyAllPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    console.warn(`[Security] Denied permission "${permission}" for ${details.requestingUrl}`);
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
}

// IPC is only for our own page (isTrustedUrl), not for anything else that ends up in the window
function isTrustedSender(event) {
  return !!event.senderFrame && isTrustedUrl(event.senderFrame.url);
}

function handleTrusted(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error(`Blocked IPC "${channel}" from an untrusted page`);
    return handler(event, ...args);
  });
}

function onTrusted(channel, listener) {
  ipcMain.on(channel, (event, ...args) => {
    if (isTrustedSender(event)) listener(event, ...args);
  });
}

function startPythonBackend() {
  const isProd = app.isPackaged;
  // If packaged, the python exe is alongside the app or in Resources
  // For dev, it's in d:\1\api\.venv\Scripts\python.exe
  const pythonPath = isProd 
    ? path.join(process.resourcesPath, 'api', 'api.exe')
    : path.join(__dirname, '../../api/.venv/Scripts/python.exe');
    
  // Since FastAPI is going to be run by main.py
  const scriptPath = isProd
    ? '' // if compiled to exe it doesn't need script
    : path.join(__dirname, '../../api/main.py');

  const args = isProd ? [] : [scriptPath];
  const cwd = path.dirname(pythonPath);
  const dataDir = resolveDataDir();
  // VBLIS_EXIT_WITH_PARENT: the backend exits when its stdin pipe closes, which happens even if
  // this process crashes. Otherwise it would keep port 8000 with a token no new window knows.
  const env = { ...process.env, VBLIS_API_TOKEN: apiToken, VBLIS_EXIT_WITH_PARENT: '1' };
  if (dataDir) env.VBLIS_DATA_DIR = dataDir;

  console.log('Starting Python backend...', pythonPath, args, 'cwd:', cwd, 'data:', dataDir || '(api folder)');
  pythonProcess = spawn(pythonPath, args, {
    cwd: cwd,
    env: env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  pythonProcess.stdout?.on('data', (data) => {
    console.log(`[Python backend]: ${data}`);
  });

  pythonProcess.stderr?.on('data', (data) => {
    console.error(`[Python backend error]: ${data}`);
  });

  pythonProcess.on('error', (err) => {
    console.error('Failed to start python process:', err);
  });

  pythonProcess.on('exit', (code, signal) => {
    console.log(`Python process exited with code ${code}, signal ${signal}`);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: PRODUCT_NAME,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron's defaults, set explicitly
      sandbox: true,
      webSecurity: true,
      additionalArguments: [`--vblis-api-token=${apiToken}`],
    },
  });

  win.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    // win.webContents.openDevTools();
  } else {
    win.loadURL(`${APP_ORIGIN}/index.html`);
  }
}

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(async () => {
  // Quitting (a second instance, or the profile folder can't be written): no backend, no window
  if (!hasSingleInstanceLock) return;

  if (!(await waitForPortFree(API_PORT, API_HOST))) {
    dialog.showErrorBox(
      `${PRODUCT_NAME} is already running`,
      `Port ${API_PORT} is in use, so ${PRODUCT_NAME} can't start its search service.\n\n` +
        `Another copy of ${PRODUCT_NAME} (installed, portable or dev) is probably open: close it and start ${PRODUCT_NAME} again. ` +
        `If none is open, another program is using port ${API_PORT}.`
    );
    app.quit();
    return;
  }

  registerAppProtocol();
  denyAllPermissions();
  startPythonBackend();
  createWindow();
  
  // IPC handlers: only our own page may call them (handleTrusted/onTrusted)
  // Since Electron 43 dialogs open in Downloads unless told otherwise: start where the last pick
  // was made (the folder containing it), else in Pictures
  let lastDialogDirectory = null;
  handleTrusted('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      defaultPath: lastDialogDirectory || app.getPath('pictures'),
      properties: ['openDirectory', 'multiSelections']
    });
    if (canceled) {
      return null;
    } else {
      lastDialogDirectory = path.dirname(filePaths[0]);
      return filePaths;
    }
  });

  handleTrusted('shell:openInExplorer', (event, filePath) => {
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return { success: true };
    } else {
      return { success: false, error: 'File no longer exists.' };
    }
  });

  handleTrusted('fs:isDirectory', (event, filePath) => {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
    } catch {
      return false;
    }
  });

  // Window Controls
  onTrusted('window:minimize', () => {
    win.minimize();
  });

  onTrusted('window:maximize', () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  onTrusted('window:close', () => {
    win.close();
  });
});
