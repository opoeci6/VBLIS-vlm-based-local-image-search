import { useEffect, useRef } from 'react';

// Calls `onOutside` for a press (mouse or touch) that starts outside `ref`'s element, while `active`.
// For the small popovers of the header: a tap on the trigger itself is inside, so its own click can toggle.
export function useOutsideClick(ref, active, onOutside) {
  const callbackRef = useRef(onOutside);

  useEffect(() => {
    callbackRef.current = onOutside;
  });

  useEffect(() => {
    if (!active) return undefined;
    const onPress = (event) => {
      if (!ref.current?.contains(event.target)) callbackRef.current?.();
    };
    document.addEventListener('mousedown', onPress);
    document.addEventListener('touchstart', onPress, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPress);
      document.removeEventListener('touchstart', onPress);
    };
  }, [active, ref]);
}
