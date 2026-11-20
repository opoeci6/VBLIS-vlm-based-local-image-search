import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';

// The bare on/off button. `label` is its accessible name; `busy` marks a change that is being saved.
export function Switch({ checked, disabled, busy, onChange, label, title, uiTheme }) {
  const common = {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': label,
    'aria-busy': busy || undefined,
    title,
    disabled,
    onClick: () => onChange(!checked)
  };
  return uiTheme !== 'modern' ? (
    <button
      {...common}
      className="relative inline-flex h-7 w-7 items-center justify-center bg-black border border-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 flex-shrink-0 max-sm:before:absolute max-sm:before:-inset-2.5"
    >
      {checked && <Check className="w-5 h-5 text-white" strokeWidth={3} aria-hidden="true" />}
    </button>
  ) : (
    <button
      {...common}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 cursor-pointer flex-shrink-0 max-sm:before:absolute max-sm:before:-inset-2',
        checked ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-neutral-700'
      )}
    >
      <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

// A row with a visible label and a switch.
export function PermissionSwitch({ label, ...switchProps }) {
  return (
    <div className="flex items-center justify-between gap-3 max-sm:min-h-10">
      <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{label}</span>
      <Switch label={label} {...switchProps} />
    </div>
  );
}
