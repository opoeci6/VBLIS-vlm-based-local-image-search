import { Sparkles, Terminal } from 'lucide-react';
import { cn } from '../../utils/cn';

export const ThemeStyleSection = ({ uiTheme, setUiTheme }) => {
  return (
    <div className="pt-2">
      <label className="block text-sm font-semibold text-neutral-500 dark:text-neutral-400 mb-2">UI Theme Style</label>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <button
          type="button"
          onClick={() => setUiTheme('modern')}
          className={cn(
            "flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all",
            uiTheme === 'modern'
              ? "bg-indigo-50 dark:bg-indigo-500/15 border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20"
              : "bg-gray-50 dark:bg-neutral-800/30 border-gray-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800"
          )}
        >
          <Sparkles className={cn("w-5 h-5 flex-shrink-0", uiTheme === 'modern' ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-400")} />
          <div>
            <div className="text-xs font-bold">Modern Rounded</div>
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">Soft curves & glass</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setUiTheme('terminal')}
          className={cn(
            "flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all",
            uiTheme === 'terminal'
              ? "bg-indigo-50 dark:bg-indigo-500/15 border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20"
              : "bg-gray-50 dark:bg-neutral-800/30 border-gray-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800"
          )}
        >
          <Terminal className={cn("w-5 h-5 flex-shrink-0", uiTheme === 'terminal' ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-400")} />
          <div>
            <div className="text-xs font-bold">Retro Terminal</div>
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">Monospace & ASCII</div>
          </div>
        </button>
      </div>
    </div>
  );
};
