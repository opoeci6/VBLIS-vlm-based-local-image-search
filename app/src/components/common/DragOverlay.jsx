import { Image as ImageIcon } from 'lucide-react';

export const DragOverlay = ({ activeTask, pendingCount }) => {
  return (
    <div className="fixed inset-0 z-[100] bg-indigo-600/20 backdrop-blur-sm flex items-center justify-center p-8 pointer-events-none animate-in fade-in duration-200">
      <div className="w-full max-w-2xl h-64 border-2 border-dashed border-indigo-400 rounded-3xl bg-neutral-900/80 flex flex-col items-center justify-center gap-4 shadow-2xl scale-110">
        <div className="icon-tile w-20 h-20 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center ring-1 ring-indigo-500/40">
          <ImageIcon className="w-10 h-10 animate-bounce" />
        </div>
        <div className="text-center">
          <h3 className="text-2xl font-bold text-white mb-2">
            {activeTask || pendingCount > 0
              ? `Drop to add to Queue (#${pendingCount + (activeTask ? 1 : 0) + 1})`
              : 'Drop to search or index'}
          </h3>
          <p className="text-neutral-400">
            {activeTask || pendingCount > 0
              ? 'Folders will be added to the background processing queue'
              : 'Drop images to search, or folders to start indexing'}
          </p>
        </div>
      </div>
    </div>
  );
};
