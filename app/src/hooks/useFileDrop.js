import { useState } from 'react';
import { getPathForFile, isDirectory } from '../utils/electron';
import { useSession } from '../session/sessionContext';
import { readOnlyMessage } from '../utils/replica';
import i18n from '../i18n';

// `readOnly`: the library is a read-only copy, so a dropped folder is not queued for indexing; images still search.
// `onBrowserFolders(names)`: in a browser, an owner dropped something that isn't an image (a folder, as far as the
// page can tell). A browser hands over no location, so the folder picker opens instead; names may be empty.
export const useFileDrop = ({ enabled, setToast, onFolders, onImage, readOnly = false, onBrowserFolders }) => {
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

  const showFolderPicker = (names) => {
    if (onBrowserFolders) onBrowserFolders(names);
    else setToast({ message: i18n.t('session:fileDrop.useAddFolders'), type: 'info' });
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files || []);
    if (inBrowser && !canSearchByImage) return;

    // An owner adding folders through the browser: Safari can hand over a dropped folder as an empty file list
    const ownerAddsFolders = inBrowser && isOwner && !readOnly;
    if (files.length === 0) {
      if (ownerAddsFolders && Array.from(e.dataTransfer.types || []).includes('Files')) {
        if (enabled) showFolderPicker([]);
        else setToast({ message: i18n.t('messages:fileDrop.noModel'), type: 'error' });
      }
      return;
    }

    if (!enabled) {
      setToast({ message: i18n.t('messages:fileDrop.noModel'), type: 'error' });
      return;
    }

    // Separate paths into folders and images
    const folderPaths = [];
    const imageFiles = [];
    const otherNames = [];

    for (const file of files) {
      // An image is searched with as it is: its path is not needed, and a browser has none.
      if ((file.type || '').startsWith('image/')) {
        imageFiles.push(file);
        continue;
      }
      if (inBrowser) {
        // A browser hands over no path, so a dropped folder cannot be told from any other file.
        otherNames.push(file.name || '');
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
      // The owner is taken to where folders are added; a viewer cannot add any, and a read-only copy takes none.
      if (ownerAddsFolders && otherNames.length > 0) showFolderPicker(otherNames.filter(Boolean));
    } else {
      setToast({ message: i18n.t('messages:fileDrop.dropFolderOrImage'), type: 'error' });
    }
  };

  return { isDragging, handleDragOver, handleDragLeave, handleDrop };
};
