import { useState } from 'react';
import { getPathForFile, isDirectory } from '../utils/electron';

export const useFileDrop = ({ enabled, setToast, onFolders, onImage }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only show the overlay if we are dragging actual files (from the OS)
    if (enabled && e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (!files || files.length === 0) return;

    if (!enabled) {
      setToast({ message: "Please select or download a model first.", type: 'error' });
      return;
    }

    // Separate paths into folders and images
    const folderPaths = [];
    const imageFiles = [];

    for (const file of files) {
      // In modern Electron, we use getPathForFile to get the absolute path
      const filePath = getPathForFile(file);
      if (!filePath) continue;

      const isDir = await isDirectory(filePath);
      if (isDir) {
        folderPaths.push(filePath);
      } else if (file.type.startsWith('image/')) {
        imageFiles.push(file);
      }
    }

    if (folderPaths.length > 0) {
      await onFolders(folderPaths);
    } else if (imageFiles.length > 0) {
      onImage(imageFiles[0]);
    } else {
      setToast({ message: "Please drop a folder or an image file.", type: 'error' });
    }
  };

  return { isDragging, handleDragOver, handleDragLeave, handleDrop };
};
