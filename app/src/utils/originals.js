// URL of the original file on the network server (owner, or a viewer with the `originals` permission).
// The session cookie authenticates a link or a download, so no token goes in the URL.
export const getOriginalUrl = (apiBase, path, { download = false } = {}) => {
  const params = new URLSearchParams({ path });
  if (download) params.set('download', '1');
  return `${apiBase}/media/original?${params.toString()}`;
};

// Starts a player from inside the tap on "Play video". iOS plays a video with sound only when playback starts
// within the tap itself (the `autoPlay` attribute acts later), so the host mounts the player synchronously and
// calls this at once. A refusal leaves the player's own controls to start it.
export const startPlayback = (video) => {
  try {
    video?.play?.()?.catch?.(() => {});
  } catch { /* the controls still start it */ }
};

// Most browsers cannot show HEIC/HEIF, so those originals are only offered as a download.
export const isHeicPath = (path) => /\.(heic|heif)$/i.test(path || '');
