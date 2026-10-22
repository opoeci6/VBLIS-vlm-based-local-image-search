import { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

export const SettingsSelect = ({ value, onChange, options, disabled, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => String(o.value) === String(value)) || options[0];

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(prev => !prev)}
        className={cn(
          "w-full flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
          isOpen && "border-indigo-500 ring-2 ring-indigo-500/20"
        )}
      >
        <span className="font-semibold truncate">{selectedOption?.label || placeholder}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-neutral-400 transition-transform duration-200 flex-shrink-0 ml-1.5", isOpen && "rotate-180 text-indigo-500")} />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1.5 w-full bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-2xl p-1 max-h-48 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95 duration-150">
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg text-left transition-all cursor-pointer",
                  isSelected
                    ? "bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-bold"
                    : "text-neutral-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800"
                )}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 ml-1" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
