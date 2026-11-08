import { AlertTriangle, RotateCcw } from 'lucide-react';
import { SEARCH_TUNING_DEFAULTS } from '../../hooks/useMediaSearch';

export const SearchTuningSection = ({ minScore, setMinScore, minSimilarity, setMinSimilarity, maxResults, setMaxResults, resetSearchTuning }) => {
  const isDefault = minScore === SEARCH_TUNING_DEFAULTS.minScore
    && minSimilarity === SEARCH_TUNING_DEFAULTS.minSimilarity
    && parseInt(maxResults) === SEARCH_TUNING_DEFAULTS.maxResults;

  return (
    <>
      <div className="pt-2">
        <div className="flex justify-between items-center mb-1">
          <label className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">Minimum Match Score</label>
          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{Math.round(minScore * 100)}%</span>
        </div>
        <input
          type="range"
          min="0.01" max="0.95" step="0.01"
          value={minScore}
          onChange={(e) => setMinScore(parseFloat(e.target.value))}
          className="terminal-range w-full cursor-pointer"
        />
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Text search: how sure the model must be that a result matches your words.</p>
      </div>
      <div className="pt-2">
        <div className="flex justify-between items-center mb-1">
          <label className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">Minimum Similarity</label>
          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{Math.round(minSimilarity * 100)}%</span>
        </div>
        <input
          type="range"
          min="0.30" max="0.95" step="0.01"
          value={minSimilarity}
          onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
          className="terminal-range w-full cursor-pointer"
        />
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Image search: how visually similar a result must be to the dropped image.</p>
      </div>
      <div className="pt-2">
        <div className="flex justify-between items-center mb-1">
          <label className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">Maximum Display Results</label>
          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{parseInt(maxResults) === 0 ? 'Unlimited' : `${maxResults} Results`}</span>
        </div>
        <input
          type="range"
          min="0" max="250" step="5"
          value={maxResults}
          onChange={(e) => setMaxResults(parseInt(e.target.value))}
          className="terminal-range w-full cursor-pointer"
        />
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Each video counts as one result. Higher numbers may consume more system memory. The library view always shows everything.</p>
        {parseInt(maxResults) === 0 && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold mt-2 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
            <AlertTriangle className="w-3 h-3" />
            Warning: Unlimited results may impact performance and memory.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={resetSearchTuning}
        disabled={isDefault}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/60 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-neutral-800/60"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Reset to defaults
      </button>
    </>
  );
};
