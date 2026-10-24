import { ipcRenderer, contextBridge, webUtils } from 'electron';

// Passed by main.js through webPreferences.additionalArguments
const TOKEN_ARG = '--vblis-api-token=';
const apiToken = process.argv.find((arg) => arg.startsWith(TOKEN_ARG))?.slice(TOKEN_ARG.length) ?? '';

contextBridge.exposeInMainWorld('electronAPI', {
  apiToken,
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openInExplorer: (filePath) => ipcRenderer.invoke('shell:openInExplorer', filePath),
  isDirectory: (filePath) => ipcRenderer.invoke('fs:isDirectory', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
});
