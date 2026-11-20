import { forwardRef } from 'react';
import { API_BASE } from '../../config';
import { getOriginalUrl } from '../../utils/originals';

// Seconds as a media fragment: at most 3 decimals, no trailing zeros. Nothing for 0, a bad value or a negative one.
const startFragment = (start) => {
  const seconds = Math.round(Number(start) * 1000) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? `#t=${seconds}` : '';
};

// Plays the original video inside the page (the browser interface), so closing the player leaves the user where
// they were. The session cookie authenticates the request. `onFailed` runs when the browser cannot play the file.
export const OriginalVideoPlayer = forwardRef(function OriginalVideoPlayer({ path, start, poster, className, onFailed }, ref) {
  return (
    <video
      ref={ref}
      controls
      autoPlay
      playsInline
      preload="metadata"
      src={`${getOriginalUrl(API_BASE, path)}${startFragment(start)}`}
      poster={poster}
      className={className}
      onClick={(event) => event.stopPropagation()}
      onError={onFailed}
    />
  );
});
