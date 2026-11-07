import { AlertTriangle, X } from 'lucide-react';

export const IndexingErrorsAlert = ({ showErrorAlert, setShowErrorAlert, status }) => {
  if (!(showErrorAlert && status.failed_files && status.failed_files.length > 0)) return null;

  return (
    <div className="w-full max-w-7xl px-6 mb-6 animate-in slide-in-from-top-4 duration-500">
      <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl p-4 flex flex-col gap-3 relative overflow-hidden ring-1 ring-amber-500/10">
        <button
          onClick={() => setShowErrorAlert(false)}
          className="absolute top-4 right-4 p-2 text-amber-500/60 hover:text-amber-700 dark:text-amber-400/60 dark:hover:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/10 rounded-xl transition-all"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-3 text-amber-700 dark:text-amber-400">
          <div className="icon-tile w-10 h-10 bg-amber-100 dark:bg-amber-500/10 rounded-xl flex items-center justify-center flex-shrink-0 border border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-500">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200">Indexing Errors Encountered</h3>
            <p className="text-xs text-amber-600 dark:text-amber-400/80 mt-0.5 font-medium">The following {status.failed_files.length} file{status.failed_files.length !== 1 ? 's' : ''} could not be successfully processed:</p>
          </div>
        </div>
        <div className="max-h-[160px] overflow-y-auto custom-scrollbar pr-2 flex flex-col gap-1.5 mt-1">
          {status.failed_files.map((path, idx) => (
            <div key={idx} className="text-[10px] font-mono text-neutral-600 dark:text-neutral-400 bg-white dark:bg-neutral-900/50 p-2.5 rounded-xl border border-gray-100 dark:border-white/5 break-all shadow-sm dark:shadow-none" title={path}>
              {path}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
