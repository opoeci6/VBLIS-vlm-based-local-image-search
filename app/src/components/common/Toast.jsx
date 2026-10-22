import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '../../utils/cn';

export const Toast = ({ toast, onClose }) => {
  return (
    <div
      className={cn(
        "fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] border backdrop-blur-xl px-5 py-3 rounded-2xl flex items-center gap-3 shadow-2xl animate-in slide-in-from-bottom-4 fade-in duration-300 max-w-lg min-w-[320px]",
        toast.type === 'success'
          ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200"
          : "bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200"
      )}
    >
      {toast.type === 'success' ? (
        <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
      )}
      <span className="text-sm font-semibold flex-1">{toast.message}</span>
      <button onClick={() => onClose()} className={cn(
        "ml-2 transition-colors flex-shrink-0 p-1 rounded-lg hover:bg-white/10",
        toast.type === 'success' ? "text-emerald-400 hover:text-emerald-100" : "text-rose-400 hover:text-rose-100"
      )}>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      </button>
    </div>
  );
};
