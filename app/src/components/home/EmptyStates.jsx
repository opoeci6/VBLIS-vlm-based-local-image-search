import { Search, Loader2, Image as ImageIcon, LogOut } from 'lucide-react';
import { AsciiLogo } from '../common/AsciiLogo';

export const NoMatches = () => {
  return (
    <div className="flex flex-col items-center justify-center mt-32 opacity-50">
      <Search className="w-16 h-16 mb-4 text-neutral-400 dark:text-neutral-600" />
      <p className="text-xl mb-1 text-neutral-800 dark:text-neutral-300 font-bold">No matches found</p>
      <p className="text-sm text-neutral-500 dark:text-neutral-500 font-medium">Try a different query or index more images.</p>
    </div>
  );
};

export const BackendLoading = ({ isSwitchingModel }) => {
  return (
    <div className="flex flex-col items-center justify-center mt-32 gap-6 animate-in fade-in duration-1000">
      <div className="w-24 h-24 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center relative">
        <div className="absolute inset-0 rounded-full border border-indigo-200 dark:border-indigo-500/20 animate-spin opacity-30" style={{ animationDuration: '3s' }} />
        <Loader2 className="w-10 h-10 text-indigo-500 dark:text-indigo-400 opacity-80 animate-spin" style={{ animationDuration: '2s' }} />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-light text-neutral-800 dark:text-neutral-300">{isSwitchingModel ? 'Switching Model' : 'Initializing AI Engine'}</h2>
        <p className="text-neutral-500 dark:text-neutral-500 max-w-md font-medium">{isSwitchingModel ? 'Loading model weights into memory. This may take a moment...' : 'Connecting to backend and loading model weights into memory...'}</p>
      </div>
    </div>
  );
};

