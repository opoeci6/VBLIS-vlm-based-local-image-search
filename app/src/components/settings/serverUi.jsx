// Small pieces the server and account sections of the settings share.

export const cardClass = 'p-3.5 bg-gray-50/80 dark:bg-neutral-950/40 border border-gray-200/80 dark:border-neutral-800 rounded-2xl space-y-2.5';
export const inputClass = 'w-full bg-white dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-700 rounded-xl py-2 px-3 text-base sm:text-sm outline-none transition-all focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 text-neutral-900 dark:text-white disabled:opacity-60';
export const primaryButton = 'inline-flex items-center justify-center gap-2 px-3.5 py-2 max-sm:min-h-10 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';
export const secondaryButton = 'inline-flex items-center justify-center px-3.5 py-2 max-sm:min-h-10 bg-gray-200 dark:bg-neutral-800 hover:bg-gray-300 dark:hover:bg-neutral-700 text-neutral-700 dark:text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';
export const dangerButton = 'inline-flex items-center justify-center gap-2 px-3.5 py-2 max-sm:min-h-10 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';
export const errorClass = 'text-xs font-medium text-rose-600 dark:text-rose-400';

export function Fact({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="font-semibold text-neutral-500 dark:text-neutral-400 flex-shrink-0">{label}</span>
      <span className="text-right font-mono text-neutral-700 dark:text-neutral-300 min-w-0 break-all">{children}</span>
    </div>
  );
}

// A labelled text field. `type` is "text" or "password"; the rest goes to the input.
export function Field({ id, label, type = 'text', value, onChange, hint, ...inputProps }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        {...inputProps}
      />
      {hint && <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">{hint}</p>}
    </div>
  );
}
