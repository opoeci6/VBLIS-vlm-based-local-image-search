import { useEffect, useRef } from 'react';

// Esc closes the view on top, and only that one. Views stack (Accounts over Settings, the lightbox over a video
// group, the Filters panel over the results console), and separate document listeners would all close at once.
// So every view registers here: one capture-phase listener on window calls the handler of the view that became
// active last, and stops the event so no other listener also acts on it. Works in Electron and in a browser.

const stack = []; // refs to the handlers of the active views, bottom to top
let listening = false;

const onKeyDown = (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  top.current?.();
};

/**
 * While `active`, Esc calls `onEscape` (the latest one) if this view is the top one. A view with inner steps
 * (a menu, a confirmation) decides in `onEscape` what Esc closes first.
 */
export function useEscapeKey(active, onEscape) {
  const handlerRef = useRef(onEscape);

  useEffect(() => {
    handlerRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return undefined;
    if (!listening) {
      window.addEventListener('keydown', onKeyDown, true);
      listening = true;
    }
    stack.push(handlerRef);
    return () => {
      const index = stack.lastIndexOf(handlerRef);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active]);
}

export function resetEscapeKeyForTests() {
  if (listening) window.removeEventListener('keydown', onKeyDown, true);
  listening = false;
  stack.length = 0;
}
