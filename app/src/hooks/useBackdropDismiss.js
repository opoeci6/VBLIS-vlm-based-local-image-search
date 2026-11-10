import { useCallback, useEffect, useMemo, useRef } from 'react';

// True while a non-collapsed text selection starts or ends inside `element`.
const hasSelectionInside = (element) => {
  const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (!selection || selection.isCollapsed) return false;
  return element.contains(selection.anchorNode) || element.contains(selection.focusNode);
};

const NO_PRESS = null;

/**
 * Dismiss handlers for an overlay backdrop, to spread on the backdrop element in place of onClick.
 *
 * A plain onClick closes the overlay when the user drags a text selection from inside the panel and
 * releases over the backdrop: the browser fires click on the common ancestor of the press and
 * release targets, which is the backdrop. So a click only dismisses when it hit the backdrop itself,
 * the press began on the backdrop too (or no press was seen: keyboard or synthetic click), and the
 * overlay holds no live text selection.
 */
export function useBackdropDismiss(onDismiss) {
  const pressedOnBackdropRef = useRef(NO_PRESS);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  const onMouseDown = useCallback((event) => {
    pressedOnBackdropRef.current = event.target === event.currentTarget;
  }, []);

  const onClick = useCallback((event) => {
    const pressedOnBackdrop = pressedOnBackdropRef.current;
    pressedOnBackdropRef.current = NO_PRESS;

    if (event.target !== event.currentTarget) return;
    if (pressedOnBackdrop === false) return;
    if (hasSelectionInside(event.currentTarget)) return;
    onDismissRef.current?.();
  }, []);

  return useMemo(() => ({ onMouseDown, onClick }), [onMouseDown, onClick]);
}
