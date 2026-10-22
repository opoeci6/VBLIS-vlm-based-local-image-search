import { AlertTriangle } from 'lucide-react';

export const SearchTuningSection = ({ minScore, setMinScore, maxResults, setMaxResults }) => {
  return (
    <>
      <div className="pt-2">
        <div className="flex justify-between items-center mb-1">
          <label className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">Minimum Match Score</label>
          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{Math.round(minScore * 100)}%</span>
        </div>
        <input
          type="range"
          min="0.05" max="0.95" step="0.01"
          value={minScore}
          onChange={(e) => setMinScore(parseFloat(e.target.value))}
          className="terminal-range w-full cursor-pointer"
        />
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Filters out vague or low-confidence network results.</p>
      </div>
      <div className="pt-2">
        <div className="flex justify-between items-center mb-1">
          <label className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">Maximum Display Results</label>
          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{parseInt(maxResults) === 0 ? 'Unlimited' : `${maxResults} Images`}</span>
        </div>
        <input
          type="range"
          min="0" max="250" step="5"
          value={maxResults}
          onChange={(e) => setMaxResults(parseInt(e.target.value))}
          className="terminal-range w-full cursor-pointer"
        />
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Higher numbers may consume more system memory.</p>
        {parseInt(maxResults) === 0 && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold mt-2 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
            <AlertTriangle className="w-3 h-3" />
            Warning: Unlimited results may impact performance and memory.
          </p>
        )}
      </div>
    </>
  );
};
