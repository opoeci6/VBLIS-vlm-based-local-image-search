// URL of the original file on the network server (owner, or a viewer with the `originals` permission).
// The session cookie authenticates a link or a download, so no token goes in the URL.
export const getOriginalUrl = (apiBase, path, { download = false } = {}) => {
  const params = new URLSearchParams({ path });
  if (download) params.set('download', '1');
  return `${apiBase}/media/original?${params.toString()}`;
};

// Most browsers cannot show HEIC/HEIF, so those originals are only offered as a download.
export const isHeicPath = (path) => /\.(heic|heif)$/i.test(path || '');
