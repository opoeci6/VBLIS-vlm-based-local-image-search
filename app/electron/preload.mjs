import { ipcRenderer, contextBridge, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openInExplorer: (filePath) => ipcRenderer.invoke('shell:openInExplorer', filePath),
  isDirectory: (filePath) => ipcRenderer.invoke('fs:isDirectory', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
});
