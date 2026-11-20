import { useEffect, useRef } from 'react';
import { IS_NETWORK } from '../config';

// On a phone the Back button is the natural way out of a full-screen view. In a browser tab served by the
// network server, every open view (lightbox, results, a modal) owns one browser history entry, so Back closes
// the top view instead of leaving the page. Electron and tests do nothing: no history calls at all.
//
// One stack is shared by all views. `entries` lists the open views bottom to top; `historyDepth` is how many
// history entries of ours sit above the base one. Each carries `history.state.vblisBack = level` (1-based).
// All history changes go through reconcile(), which compares the two and pushes or goes back once, so views
// that open or close in the same commit (React StrictMode included) cause one history action, not several.

let entries = []; // { close, removed, dead }: removed = Back already took it off; dead = closed from the screen under a live view
let historyDepth = 0;
let traversalPending = false; // a history.go() of ours has not reported back through popstate yet
let listening = false;
let reconcileQueued = false;

const stateObject = () => {
  const state = window.history.state;
  return state && typeof state === 'object' ? state : {};
};

const pushLevel = (level) => {
  window.history.pushState({ ...stateObject(), vblisBack: level }, '');
};

const reconcile = () => {
  if (traversalPending) return; // runs again from the popstate handler
  while (entries.length > 0 && entries[entries.length - 1].dead) entries.pop();
  const desired = entries.length;
  if (desired > historyDepth) {
    for (let level = historyDepth + 1; level <= desired; level += 1) pushLevel(level);
    historyDepth = desired;
  } else if (desired < historyDepth) {
    traversalPending = true;
    window.history.go(desired - historyDepth);
  }
};

const scheduleReconcile = () => {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(() => {
    reconcileQueued = false;
    reconcile();
  });
};

const onPopState = (event) => {
  const own = traversalPending;
  traversalPending = false;
  const level = event.state?.vblisBack;
  const newDepth = Number.isInteger(level) && level >= 0 ? level : 0;
  historyDepth = newDepth;
  // The user went Back (or Forward into a stale entry): every view above the new level is closed, top first.
  // After a traversal of ours the views above were removed already, and a view opened since stays.
  if (!own) {
    while (entries.length > newDepth) {
      const entry = entries.pop();
      entry.removed = true;
      if (!entry.dead) entry.close();
    }
  }
  reconcile();
};

const install = () => {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', onPopState);
  // A reload keeps the history state: nothing is open after one, so the entry must not claim a level.
  const level = window.history.state?.vblisBack;
  if (typeof level === 'number' && level > 0) {
    window.history.replaceState({ ...stateObject(), vblisBack: 0 }, '');
  }
};

/**
 * Makes the browser's Back button close a view. `open` says whether the view is showing; `onClose` closes it
 * (the latest one is used). Only active in network mode.
 */
export function useBackToClose(open, onClose) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open || !IS_NETWORK) return undefined;
    install();
    const entry = { close: () => onCloseRef.current?.(), removed: false, dead: false };
    entries.push(entry);
    scheduleReconcile();
    return () => {
      // Closed from the screen or unmounted. Back already took the entry off when it closed the view.
      if (!entry.removed) {
        if (entries[entries.length - 1] === entry) entries.pop();
        else entry.dead = true; // a view above it is still open: its history step goes when that one closes
      }
      scheduleReconcile();
    };
  }, [open]);
}

export function resetBackToCloseForTests() {
  if (listening) window.removeEventListener('popstate', onPopState);
  listening = false;
  entries = [];
  historyDepth = 0;
  traversalPending = false;
  reconcileQueued = false;
}
