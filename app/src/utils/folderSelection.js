export const getAllSelectablePaths = (indexedFolders) => {
  return indexedFolders.flatMap(f => [f.path, ...(f.subfolders || []).map(s => s.path)]);
};

export const toggleFolderSelection = (prev, targetPath, isSubfolder = false, parentFolder = null) => {
  const childPaths = parentFolder?.descendantPaths || (parentFolder?.subfolders || []).map(s => s.path);

  if (!isSubfolder || (childPaths && childPaths.length > 0)) {
    const allTreePaths = [targetPath, ...(childPaths || [])];
    const isSelected = prev.includes(targetPath) || (childPaths.length > 0 && childPaths.every(s => prev.includes(s)));

    if (isSelected) {
      return prev.filter(p => !allTreePaths.includes(p));
    } else {
      const next = new Set([...prev, ...allTreePaths]);
      return Array.from(next);
    }
  }

  return prev.includes(targetPath)
    ? prev.filter(p => p !== targetPath)
    : [...prev, targetPath];
};
