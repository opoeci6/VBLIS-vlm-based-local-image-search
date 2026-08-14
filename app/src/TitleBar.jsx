import React from 'react';
import { Minus, Square, X, Moon, Sun, Shirt, Check, Sparkles, Terminal } from 'lucide-react';

const TitleBar = ({ theme, setTheme, uiTheme = 'modern', setUiTheme }) => {
  const [showThemeMenu, setShowThemeMenu] = React.useState(false);
  const themeMenuRef = React.useRef(null);

  React.useEffect(() => {
    const handlePointerDown = (event) => {
      if (!themeMenuRef.current?.contains(event.target)) {
        setShowThemeMenu(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

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

  const themeOptions = [
    { id: 'modern', label: 'Modern Rounded', icon: Sparkles, desc: 'Soft curves, gradients & glassmorphism' },
    { id: 'terminal', label: 'Retro Terminal', icon: Terminal, desc: 'Monospace, sharp borders & ASCII art' }
  ];

  return (
    <div className="h-8 w-full bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between select-none fixed top-0 left-0 z-[200]">
      <div className="flex-1 h-full flex items-center px-3" style={{ WebkitAppRegion: 'drag' }}>
        <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 tracking-tight">VBLIS</span>
      </div>
      <div className="flex h-full items-center" style={{ WebkitAppRegion: 'no-drag' }}>
        <div ref={themeMenuRef} className="relative h-full">
          <button
            onClick={() => setShowThemeMenu(current => !current)}
            className="h-full px-3.5 flex items-center justify-center text-neutral-500 hover:text-indigo-600 dark:text-neutral-400 dark:hover:text-indigo-400 transition-colors"
            title="Switch UI Theme Style"
            aria-label="Switch UI Theme Style"
            aria-expanded={showThemeMenu}
          >
            <Shirt className="w-4 h-4" />
          </button>

          {showThemeMenu && (
            <div className="absolute right-0 top-full z-[220] mt-1 w-64 border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded-xl p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
              <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                UI Theme Style
              </div>
              <div className="space-y-1">
                {themeOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = uiTheme === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setUiTheme?.(opt.id);
                        setShowThemeMenu(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left rounded-lg transition-all ${
                        isSelected
                          ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold'
                          : 'text-neutral-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-neutral-400'}`} />
                        <div className="min-w-0">
                          <div className="text-xs font-bold leading-tight">{opt.label}</div>
                          <div className="text-[10px] text-neutral-400 dark:text-neutral-500 truncate leading-normal">{opt.desc}</div>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 flex-shrink-0 text-indigo-600 dark:text-indigo-400" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="w-[1px] h-4 bg-gray-200 dark:bg-neutral-800 mx-1" />
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

