import { useId } from 'react';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { cn } from '../../utils/cn';

// The frame the two sharing pop-ups share: a dimmed overlay, a panel that scrolls when the window is short,
// a title and a row of buttons. Esc and a click on the backdrop both call `onCancel`. It is mounted only while
// it is open. `!m-0`: the Sharing section's `space-y-*` would give this fixed overlay a top margin.
export function SharingDialog({ uiTheme, title, icon, onCancel, children, buttons }) {
  const titleId = useId();
  const backdropDismiss = useBackdropDismiss(onCancel);
  useEscapeKey(true, onCancel);
  const isModern = uiTheme !== 'terminal';

  return (
    <div
      className="app-overlay fixed inset-0 !m-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      {...backdropDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'w-full max-w-md max-h-[calc(100dvh-4rem)] overflow-y-auto p-6 rounded-3xl shadow-2xl border animate-in zoom-in-95 duration-150',
          isModern
            ? 'bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-800 text-neutral-900 dark:text-white'
            : 'bg-black border-2 border-white text-white'
        )}
      >
        <div className="flex items-center gap-2.5 mb-3">
          {icon}
          <h3 id={titleId} className="text-sm font-bold">{title}</h3>
        </div>
        <div className="space-y-3 mb-5 text-xs text-neutral-600 dark:text-neutral-400">{children}</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">{buttons}</div>
      </div>
    </div>
  );
}

// A round icon tile for the title; `tone` is 'info' or 'danger'.
export function DialogIcon({ tone, children }) {
  return (
    <div
      className={cn(
        'p-2 rounded-xl border flex-shrink-0',
        tone === 'danger'
          ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/30'
          : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30'
      )}
    >
      {children}
    </div>
  );
}