export const ModelSetupState = ({ models, handleModelSwitch, setShowSettings, handleDownloadModel, pendingModel }) => {
  const downloadedModels = models.models?.filter(m => m.downloaded) || [];
  const hasDownloaded = downloadedModels.length > 0;

  if (hasDownloaded) {
    return (
      <div className="flex flex-col items-center justify-center mt-10 gap-4 animate-in fade-in duration-1000">
        <div className="w-24 h-24 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center relative">
          <div className="absolute inset-0 rounded-full border border-amber-200 dark:border-amber-500/20 animate-ping opacity-20" style={{ animationDuration: '3s' }} />
          <ImageIcon className="w-10 h-10 text-amber-500 dark:text-amber-400 opacity-80" />
        </div>
        <div className="text-center space-y-3 flex flex-col items-center">
          <h2 className="text-2xl font-light text-neutral-800 dark:text-neutral-300">No Model Loaded</h2>
          <p className="text-neutral-500 dark:text-neutral-500 max-w-md font-medium">
            No Vision-Language model is currently active in memory. Select one of your downloaded models to activate it or manage models in Settings.
          </p>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => handleModelSwitch(downloadedModels[0].id)}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg transition-all text-xs font-semibold hover:scale-105 active:scale-95 cursor-pointer"
            >
              Activate {downloadedModels[0].id.split('/').pop()}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="px-5 py-2.5 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-sm transition-all text-xs font-semibold hover:scale-105 active:scale-95 cursor-pointer"
            >
              Open Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center mt-10 gap-4 animate-in fade-in duration-1000">
      <div className="w-24 h-24 rounded-full bg-rose-500/10 flex items-center justify-center relative">
        <div className="absolute inset-0 rounded-full border border-rose-500/20 animate-ping opacity-20" style={{ animationDuration: '3s' }} />
        <ImageIcon className="w-10 h-10 text-rose-400 opacity-80" />
      </div>
      <div className="text-center space-y-3 flex flex-col items-center">
        <h2 className="text-2xl font-light text-neutral-800 dark:text-neutral-300">AI Model Required</h2>
        <p className="text-neutral-500 dark:text-neutral-500 max-w-md font-medium">The Vision-Language Model tensors must be downloaded locally before you can index or search images.</p>
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => handleDownloadModel(pendingModel)}
            className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl shadow-lg transition-all font-medium text-sm hover:scale-105 active:scale-95 cursor-pointer"
          >
            Download {pendingModel === "openai/clip-vit-base-patch32" ? "OpenAI CLIP" : pendingModel.split('/').pop()}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="px-5 py-3 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-sm transition-all text-sm font-semibold hover:scale-105 active:scale-95 cursor-pointer"
          >
            Open Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export const ReadyToSearch = ({ uiTheme, indexedFolders, models, setShowSettings, handleUnloadModel, isUnloadingModel, status }) => {
  return (
    uiTheme === 'terminal' ? (
      <div className="flex flex-col items-center justify-center mt-3 gap-2 animate-in fade-in duration-1000">
        <AsciiLogo />
        <div data-ascii-protected="true" className="text-center space-y-2 flex flex-col items-center">
          <h2 className="text-2xl font-light text-neutral-800 dark:text-neutral-300">Ready to Search</h2>
          <p className="text-neutral-500 dark:text-neutral-500 max-w-md font-medium">
            {indexedFolders.length > 0
              ? `${indexedFolders.length} folder${indexedFolders.length > 1 ? 's are' : ' is'} ready. Search your media using natural language.`
              : 'Select a folder to extract intelligence, then search your memories using natural language.'}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-indigo-50/80 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-200/80 dark:border-indigo-500/20 rounded-xl text-xs font-semibold text-indigo-600 dark:text-indigo-400 transition-all hover:scale-105 cursor-pointer shadow-sm"
            >
              <div className="model-status-dot model-status-dot-online w-2 h-2 flex-shrink-0" aria-hidden="true" />
              <span>Active Model: <span className="font-mono font-bold">{models.active_model.split('/').pop()}</span></span>
            </button>
            <button
              onClick={handleUnloadModel}
              disabled={isUnloadingModel || status.is_indexing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-neutral-800 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-neutral-700 dark:text-neutral-300 hover:text-rose-600 dark:hover:text-rose-400 border border-gray-200 dark:border-neutral-700 hover:border-rose-300 dark:hover:border-rose-500/30 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
              title={status.is_indexing ? "Cannot eject model while indexing is in progress" : "Unload model to free GPU VRAM"}
            >
              <LogOut className="w-3.5 h-3.5 text-rose-500" />
              {isUnloadingModel ? "Unloading..." : "Eject"}
            </button>
          </div>
        </div>
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center mt-10 gap-4 animate-in fade-in duration-1000">
        <div className="w-24 h-24 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center relative">
          <div className="absolute inset-0 rounded-full border border-indigo-200 dark:border-indigo-500/20 animate-ping opacity-20" style={{ animationDuration: '3s' }} />
          <ImageIcon className="w-10 h-10 text-indigo-500 dark:text-indigo-400 opacity-80" />
        </div>
        <div className="text-center space-y-3 flex flex-col items-center">
          <h2 className="text-2xl font-light text-neutral-800 dark:text-neutral-300">Ready to Search</h2>
          <p className="text-neutral-500 dark:text-neutral-500 max-w-md font-medium">
            {indexedFolders.length > 0
              ? `${indexedFolders.length} folder${indexedFolders.length > 1 ? 's are' : ' is'} ready. Search your media using natural language.`
              : 'Select a folder to extract intelligence, then search your memories using natural language.'}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-indigo-50/80 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-200/80 dark:border-indigo-500/20 rounded-xl text-xs font-semibold text-indigo-600 dark:text-indigo-400 transition-all hover:scale-105 cursor-pointer shadow-sm"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Active Model: <span className="font-mono font-bold">{models.active_model.split('/').pop()}</span></span>
            </button>
            <button
              onClick={handleUnloadModel}
              disabled={isUnloadingModel || status.is_indexing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-neutral-800 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-neutral-700 dark:text-neutral-300 hover:text-rose-600 dark:hover:text-rose-400 border border-gray-200 dark:border-neutral-700 hover:border-rose-300 dark:hover:border-rose-500/30 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
              title={status.is_indexing ? "Cannot eject model while indexing is in progress" : "Unload model to free GPU VRAM"}
            >
              <LogOut className="w-3.5 h-3.5 text-rose-500" />
              {isUnloadingModel ? "Unloading..." : "Eject"}
            </button>
          </div>
        </div>
      </div>
    )
  );
};
