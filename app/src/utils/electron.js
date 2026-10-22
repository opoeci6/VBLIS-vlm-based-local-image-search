export const getPathForFile = (file) => (
  window.electronAPI?.getPathForFile ? window.electronAPI.getPathForFile(file) : file.path
);

export const isDirectory = async (path) => (
  window.electronAPI?.isDirectory ? window.electronAPI.isDirectory(path) : false
);
