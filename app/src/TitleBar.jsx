import React from 'react';
import { Minus, Square, X, Moon, Sun } from 'lucide-react';

const TitleBar = ({ theme, setTheme }) => {
  const handleMinimize = () => {
    window.electronAPI?.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.maximize();
  };

  const handleClose = () => {
    window.electronAPI?.close();
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="h-8 w-full bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between select-none fixed top-0 left-0 z-[200]">
      <div className="flex-1 h-full flex items-center px-3" style={{ WebkitAppRegion: 'drag' }}>
        <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 tracking-tight">VBLIS</span>
      </div>
      <div className="flex h-full items-center" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={toggleTheme}
          className="h-full px-3.5 flex items-center justify-center text-neutral-500 hover:text-indigo-600 dark:text-neutral-400 dark:hover:text-amber-400 transition-colors"
          title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
        <div className="w-[1px] h-4 bg-gray-200 dark:bg-neutral-800 mx-1" />
        <button
          onClick={handleMinimize}
          className="h-full px-4 flex items-center justify-center text-neutral-500 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full px-4 flex items-center justify-center text-neutral-500 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white transition-colors"
          title="Maximize"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={handleClose}
          className="h-full px-4 flex items-center justify-center text-neutral-500 hover:bg-rose-600 hover:text-white dark:text-neutral-400 dark:hover:bg-rose-600 dark:hover:text-white transition-colors"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
