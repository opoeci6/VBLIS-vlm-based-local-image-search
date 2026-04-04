import { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, Menu } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..');

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

let win;
let pythonProcess;

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
  
  console.log('Starting Python backend...', pythonPath, args);
  pythonProcess = spawn(pythonPath, args, { stdio: 'inherit' });
  
  pythonProcess.on('error', (err) => {
    console.error('Failed to start python process:', err);
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
    },
  });

  win.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    // win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
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

import { pathToFileURL } from 'node:url';

app.whenReady().then(() => {
  protocol.registerFileProtocol('local', (request, callback) => {
    // request.url is "local://C:/Users..." or "local://d:/..."
    const filePath = decodeURIComponent(request.url.replace('local://', ''));
    callback({ path: path.normalize(filePath) });
  });

  startPythonBackend();
  createWindow();
  
  // IPC handlers
  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'multiSelections']
    });
    if (canceled) {
      return null;
    } else {
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
    } catch (e) {
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
