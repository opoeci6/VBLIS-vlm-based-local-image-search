import { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..');

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
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

let win;
let pythonProcess;

// Shared secret between this app and its backend: the API is on localhost, so without it any
// website or local process could call it (read files, delete folders). Dev may reuse
// VBLIS_API_TOKEN so a plain browser tab on the Vite dev server can share it; packaged builds
// always use a fresh one.
const apiToken = (!app.isPackaged && process.env.VBLIS_API_TOKEN) || crypto.randomBytes(32).toString('hex');

// One instance only: a second one would start a second backend on the same data folder
const hasSingleInstanceLock = app.requestSingleInstanceLock();
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

function resolveDataDir() {
  if (process.env.VBLIS_DATA_DIR) return process.env.VBLIS_DATA_DIR;
  if (!app.isPackaged) return null;

  const exeDir = path.dirname(process.execPath);
  const isInstalled = fs.existsSync(path.join(exeDir, `Uninstall ${PRODUCT_NAME}.exe`));
  if (isInstalled) {
    const localAppData = process.env.LOCALAPPDATA || app.getPath('appData');
    const dataDir = path.join(localAppData, PRODUCT_NAME);
    // Installed straight into that folder: keep the data out of the directory updates replace
    return isSameOrInside(dataDir, exeDir) ? path.join(localAppData, `${PRODUCT_NAME}-data`) : dataDir;
  }
  return path.join(exeDir, `${PRODUCT_NAME}-data`);
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
    return net.fetch(pathToFileURL(filePath).toString());
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
    title: 'Image Search',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
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

app.whenReady().then(() => {
  // A second instance is quitting; don't let it start another backend
  if (!hasSingleInstanceLock) return;

  registerAppProtocol();
  startPythonBackend();
  createWindow();
  
  // IPC handlers
  // Since Electron 43 dialogs open in Downloads unless told otherwise: start where the last pick
  // was made (the folder containing it), else in Pictures
  let lastDialogDirectory = null;
  ipcMain.handle('dialog:openDirectory', async () => {
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

  ipcMain.handle('shell:openInExplorer', (event, filePath) => {
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return { success: true };
    } else {
      return { success: false, error: 'File no longer exists.' };
    }
  });

  ipcMain.handle('fs:isDirectory', (event, filePath) => {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
    } catch {
      return false;
    }
  });

  // Window Controls
  ipcMain.on('window:minimize', () => {
    win.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    win.close();
  });
});
