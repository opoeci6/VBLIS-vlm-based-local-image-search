import { X } from 'lucide-react';

export const ImageSearchChip = ({ imageSearchContext, handleClearImageSearch }) => {
  if (!(imageSearchContext)) return null;

  return (
    <div className="mb-8 animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="inline-flex items-center gap-3 px-4 py-2 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 rounded-2xl ring-1 ring-indigo-500/10">
        <div className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-pulse" />
        <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">Visual Search</span>
        <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-300 border-l border-indigo-200 dark:border-indigo-500/30 pl-3 ml-1">{imageSearchContext}</span>
        <button
          onClick={handleClearImageSearch}
          className="ml-2 p-1 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 rounded-lg transition-colors text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-200"
          title="Clear visual search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
