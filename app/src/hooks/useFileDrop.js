import { useState } from 'react';
import { getPathForFile, isDirectory } from '../utils/electron';
import { useSession } from '../session/sessionContext';
import { readOnlyMessage } from '../utils/replica';
import i18n from '../i18n';

// `readOnly`: the library is a read-only copy, so a dropped folder is not queued for indexing; images still search.
export const useFileDrop = ({ enabled, setToast, onFolders, onImage, readOnly = false }) => {
  const [isDragging, setIsDragging] = useState(false);
  const { mode, isOwner, may } = useSession();
  // A drop is for searching by image or (desktop only) for adding folders. Without the image-search
  // permission a signed-in viewer has nothing to drop.
  const canSearchByImage = may('image_search');
  const inBrowser = mode === 'network';

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only show the overlay if we are dragging actual files (from the OS)
    if (enabled && canSearchByImage && e.dataTransfer.types.includes('Files')) {
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

    if (inBrowser && !canSearchByImage) return;

    if (!enabled) {
      setToast({ message: i18n.t('messages:fileDrop.noModel'), type: 'error' });
      return;
    }

    // Separate paths into folders and images
    const folderPaths = [];
    const imageFiles = [];
    let otherEntries = 0;

    for (const file of files) {
      // An image is searched with as it is: its path is not needed, and a browser has none.
      if (file.type.startsWith('image/')) {
        imageFiles.push(file);
        continue;
      }
      if (inBrowser) {
        // A browser hands over no path, so a dropped folder cannot be told from any other file.
        otherEntries += 1;
        continue;
      }
      // In modern Electron, we use getPathForFile to get the absolute path
      const filePath = getPathForFile(file);
      if (!filePath) continue;

      if (await isDirectory(filePath)) folderPaths.push(filePath);
    }

    if (folderPaths.length > 0 && !readOnly) {
      await onFolders(folderPaths);
    } else if (imageFiles.length > 0) {
      onImage(imageFiles[0]);
    } else if (folderPaths.length > 0) {
      setToast({ message: readOnlyMessage(), type: 'info' });
    } else if (inBrowser) {
      // The owner is told where folders are added; a viewer cannot add any, and a read-only copy takes none.
      if (isOwner && !readOnly && otherEntries > 0) {
        setToast({ message: i18n.t('session:fileDrop.useAddFolders'), type: 'info' });
      }
    } else {
      setToast({ message: i18n.t('messages:fileDrop.dropFolderOrImage'), type: 'error' });
    }
  };

  return { isDragging, handleDragOver, handleDragLeave, handleDrop };
};
