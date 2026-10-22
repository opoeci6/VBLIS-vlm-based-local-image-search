import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Search, FolderOpen, Settings, Loader2, Image as ImageIcon, Check, CheckCircle2, Trash2, AlertTriangle, X, RefreshCw, CheckSquare, Square, ChevronRight, ChevronDown, ChevronUp, Sparkles, LogOut, XCircle, Copy, Video, Terminal, Play, Pause } from 'lucide-react';
import TitleBar from './TitleBar';
import { API_BASE } from './config';
import { cn } from './utils/cn';
import { formatBytes, formatDuration, formatVideoTimestamp } from './utils/formatters';
import { getMediaPreviewUrl, prewarmVideoGroup } from './utils/media';
import { VBLIS_ASCII_POINTS } from './utils/asciiLogoPoints';
import { annotateDuplicates, groupVideoResults, getImageResults } from './utils/searchResults';
import { getAllSelectablePaths, toggleFolderSelection as toggleFolderSelectionPure } from './utils/folderSelection';
import { getPathForFile, isDirectory } from './utils/electron';
import { useTaskQueue } from './hooks/useTaskQueue';
import { QueueStatusBadge } from './components/queue/QueueStatusBadge';
import { QueueDrawer } from './components/queue/QueueDrawer';
import { ModelSwitchWarningModal } from './components/modals/ModelSwitchWarningModal';
import { IndexedFolderTree } from './components/folders/IndexedFolderTree';

const FolderItemThumbnail = memo(function FolderItemThumbnail({ item, API_BASE, uiTheme = 'modern', onSelect }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const isModern = uiTheme === 'modern';
  const isVideo = item.media_type === 'video';
  const isMissing = item.exists_on_disk === false;

  if (isMissing) {
    return (
      <div
        className={cn(
          "relative w-12 h-12 flex-shrink-0 flex items-center justify-center overflow-hidden select-none cursor-not-allowed",
          isModern
            ? "rounded-xl ring-1 ring-rose-500/30 bg-rose-50 dark:bg-rose-950/40 text-rose-500"
            : "border border-rose-500 bg-black text-rose-400"
        )}
        title={`${item.name} is missing from disk`}
      >
        <AlertTriangle className="w-5 h-5 text-rose-500" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-12 h-12 flex-shrink-0 flex items-center justify-center overflow-hidden cursor-pointer group/thumb transition-all select-none",
        isModern
          ? "rounded-xl ring-1 ring-black/5 dark:ring-white/10 hover:ring-indigo-500/50 bg-gray-100 dark:bg-neutral-800"
          : "border border-white bg-black hover:border-indigo-400"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({
          path: item.path,
          name: item.name,
          media_type: item.media_type,
          size: item.size,
          isBrowsing: true,
          timestamp_seconds: isVideo ? 1.0 : 0
        });
      }}
      title={`Click to preview ${item.name}`}
    >
      {/* Placeholder skeleton / icon while loading or if error */}
      {(!loaded || error) && (
        <div className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity",
          isVideo
            ? "text-cyan-500 bg-cyan-500/10"
            : "text-indigo-500 bg-indigo-500/10",
          !loaded && !error && "animate-pulse"
        )}>
          {isVideo ? <Video className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}
        </div>
      )}

      {!error && (
        <img
          src={getMediaPreviewUrl(API_BASE, item, 'thumbnail')}
          alt={item.name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={cn(
            "w-full h-full object-cover transition-all duration-300 group-hover/thumb:scale-110",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}

      {/* Video indicator badge */}
      {isVideo && (
        <div className="absolute bottom-0.5 right-0.5 px-1 py-0.2 bg-black/80 backdrop-blur-sm rounded text-[8px] font-bold text-cyan-300 flex items-center gap-0.5 pointer-events-none">
          <Video className="w-2.5 h-2.5" />
        </div>
      )}
    </div>
  );
});

const SearchResult = memo(function SearchResult({ res, idx, API_BASE, onSelect, uiTheme = 'modern' }) {
  const isModern = uiTheme === 'modern';

  return (
    <div
      className={cn(
        "relative group cursor-pointer h-[250px] overflow-hidden animate-in fade-in zoom-in-95 fill-mode-both",
        isModern
          ? "rounded-3xl shadow-xl ring-1 ring-black/5 dark:ring-white/5 transition-all duration-300 hover:shadow-2xl hover:-translate-y-1"
          : "border border-white bg-black",
        res.isDuplicate && (isModern ? "ring-2" : "border-2")
      )}
      style={{
        animationDelay: `${idx * 50}ms`,
        animationDuration: '400ms',
        boxShadow: isModern && res.isDuplicate ? `0 0 20px -5px ${res.dupeColor}66, 0 0 0 2px ${res.dupeColor}` : undefined
      }}
      onClick={() => onSelect(res)}
    >
      {res.isDuplicate && (
        <div
          className={cn(
            "absolute top-3 left-3 z-10 px-2.5 py-1 text-[10px] font-bold text-white shadow-lg flex items-center gap-1.5",
            isModern ? "rounded-full backdrop-blur-md" : "bg-black border border-white"
          )}
          style={{ backgroundColor: isModern ? `${res.dupeColor || '#6366f1'}ee` : undefined }}
        >
          {res.duplicateType === 'exact' ? <Copy className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
          <span>
            {res.duplicateType === 'exact' ? 'Exact Copy' : 'Visual Duplicate'} ({res.otherPaths ? res.otherPaths.length + 1 : 2})
          </span>
        </div>
      )}

      {res.media_type === 'video' && (
        <div
          className={cn(
            "absolute top-3 right-3 z-10 px-2.5 py-1 text-[10px] font-bold shadow-lg flex items-center gap-1.5",
            isModern
              ? "bg-black/70 backdrop-blur-md text-white rounded-full ring-1 ring-white/10"
              : "bg-black text-cyan-300 border border-white"
          )}
        >
          <Video className="w-3 h-3 text-cyan-400" />
          <span>{formatVideoTimestamp(res.timestamp_seconds)}</span>
        </div>
      )}

      <img
        src={getMediaPreviewUrl(API_BASE, res)}
        alt={res.media_type === 'video' ? `Video frame at ${formatVideoTimestamp(res.timestamp_seconds)}` : 'Result'}
        className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
        loading="lazy"
      />

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
          isModern
            ? "bg-gradient-to-t from-black/80 via-black/40 to-transparent"
            : "media-result-overlay bg-black border-t border-white"
        )}
      >
        <div className="translate-y-2 group-hover:translate-y-0 transition-transform duration-300 ease-out">
          <p className="text-xs font-semibold text-emerald-400 mb-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {Math.round(res.score * 100)}% Match
          </p>
          <p className="text-xs text-white/90 truncate font-mono" title={res.path}>
            {res.path.split('\\').pop().split('/').pop()}
          </p>
        </div>
      </div>
    </div>
  );
});

const VideoFrameCard = memo(function VideoFrameCard({ frame, index, API_BASE, onSelect, uiTheme = 'modern' }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const isModern = uiTheme === 'modern';

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group cursor-pointer overflow-hidden focus:outline-none transition-all duration-200",
        isModern
          ? "rounded-2xl border border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-800/40 hover:shadow-lg hover:border-indigo-300 dark:hover:border-indigo-500/40"
          : "border border-white bg-black focus:ring-2 focus:ring-white"
      )}
      onClick={() => onSelect(frame)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(frame);
        }
      }}
    >
      <div className={cn(
        "relative h-44 overflow-hidden bg-neutral-200 dark:bg-neutral-800",
        isModern ? "border-b border-gray-100 dark:border-neutral-700/50" : "border-b border-white"
      )}>
        {/* Placeholder skeleton while loading */}
        {(!loaded || error) && (
          <div className={cn(
            "absolute inset-0 flex flex-col items-center justify-center text-cyan-500 bg-cyan-500/10 transition-opacity",
            !loaded && !error && "animate-pulse"
          )}>
            <Video className="w-7 h-7 opacity-70 mb-1" />
            <span className="text-[10px] font-mono text-cyan-400 font-bold">
              {formatVideoTimestamp(frame.timestamp_seconds)}
            </span>
          </div>
        )}

        {!error && (
          <img
            src={getMediaPreviewUrl(API_BASE, frame, 'thumbnail')}
            alt={`Video frame at ${formatVideoTimestamp(frame.timestamp_seconds)}`}
            className={cn(
              "h-full w-full object-cover transition-all duration-500 group-hover:scale-105",
              loaded ? "opacity-100" : "opacity-0"
            )}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
        )}

        <span className={cn(
          "absolute bottom-2 left-2 px-2.5 py-1 text-xs font-bold shadow-lg",
          isModern
            ? "bg-black/70 backdrop-blur-md text-white rounded-full ring-1 ring-white/10"
            : "border border-white bg-black text-white"
        )}>
          {formatVideoTimestamp(frame.timestamp_seconds)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 p-3 text-xs font-bold text-neutral-700 dark:text-neutral-200">
        <span>FRAME {index + 1}</span>
        <span className="text-emerald-500 font-semibold">{Math.round((frame.score || 0) * 100)}% MATCH</span>
      </div>
    </div>
  );
});

const VideoResultFolder = memo(function VideoResultFolder({ group, idx, API_BASE, onSelect, uiTheme = 'modern' }) {
  const isModern = uiTheme === 'modern';

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group cursor-pointer overflow-hidden animate-in fade-in zoom-in-95 fill-mode-both focus:outline-none transition-all duration-300",
        isModern
          ? "rounded-3xl shadow-xl ring-1 ring-black/5 dark:ring-white/5 bg-white dark:bg-neutral-900 hover:shadow-2xl hover:-translate-y-1"
          : "border border-white bg-black focus:ring-2 focus:ring-white"
      )}
      style={{
        animationDelay: `${idx * 50}ms`,
        animationDuration: '400ms'
      }}
      onMouseEnter={() => prewarmVideoGroup(API_BASE, group)}
      onClick={() => {
        prewarmVideoGroup(API_BASE, group);
        onSelect(group);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          prewarmVideoGroup(API_BASE, group);
          onSelect(group);
        }
      }}
    >
      <div className={cn(
        "relative h-48 overflow-hidden bg-neutral-100 dark:bg-neutral-800",
        !isModern && "border-b border-white"
      )}>
        <img
          src={getMediaPreviewUrl(API_BASE, group.bestFrame)}
          alt={`Best matching frame from ${group.name}`}
          className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          loading="lazy"
        />
        <div className={cn(
          "absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1 text-xs font-bold shadow-lg",
          isModern ? "bg-black/70 backdrop-blur-md text-white rounded-full ring-1 ring-white/10" : "bg-black border border-white text-white"
        )}>
          <FolderOpen className="w-4 h-4 text-indigo-400" />
          VIDEO
        </div>
        <div className={cn(
          "absolute bottom-3 right-3 px-3 py-1 text-xs font-bold shadow-lg",
          isModern ? "bg-black/70 backdrop-blur-md text-emerald-400 rounded-full ring-1 ring-white/10" : "bg-black border border-white text-emerald-400"
        )}>
          BEST {Math.round(group.bestScore * 100)}%
        </div>
      </div>

      <div className={cn(
        "p-4 flex items-center gap-3",
        isModern ? "bg-white dark:bg-neutral-900 border-t border-gray-100 dark:border-white/5" : "bg-black"
      )}>
        <div className={cn(
          "flex h-11 w-11 flex-shrink-0 items-center justify-center",
          isModern ? "rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-200 dark:ring-indigo-500/20" : "icon-tile border border-white text-white"
        )}>
          <Video className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("font-bold truncate text-sm", isModern ? "text-neutral-800 dark:text-neutral-100" : "text-white")} title={group.path}>
            {group.name}
          </p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
            {group.frames.length} returned frame{group.frames.length === 1 ? '' : 's'}
          </p>
        </div>
        <ChevronRight className={cn(
          "w-5 h-5 flex-shrink-0 transition-transform group-hover:translate-x-1",
          isModern ? "text-neutral-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" : "text-white"
        )} />
      </div>
    </div>
  );
});

const SettingsSelect = ({ value, onChange, options, disabled, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => String(o.value) === String(value)) || options[0];

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(prev => !prev)}
        className={cn(
          "w-full flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
          isOpen && "border-indigo-500 ring-2 ring-indigo-500/20"
        )}
      >
        <span className="font-semibold truncate">{selectedOption?.label || placeholder}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-neutral-400 transition-transform duration-200 flex-shrink-0 ml-1.5", isOpen && "rotate-180 text-indigo-500")} />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1.5 w-full bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-2xl p-1 max-h-48 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95 duration-150">
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg text-left transition-all cursor-pointer",
                  isSelected
                    ? "bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-bold"
                    : "text-neutral-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800"
                )}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 ml-1" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const RotatingAsciiLogo = () => {
  const outputRef = useRef(null);
  const stageRef = useRef(null);
  const particleCanvasRef = useRef(null);

  useEffect(() => {
    const columns = 86;
    const rows = 22;
    const luminance = '.,:;irsXA253hMHGS#9B&@';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frameId;
    let scatterFrameId;
    let angle = -0.45;
    let isScattered = false;
    let latestCharacters = [];
    let particles = [];
    let canvasWidth = window.innerWidth;
    let canvasHeight = window.innerHeight;

    const resizeCanvas = () => {
      const canvas = particleCanvasRef.current;
      if (!canvas) return;

      const previousWidth = canvasWidth;
      const previousHeight = canvasHeight;
      canvasWidth = window.innerWidth;
      canvasHeight = window.innerHeight;
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvasWidth * pixelRatio);
      canvas.height = Math.round(canvasHeight * pixelRatio);
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;

      if (isScattered && previousWidth > 0 && previousHeight > 0) {
        const scaleX = canvasWidth / previousWidth;
        const scaleY = canvasHeight / previousHeight;
        particles.forEach(particle => {
          particle.x *= scaleX;
          particle.y *= scaleY;
          particle.startX *= scaleX;
          particle.startY *= scaleY;
          particle.targetX *= scaleX;
          particle.targetY *= scaleY;
        });
      }
    };

    const drawParticles = () => {
      const canvas = particleCanvasRef.current;
      const output = outputRef.current;
      if (!canvas || !output) return;

      const context = canvas.getContext('2d');
      const pixelRatio = window.devicePixelRatio || 1;
      const outputStyle = window.getComputedStyle(output);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, canvasWidth, canvasHeight);
      context.fillStyle = outputStyle.color;
      context.font = `${outputStyle.fontWeight} ${outputStyle.fontSize} ${outputStyle.fontFamily}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';

      particles.forEach(particle => {
        context.fillText(particle.character, particle.x, particle.y);
      });
    };

    const getProtectedRectangles = () => {
      const selectors = [
        'header',
        'button',
        'input',
        'select',
        'h1',
        'h2',
        'h3',
        'p',
        'label',
        '[data-ascii-protected="true"]'
      ];

      return Array.from(document.querySelectorAll(selectors.join(',')))
        .map(element => element.getBoundingClientRect())
        .filter(rectangle => rectangle.width > 0 && rectangle.height > 0)
        .map(rectangle => ({
          left: rectangle.left - 14,
          right: rectangle.right + 14,
          top: rectangle.top - 10,
          bottom: rectangle.bottom + 10
        }));
    };

    const startScatter = () => {
      const output = outputRef.current;
      if (!output || isScattered || latestCharacters.length === 0) return;

      isScattered = true;
      window.clearTimeout(frameId);
      resizeCanvas();

      const outputRectangle = output.getBoundingClientRect();
      const outputStyle = window.getComputedStyle(output);
      const lineHeight = parseFloat(outputStyle.lineHeight) || parseFloat(outputStyle.fontSize);
      const cellWidth = outputRectangle.width / columns;
      const centerX = outputRectangle.left + outputRectangle.width / 2;
      const centerY = outputRectangle.top + outputRectangle.height / 2;
      const protectedRectangles = getProtectedRectangles();
      const occupiedDestinations = new Set();
      const minimumDistance = Math.min(canvasWidth, canvasHeight) * 0.2;

      const isSafeDestination = (x, y) => {
        if (x < 12 || x > canvasWidth - 12 || y < 42 || y > canvasHeight - 12) return false;
        if (Math.hypot(x - centerX, y - centerY) < minimumDistance) return false;
        if (protectedRectangles.some(rectangle => (
          x >= rectangle.left
          && x <= rectangle.right
          && y >= rectangle.top
          && y <= rectangle.bottom
        ))) return false;

        const destinationKey = `${Math.round(x / 11)}:${Math.round(y / 14)}`;
        if (occupiedDestinations.has(destinationKey)) return false;
        occupiedDestinations.add(destinationKey);
        return true;
      };

      particles = latestCharacters.map((item, index) => {
        const startX = outputRectangle.left + (item.column + 0.5) * cellWidth;
        const startY = outputRectangle.top + (item.row + 0.5) * lineHeight;
        let targetX = startX;
        let targetY = startY;

        for (let attempt = 0; attempt < 120; attempt += 1) {
          const candidateX = 12 + Math.random() * Math.max(1, canvasWidth - 24);
          const candidateY = 42 + Math.random() * Math.max(1, canvasHeight - 54);
          if (isSafeDestination(candidateX, candidateY)) {
            targetX = candidateX;
            targetY = candidateY;
            break;
          }
        }

        return {
          character: item.character,
          column: item.column,
          row: item.row,
          startX,
          startY,
          targetX,
          targetY,
          x: startX,
          y: startY,
          delay: (index % 13) * 12,
          duration: 1050 + Math.random() * 650
        };
      });

      output.style.visibility = 'hidden';
      const animationStart = performance.now();

      const animateScatter = currentTime => {
        let animationComplete = true;

        particles.forEach(particle => {
          const elapsed = currentTime - animationStart - particle.delay;
          const progress = Math.max(0, Math.min(1, elapsed / particle.duration));
          const easedProgress = 1 - Math.pow(1 - progress, 3);
          particle.x = particle.startX + (particle.targetX - particle.startX) * easedProgress;
          particle.y = particle.startY + (particle.targetY - particle.startY) * easedProgress;
          if (progress < 1) animationComplete = false;
        });

        drawParticles();
        if (!animationComplete && !reduceMotion) {
          scatterFrameId = window.requestAnimationFrame(animateScatter);
        } else if (reduceMotion) {
          particles.forEach(particle => {
            particle.x = particle.targetX;
            particle.y = particle.targetY;
          });
          drawParticles();
        }
      };

      scatterFrameId = window.requestAnimationFrame(animateScatter);
    };

    const returnScatter = () => {
      const output = outputRef.current;
      const canvas = particleCanvasRef.current;
      if (!output || !canvas || !isScattered || particles.length === 0) return;

      window.cancelAnimationFrame(scatterFrameId);
      const outputRectangle = output.getBoundingClientRect();
      const outputStyle = window.getComputedStyle(output);
      const lineHeight = parseFloat(outputStyle.lineHeight) || parseFloat(outputStyle.fontSize);
      const cellWidth = outputRectangle.width / columns;
      const animationStart = performance.now();

      particles.forEach((particle, index) => {
        particle.returnStartX = particle.x;
        particle.returnStartY = particle.y;
        particle.homeX = outputRectangle.left + (particle.column + 0.5) * cellWidth;
        particle.homeY = outputRectangle.top + (particle.row + 0.5) * lineHeight;
        particle.returnDelay = ((particles.length - index) % 11) * 8;
        particle.returnDuration = 780 + Math.random() * 320;
      });

      const finishReturn = () => {
        const context = canvas.getContext('2d');
        const pixelRatio = window.devicePixelRatio || 1;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        output.style.visibility = 'visible';
        isScattered = false;
        particles = [];

        if (reduceMotion) {
          renderFrame();
        } else {
          animate();
        }

        if (stageRef.current?.matches(':hover')) {
          startScatter();
        }
      };

      const animateReturn = currentTime => {
        let animationComplete = true;

        particles.forEach(particle => {
          const elapsed = currentTime - animationStart - particle.returnDelay;
          const progress = Math.max(0, Math.min(1, elapsed / particle.returnDuration));
          const easedProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          particle.x = particle.returnStartX + (particle.homeX - particle.returnStartX) * easedProgress;
          particle.y = particle.returnStartY + (particle.homeY - particle.returnStartY) * easedProgress;
          if (progress < 1) animationComplete = false;
        });

        drawParticles();
        if (!animationComplete && !reduceMotion) {
          scatterFrameId = window.requestAnimationFrame(animateReturn);
        } else {
          particles.forEach(particle => {
            particle.x = particle.homeX;
            particle.y = particle.homeY;
          });
          drawParticles();
          finishReturn();
        }
      };

      if (reduceMotion) {
        finishReturn();
      } else {
        scatterFrameId = window.requestAnimationFrame(animateReturn);
      }
    };

    const renderFrame = () => {
      const characters = Array(columns * rows).fill(' ');
      const depthBuffer = Array(columns * rows).fill(-Infinity);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const tilt = -0.12;
      const tiltCosine = Math.cos(tilt);
      const tiltSine = Math.sin(tilt);

      VBLIS_ASCII_POINTS.forEach(point => {
        const rotatedX = point.x * cosine + point.z * sine;
        const rotatedZ = -point.x * sine + point.z * cosine;
        const rotatedY = point.y * tiltCosine - rotatedZ * tiltSine;
        const finalZ = point.y * tiltSine + rotatedZ * tiltCosine;
        const perspective = 34 / (34 - finalZ);
        const screenX = Math.round(columns / 2 + rotatedX * 2.15 * perspective);
        const screenY = Math.round(rows / 2 + rotatedY * 1.65 * perspective);

        if (screenX < 0 || screenX >= columns || screenY < 0 || screenY >= rows) return;

        const index = screenY * columns + screenX;
        if (finalZ <= depthBuffer[index]) return;

        const shade = Math.max(0, Math.min(1, (finalZ + 17) / 34));
        characters[index] = luminance[Math.round(shade * (luminance.length - 1))];
        depthBuffer[index] = finalZ;
      });

      if (outputRef.current) {
        latestCharacters = characters.reduce((visibleCharacters, character, index) => {
          if (character !== ' ') {
            visibleCharacters.push({
              character,
              column: index % columns,
              row: Math.floor(index / columns)
            });
          }
          return visibleCharacters;
        }, []);
        outputRef.current.textContent = Array.from({ length: rows }, (_, row) =>
          characters.slice(row * columns, (row + 1) * columns).join('').trimEnd()
        ).join('\n');
      }
    };

    const animate = () => {
      if (isScattered) return;
      renderFrame();
      angle += 0.035;
      frameId = window.setTimeout(animate, 70);
    };

    if (reduceMotion) {
      renderFrame();
    } else {
      animate();
    }

    resizeCanvas();
    const stage = stageRef.current;
    stage?.addEventListener('mouseenter', startScatter);
    stage?.addEventListener('mouseleave', returnScatter);
    window.addEventListener('resize', resizeCanvas);

    const themeObserver = new MutationObserver(() => {
      if (isScattered) drawParticles();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      window.clearTimeout(frameId);
      window.cancelAnimationFrame(scatterFrameId);
      stage?.removeEventListener('mouseenter', startScatter);
      stage?.removeEventListener('mouseleave', returnScatter);
      window.removeEventListener('resize', resizeCanvas);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <>
      <canvas ref={particleCanvasRef} className="ascii-particle-layer" aria-hidden="true" />
      <div ref={stageRef} className="vblis-ascii-stage" role="img" aria-label="VBLIS rotating 3D ASCII logo">
        <pre ref={outputRef} className="vblis-ascii-output" aria-hidden="true" />
      </div>
    </>
  );
};

function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const [uiTheme, setUiTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ui_theme_style');
      if (saved) return saved;
    }
    return 'modern';
  });

  useEffect(() => {
    localStorage.setItem('ui_theme_style', uiTheme);
    if (uiTheme === 'terminal') {
      document.documentElement.setAttribute('data-theme-style', 'terminal');
    } else {
      document.documentElement.setAttribute('data-theme-style', 'modern');
    }
  }, [uiTheme]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedVideoGroup, setSelectedVideoGroup] = useState(null);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isFoldersExpanded, setIsFoldersExpanded] = useState(false);

  const [minScore, setMinScore] = useState(0.20);
  const [maxResults, setMaxResults] = useState(50);
  const [visibleResultsCount, setVisibleResultsCount] = useState(80);

  const [status, setStatus] = useState({
    is_indexing: false,
    percent: 0,
    progress: '0/0',
    total_files: 0,
    indexed_files: 0,
    current_file: '',
    errors: 0,
    failed_files: [],
    last_task_id: 0,
    is_downloading: false,
    download_total_bytes: 0,
    download_current_bytes: 0,
    download_speed: 0,
    download_eta: 0,
    download_error: null,
    cancel_download: false,
    is_loading_model: false,
    discovered_video_count: 0,
    indexed_video_frames: 0,
    is_rebuilding_video_thumbnails: false,
    rebuilt_video_frames: 0,
    total_video_frames_to_rebuild: 0
  });
  const [modelLoadError, setModelLoadError] = useState(null);


  const [models, setModels] = useState({ active_model: '', models: [] });
  const [showSettings, setShowSettings] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [pendingModel, setPendingModel] = useState("google/siglip2-base-patch16-224");
  const [backendReady, setBackendReady] = useState(false);
  const [isSwitchingModel, setIsSwitchingModel] = useState(false);
  const [isUnloadingModel, setIsUnloadingModel] = useState(false);
  const [isDeletingModel, setIsDeletingModel] = useState(false);
  const [deleteIndexWithModel, setDeleteIndexWithModel] = useState(false);
  const [showConfirmDeleteModel, setShowConfirmDeleteModel] = useState(null);
  const [isClearingThumbnails, setIsClearingThumbnails] = useState(false);
  const [showConfirmClearThumbnails, setShowConfirmClearThumbnails] = useState(null); // null | 'all' | 'images' | 'videos'
  const [cacheStats, setCacheStats] = useState({
    images: { count: 0, bytes: 0, formatted: '0 B' },
    videos: { count: 0, bytes: 0, formatted: '0 B' },
    total: { count: 0, bytes: 0, formatted: '0 B' }
  });
  const [isTriggeringRebuildThumbnails, setIsTriggeringRebuildThumbnails] = useState(false);
  const [toast, setToast] = useState(null);
  const queue = useTaskQueue(API_BASE, setToast);
  const [modelSwitchWarning, setModelSwitchWarning] = useState({
    isOpen: false,
    mode: 'active_task',
    targetModel: null
  });
  const [imageSearchContext, setImageSearchContext] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [indexedFolders, setIndexedFolders] = useState([]);
  const [isFetchingFolders, setIsFetchingFolders] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [showFolderContents, setShowFolderContents] = useState(false);
  const [browsingFolder, setBrowsingFolder] = useState(null);
  const [folderContents, setFolderContents] = useState(null);
  const [isFetchingFolderContents, setIsFetchingFolderContents] = useState(false);
  const [isCleaningGhostRecords, setIsCleaningGhostRecords] = useState(false);
  const [folderVisibleLimit, setFolderVisibleLimit] = useState(60);
  const [showErrorAlert, setShowErrorAlert] = useState(false);
  const [gpuSettings, setGpuSettings] = useState({ 
    use_gpu: false, 
    cuda_available: false, 
    device: 'cpu', 
    batch_size: 0, 
    effective_batch_size: 16,
    precision_mode: 'auto', 
    active_precision: 'fp32', 
    fp16_supported: false, 
    gpu_name: '' 
  });
  const [isSwitchingGpu, setIsSwitchingGpu] = useState(false);
  const [isCancellingIndexing, setIsCancellingIndexing] = useState(false);
  const searchInputRef = useRef(null);
  const lastToastedError = useRef(null);
  const prevIsDownloading = useRef(false);
  const prevIsIndexing = useRef(false);
  const prevLastTaskId = useRef(0);
  const foldersRef = useRef(null);

  useEffect(() => {
    if (!isFoldersExpanded) return;
    const handleClickOutside = (e) => {
      // If a modal, lightbox, or drawer is active or being clicked, do not collapse indexed folders
      if (showFolderContents || selectedImage || selectedVideoGroup || showSettings || queue.isDrawerOpen) {
        return;
      }
      // If clicking any header control, button, dialog, modal, drawer, or input, do not collapse
      if (e.target.closest?.('.fixed, [role="dialog"], header, nav, button, a, input, select, [data-no-collapse]')) {
        return;
      }
      if (foldersRef.current && !foldersRef.current.contains(e.target)) {
        setIsFoldersExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isFoldersExpanded, showFolderContents, selectedImage, selectedVideoGroup, showSettings, queue.isDrawerOpen]);

  const imageResults = useMemo(
    () => getImageResults(results),
    [results]
  );

  const visibleImageResults = useMemo(
    () => imageResults.slice(0, visibleResultsCount),
    [imageResults, visibleResultsCount]
  );

  const sentinelRef = useRef(null);
  const sentinelTerminalRef = useRef(null);

  // Background Prefetcher: Quietly prefetch the next 80 image thumbnails in browser idle time
  useEffect(() => {
    if (imageResults.length <= visibleResultsCount) return;
    const nextBatch = imageResults.slice(visibleResultsCount, visibleResultsCount + 80);
    const prefetchTimer = setTimeout(() => {
      nextBatch.forEach(item => {
        const url = getMediaPreviewUrl(API_BASE, item, 'thumbnail');
        const img = new window.Image();
        img.src = url;
      });
    }, 150);

    return () => clearTimeout(prefetchTimer);
  }, [imageResults, visibleResultsCount, API_BASE]);

  // Seamless Infinite Scroll: Auto-expands visibleResultsCount when scrolling near bottom
  useEffect(() => {
    if (imageResults.length <= visibleResultsCount) return;
    const observer = new IntersectionObserver((entries) => {
      const isVisible = entries.some(e => e.isIntersecting);
      if (isVisible) {
        setVisibleResultsCount(prev => Math.min(prev + 80, imageResults.length));
      }
    }, {
      root: null,
      rootMargin: '500px', // Pre-trigger 500px before reaching bottom
      threshold: 0.01
    });

    if (sentinelRef.current) observer.observe(sentinelRef.current);
    if (sentinelTerminalRef.current) observer.observe(sentinelTerminalRef.current);

    return () => observer.disconnect();
  }, [imageResults.length, visibleResultsCount]);

  const videoGroups = useMemo(() => groupVideoResults(results), [results]);

  const handleCancelIndexing = async () => {
    if (isCancellingIndexing) return;
    setIsCancellingIndexing(true);
    try {
      await fetch(`${API_BASE}/index/cancel`, { method: 'POST' });
      setToast({ message: "Indexing cancellation requested.", type: 'info' });
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to cancel indexing.", type: 'error' });
    } finally {
      setIsCancellingIndexing(false);
    }
  };

  const handleUpdatePerformanceSettings = async (updates) => {
    if (isSwitchingGpu) return;
    setIsSwitchingGpu(true);
    
    const payload = {
      use_gpu: updates.use_gpu !== undefined ? updates.use_gpu : gpuSettings.use_gpu,
      batch_size: updates.batch_size !== undefined ? Number(updates.batch_size) : (gpuSettings.batch_size ?? 0),
      precision_mode: updates.precision_mode !== undefined ? updates.precision_mode : (gpuSettings.precision_mode || 'auto')
    };

    try {
      const res = await fetch(`${API_BASE}/settings/gpu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setGpuSettings(data);
      setToast({ message: "Performance settings updated.", type: 'success' });
      
      const resModels = await fetch(`${API_BASE}/models`);
      const dataModels = await resModels.json();
      setModels(dataModels);
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to update settings.", type: 'error' });
    } finally {
      setIsSwitchingGpu(false);
    }
  };

  const handleToggleGpu = async () => {
    await handleUpdatePerformanceSettings({ use_gpu: !gpuSettings.use_gpu });
  };

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Poll status and backend boot
  useEffect(() => {
    let mounted = true;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/status`);
        const data = await res.json();
        if (mounted) setStatus(data);
      } catch { /* backend not reachable yet; ignore */ }
    };

    const fetchModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/models`);
        const data = await res.json();
        if (mounted) {
          setModels(data);
          setBackendReady(true);
        }
        return true;
      } catch {
        return false;
      }
    };

    const fetchGpuSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings/gpu`);
        if (!res.ok) throw new Error("Failed to fetch GPU settings");
        const data = await res.json();
        if (mounted) setGpuSettings(data);
      } catch (e) {
        console.error("GPU Settings Fetch Error:", e);
      }
    };

    fetchStatus();
    fetchGpuSettings();
    fetchModels();

    const interval = setInterval(() => {
      fetchStatus();
      fetchGpuSettings();
      fetchModels();
    }, 1500);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Refresh models list when a background download finishes
  useEffect(() => {
    let mounted = true;
    if (!status.is_downloading && backendReady) {
      const fetchModels = async () => {
        try {
          const res = await fetch(`${API_BASE}/models`);
          const data = await res.json();
          if (mounted) setModels(data);
        } catch { /* backend not reachable yet; ignore */ }
      };
      fetchModels();
    }
    return () => { mounted = false; };
  }, [status.is_downloading, backendReady]);

  // Refresh cache stats whenever settings modal opens or rebuild completes
  useEffect(() => {
    if (showSettings) {
      fetchCacheStats();
    }
  }, [showSettings, status.is_rebuilding_video_thumbnails]);

  // Toast for download completion
  useEffect(() => {
    // 1. Success case: download finished with no error
    if (prevIsDownloading.current === true && status.is_downloading === false && !status.download_error && status.download_total_bytes > 0) {
      const modelName = pendingModel.split('/').pop();
      fetch(`${API_BASE}/models`)
        .then((res) => res.json())
        .then((data) => {
          setModels(data);
          if (data.active_model === pendingModel) {
            setToast({ message: `Model ${modelName} downloaded and activated successfully!`, type: 'success' });
          } else {
            setToast({ message: `Model ${modelName} downloaded successfully.`, type: 'success' });
          }
        })
        .catch(() => {
          setToast({ message: `Model ${modelName} downloaded successfully.`, type: 'success' });
        });
    }

    // 2. Error case: download error detected
    if (status.download_error && status.download_error !== lastToastedError.current) {
      setToast({ message: `Download failed: ${status.download_error}`, type: 'error' });
      setModelLoadError({ model: pendingModel, message: status.download_error });
      lastToastedError.current = status.download_error;
    }

    // Reset lastToastedError when a new download starts (if caught by polling)
    if (status.is_downloading && !prevIsDownloading.current) {
      lastToastedError.current = null;
    }

    prevIsDownloading.current = status.is_downloading;
  }, [status.is_downloading, status.download_total_bytes, status.download_error, pendingModel]);

  // Alert for indexing completion with errors
  useEffect(() => {
    // Show alert if a task just finished and there were errors
    if (status.last_task_id > prevLastTaskId.current) {
      if (status.errors > 0) {
        setShowErrorAlert(true);
      } else if (status.discovered_video_count > 0) {
        setToast({
          message: `Indexed ${status.indexed_video_frames || 0} adaptive frame(s) from ${status.discovered_video_count} video file(s).`,
          type: 'success'
        });
      } else if (status.total_files === 0 && !status.is_indexing) {
        // Only toast about 0 files if it's a "fresh" completion
        setToast({ message: "No supported images or videos were found in the selected folder.", type: 'error' });
      }
    }

    // Also support the traditional "transition from indexing to not indexing" for safety
    if (prevIsIndexing.current === true && status.is_indexing === false && status.errors > 0) {
      setShowErrorAlert(true);
    }

    // If a new indexing starts, hide previous alert
    if (status.is_indexing === true && prevIsIndexing.current === false) {
      setShowErrorAlert(false);
    }

    prevIsIndexing.current = status.is_indexing;
    prevLastTaskId.current = status.last_task_id;
  }, [status.is_indexing, status.errors, status.last_task_id, status.total_files, status.discovered_video_count, status.indexed_video_frames]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) {
      if (hasSearched && !imageSearchContext) {
        setResults([]);
        setHasSearched(false);
        setQuery('');
      }
      return;
    }

    setIsFoldersExpanded(false);
    setIsSearching(true);
    setHasSearched(true);
    setImageSearchContext(null);
    setVisibleResultsCount(80);
    try {
      const res = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k: parseInt(maxResults) === 0 ? 20000 : parseInt(maxResults), min_score: parseFloat(minScore) })
      });
      const data = await res.json();
      setResults(annotateDuplicates(data.results));
      setShowSearchResults(true);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleImageDrop = async (file) => {
    if (!file.type.startsWith('image/')) {
      setToast({ message: "Please drop an image file.", type: 'error' });
      return;
    }

    setIsFoldersExpanded(false);
    setIsSearching(true);
    setHasSearched(true);
    setImageSearchContext(file.name);
    setVisibleResultsCount(80);
    setQuery('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      // We can also append top_k and min_score if the API takes them as form fields or query params
      // Our API takes them as query params in the new endpoint if we defined it that way
      const url = new URL(`${API_BASE}/search/image`);
      url.searchParams.append('top_k', parseInt(maxResults) === 0 ? 20000 : parseInt(maxResults));
      url.searchParams.append('min_score', parseFloat(minScore));

      const res = await fetch(url.toString(), {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      setResults(annotateDuplicates(data.results));
      setShowSearchResults(true);
      setToast({ message: `Found ${data.results?.length || 0} similar media result(s).`, type: 'success' });
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to search by image.", type: 'error' });
    } finally {
      setIsSearching(false);
    }
  };

  const handleCloseSearchResults = () => {
    setShowSearchResults(false);
    setResults([]);
    setQuery('');
    setHasSearched(false);
    setImageSearchContext(null);
    setSelectedImage(null);
    setSelectedVideoGroup(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only show the overlay if we are dragging actual files (from the OS)
    if (models.active_model && e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (!files || files.length === 0) return;

    if (!models.active_model) {
      setToast({ message: "Please select or download a model first.", type: 'error' });
      return;
    }

    // Separate paths into folders and images
    const folderPaths = [];
    const imageFiles = [];

    for (const file of files) {
      // In modern Electron, we use getPathForFile to get the absolute path
      const filePath = getPathForFile(file);
      if (!filePath) continue;

      const isDir = await isDirectory(filePath);
      if (isDir) {
        folderPaths.push(filePath);
      } else if (file.type.startsWith('image/')) {
        imageFiles.push(file);
      }
    }

    if (folderPaths.length > 0) {
      await queue.enqueueFolderIndexing(folderPaths);
    } else if (imageFiles.length > 0) {
      handleImageDrop(imageFiles[0]);
    } else {
      setToast({ message: "Please drop a folder or an image file.", type: 'error' });
    }
  };

  const handleOpenFolder = async () => {
    if (!window.electronAPI) return;
    const paths = await window.electronAPI.openDirectory();
    if (paths && paths.length > 0) {
      await queue.enqueueFolderIndexing(paths);
    }
  };

  const handleModelSwitch = async (model_name) => {
    // 1. Guard against active running/paused task
    if (queue.activeTask && (queue.activeTask.status === 'running' || queue.activeTask.status === 'paused')) {
      setModelSwitchWarning({
        isOpen: true,
        mode: 'active_task',
        targetModel: model_name
      });
      return;
    }

    // 2. Guard against queued tasks with idle worker
    if (queue.pendingCount > 0) {
      setModelSwitchWarning({
        isOpen: true,
        mode: 'queued_tasks',
        targetModel: model_name
      });
      return;
    }

    await executeModelSwitch(model_name, false);
  };

  const executeModelSwitch = async (model_name, clearQueue = false) => {
    setIsSwitchingModel(true);
    setShowSettings(false);
    setModelLoadError(null);
    setModelSwitchWarning(prev => ({ ...prev, isOpen: false }));
    // Reset search state immediately when switching models
    setResults([]);
    setHasSearched(false);
    setQuery('');
    setImageSearchContext(null);

    try {
      const res = await fetch(`${API_BASE}/models/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name, clear_queue: clearQueue })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: res.statusText }));
        const errorMessage = errorData.detail || "Failed to load model into memory.";
        setToast({ message: `Model load error: ${errorMessage}`, type: 'error' });
        setModelLoadError({ model: model_name, message: errorMessage });
        
        // Refresh models list to ensure status is accurate
        const resModels = await fetch(`${API_BASE}/models`);
        const data = await resModels.json();
        setModels(data);
        return;
      }
      // Refresh models to get correct active state and status
      const resModels = await fetch(`${API_BASE}/models`);
      const data = await resModels.json();
      setModels(data);
      setPendingModel(model_name);
      setModelLoadError(null);
      setToast({ message: `Successfully activated ${model_name.split('/').pop()}`, type: 'success' });
      queue.fetchQueue();
    } catch (err) {
      console.error(err);
      setToast({ message: `Network error while loading model: ${err.message}`, type: 'error' });
      setModelLoadError({ model: model_name, message: err.message });
    } finally {
      setIsSwitchingModel(false);
    }
  };

  const handleUnloadModel = async () => {
    setIsUnloadingModel(true);
    try {
      const res = await fetch(`${API_BASE}/models/unload`, { method: 'POST' });
      if (res.ok) {
        setToast({ message: 'Model unloaded and GPU memory freed successfully.', type: 'success' });
        // Refresh models list
        const resModels = await fetch(`${API_BASE}/models`);
        const data = await resModels.json();
        setModels(data);
      } else {
        const error = await res.json();
        setToast({ message: `Unload error: ${error.detail}`, type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to unload model.', type: 'error' });
    } finally {
      setIsUnloadingModel(false);
    }
  };

  const handleCancelDownload = async () => {
    try {
      await fetch(`${API_BASE}/models/download/cancel`, { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDownloadModel = async (model_name) => {
    lastToastedError.current = null;
    setModelLoadError(null);
    setStatus(prev => ({ ...prev, download_error: null, is_downloading: true }));
    try {
      await fetch(`${API_BASE}/models/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteModel = async (model_name) => {
    setIsDeletingModel(true);
    try {
      const res = await fetch(`${API_BASE}/models/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_name,
          delete_index: deleteIndexWithModel
        })
      });
      if (res.ok) {
        setToast({ message: `Model ${model_name} ${deleteIndexWithModel ? 'and index ' : ''}deleted successfully.`, type: 'success' });
        // Refresh models list
        const resModels = await fetch(`${API_BASE}/models`);
        const data = await resModels.json();
        setModels(data);
      } else {
        const error = await res.json();
        setToast({ message: `Error: ${error.detail}`, type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to delete model.', type: 'error' });
    } finally {
      setIsDeletingModel(false);
      setShowConfirmDeleteModel(null);
      setDeleteIndexWithModel(false);
    }
  };

  const handleClearCache = async () => {
    if (!models.active_model) return;

    setIsClearing(true);
    try {
      await fetch(`${API_BASE}/index/clear`, {
        method: 'POST'
      });
      // Reset UI cleanly
      setResults([]);
      setHasSearched(false);
      setQuery('');
      setImageSearchContext(null);
      setSelectedImage(null);
      setSelectedVideoGroup(null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsClearing(false);
      setShowConfirmClear(false);
      setShowSettings(false); // Optionally close modal on success
    }
  };

  const fetchCacheStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/image/cache/stats`);
      if (res.ok) {
        const data = await res.json();
        setCacheStats(data);
      }
    } catch (e) {
      console.error("Failed to fetch cache stats:", e);
    }
  };

  const handleClearThumbnailCache = async (target = 'all') => {
    setIsClearingThumbnails(true);
    try {
      const res = await fetch(`${API_BASE}/image/cache/clear?target=${target}`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        const label = target === 'all' ? 'All' : target === 'images' ? 'Image' : 'Video';
        setToast({ message: `${label} thumbnail cache cleared successfully.`, type: 'success' });
        fetchCacheStats();
      } else {
        setToast({ message: data.detail || 'Failed to clear thumbnail cache.', type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to clear thumbnail cache.', type: 'error' });
    } finally {
      setIsClearingThumbnails(false);
      setShowConfirmClearThumbnails(null);
    }
  };

  const handleRebuildVideoThumbnails = async () => {
    if (status.is_rebuilding_video_thumbnails || status.is_indexing || isTriggeringRebuildThumbnails) return;
    setIsTriggeringRebuildThumbnails(true);
    try {
      const res = await fetch(`${API_BASE}/video/thumbnails/regenerate`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setToast({ message: 'Video thumbnail rebuilding started in background.', type: 'info' });
        fetchCacheStats();
      } else {
        setToast({ message: data.detail || 'Failed to start video thumbnail rebuilding.', type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to connect to backend.', type: 'error' });
    } finally {
      setIsTriggeringRebuildThumbnails(false);
    }
  };



  const handleClearImageSearch = () => {
    setImageSearchContext(null);
    setResults([]);
    setHasSearched(false);
  };

  const fetchIndexedFolders = async (silent = false) => {
    if (!models.active_model) return;
    if (!silent) setIsFetchingFolders(true);
    try {
      const res = await fetch(`${API_BASE}/index/folders`);
      const data = await res.json();
      setIndexedFolders(data.folders || []);
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setIsFetchingFolders(false);
    }
  };

  const handleBrowseFolderContents = async (folder, silent = false) => {
    if (!folder) return;
    if (!silent) {
      setBrowsingFolder(folder);
      setFolderContents(null);
      setFolderVisibleLimit(60);
      setShowFolderContents(true);
      setIsFetchingFolderContents(true);
    }

    try {
      const url = new URL(`${API_BASE}/index/folder/contents`);
      url.searchParams.set('folder_path', folder.path);
      const res = await fetch(url.toString());
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to browse folder contents.');
      }

      setFolderContents(data);
    } catch (err) {
      console.error(err);
      if (!silent) {
        setToast({ message: err.message || 'Failed to browse folder contents.', type: 'error' });
        setShowFolderContents(false);
        setBrowsingFolder(null);
      }
      // Immediately refresh indexed folders to update missing status in the tree UI
      fetchIndexedFolders(true);
    } finally {
      if (!silent) {
        setIsFetchingFolderContents(false);
      }
    }
  };

  const handleCloseFolderContents = () => {
    setShowFolderContents(false);
    setBrowsingFolder(null);
    setFolderContents(null);
    setFolderVisibleLimit(60);
  };

  const handleReindexFolder = async (folder_path) => {
    try {
      const res = await fetch(`${API_BASE}/index/folder/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path })
      });
      if (res.ok) {
        setToast({ message: 'Re-indexing started in background.', type: 'success' });
      } else {
        const error = await res.json().catch(() => ({ detail: res.statusText }));
        const isMissing = error.detail?.toLowerCase().includes('invalid directory') || error.detail?.toLowerCase().includes('not exist');
        setToast({
          message: isMissing
            ? 'Folder is still not accessible on disk. Please reconnect the drive and try again.'
            : `Error: ${error.detail}`,
          type: 'error'
        });
        fetchIndexedFolders(true);
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to connect to backend for re-indexing.', type: 'error' });
      fetchIndexedFolders(true);
    }
  };

  const handleDeleteFolderIndex = async (folder_path) => {
    try {
      const res = await fetch(`${API_BASE}/index/folder/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path })
      });
      if (res.ok) {
        setToast({ message: 'Folder index removed successfully.', type: 'success' });
        setSelectedFolders(prev => prev.filter(path => path !== folder_path));
        fetchIndexedFolders();
        // Reset results as they might be stale
        setResults([]);
        setHasSearched(false);
        setImageSearchContext(null);
      } else {
        const error = await res.json();
        setToast({ message: `Error: ${error.detail}`, type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to delete folder index.', type: 'error' });
    }
  };

  const handleBatchDelete = async () => {
    if (selectedFolders.length === 0) return;
    setIsBatchProcessing(true);
    try {
      const res = await fetch(`${API_BASE}/index/folders/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_paths: selectedFolders })
      });
      if (res.ok) {
        setToast({ message: `Successfully removed ${selectedFolders.length} folders.`, type: 'success' });
        setSelectedFolders([]);
        fetchIndexedFolders();
        // Reset results as they might be stale
        setResults([]);
        setHasSearched(false);
        setImageSearchContext(null);
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Batch deletion failed.', type: 'error' });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchReindex = async () => {
    if (selectedFolders.length === 0) return;
    setIsBatchProcessing(true);
    try {
      const res = await fetch(`${API_BASE}/index/folders/batch-reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_paths: selectedFolders })
      });
      if (res.ok) {
        setToast({ message: `Re-indexing started for ${selectedFolders.length} folders.`, type: 'success' });
        setSelectedFolders([]);
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Batch re-indexing failed.', type: 'error' });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const allSelectableFolderPaths = useMemo(() => {
    return getAllSelectablePaths(indexedFolders);
  }, [indexedFolders]);

  const toggleFolderSelection = (targetPath, isSubfolder = false, parentFolder = null) => setSelectedFolders(prev => toggleFolderSelectionPure(prev, targetPath, isSubfolder, parentFolder));

  const toggleSelectAll = () => {
    if (selectedFolders.length === allSelectableFolderPaths.length && allSelectableFolderPaths.length > 0) {
      setSelectedFolders([]);
    } else {
      setSelectedFolders(allSelectableFolderPaths);
    }
  };

  // 1. Initial load & task completions (auto-updates tree and open modal)
  useEffect(() => {
    if (models.active_model) {
      fetchIndexedFolders();
      // If Folder Contents modal is currently open, refresh its contents live!
      if (showFolderContents && browsingFolder) {
        handleBrowseFolderContents(browsingFolder, true);
      }
    }
  }, [models.active_model, status.last_task_id]);

  // 2. Refresh folder existence whenever user opens/expands the Indexed Folders panel
  useEffect(() => {
    if (isFoldersExpanded && models.active_model) {
      fetchIndexedFolders(true);
    }
  }, [isFoldersExpanded, models.active_model]);

  // 3. Live Sync on Window Focus (updates folder tree AND open Folder Contents modal)
  useEffect(() => {
    const handleWindowFocus = () => {
      if (models.active_model) {
        fetchIndexedFolders(true);
        if (showFolderContents && browsingFolder) {
          handleBrowseFolderContents(browsingFolder, true);
        }
      }
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [models.active_model, showFolderContents, browsingFolder]);

  // 4. Polling while folder list is expanded (every 8 seconds)
  useEffect(() => {
    if (!isFoldersExpanded || !models.active_model) return;
    const interval = setInterval(() => {
      fetchIndexedFolders(true);
    }, 8000);
    return () => clearInterval(interval);
  }, [isFoldersExpanded, models.active_model]);

  // 5. Polling while Folder Contents modal is open (every 10 seconds)
  useEffect(() => {
    if (!showFolderContents || !browsingFolder || !models.active_model) return;
    const interval = setInterval(() => {
      handleBrowseFolderContents(browsingFolder, true);
    }, 10000);
    return () => clearInterval(interval);
  }, [showFolderContents, browsingFolder, models.active_model]);

  useEffect(() => {
    setSelectedFolders([]);
  }, [models.active_model]);

  return (
    <div
      className={cn(
        "isolate h-screen w-full overflow-y-auto overflow-x-hidden font-sans flex flex-col items-center relative pt-8 custom-scrollbar",
        uiTheme === 'terminal' ? "terminal-theme theme-terminal" : "theme-modern bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <TitleBar theme={theme} setTheme={setTheme} uiTheme={uiTheme} setUiTheme={setUiTheme} />

      {/* Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-indigo-600/20 backdrop-blur-sm flex items-center justify-center p-8 pointer-events-none animate-in fade-in duration-200">
          <div className="w-full max-w-2xl h-64 border-2 border-dashed border-indigo-400 rounded-3xl bg-neutral-900/80 flex flex-col items-center justify-center gap-4 shadow-2xl scale-110">
            <div className="icon-tile w-20 h-20 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center ring-1 ring-indigo-500/40">
              <ImageIcon className="w-10 h-10 animate-bounce" />
            </div>
            <div className="text-center">
              <h3 className="text-2xl font-bold text-white mb-2">
                {queue.activeTask || queue.pendingCount > 0
                  ? `Drop to add to Queue (#${queue.pendingCount + (queue.activeTask ? 1 : 0) + 1})`
                  : 'Drop to search or index'}
              </h3>
              <p className="text-neutral-400">
                {queue.activeTask || queue.pendingCount > 0
                  ? 'Folders will be added to the background processing queue'
                  : 'Drop images to search, or folders to start indexing'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-[480px] max-w-full animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowSettings(false)}
              className="absolute top-3 right-3 sm:top-1 sm:-right-14 z-10 p-3 bg-white/95 dark:bg-neutral-900/95 border border-gray-200 dark:border-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-white dark:hover:bg-neutral-800 rounded-2xl shadow-xl transition-all"
              title="Close settings"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 p-6 rounded-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl custom-scrollbar">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-neutral-900 dark:text-white">
                <Settings className="w-5 h-5 text-indigo-500 dark:text-indigo-400" /> Settings
              </h2>
              <div className="space-y-6">
              {/* Theme Style Selection */}
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

              <div className="pt-2">
                <label className="block text-sm font-semibold text-neutral-500 dark:text-neutral-400 mb-2">Hardware Acceleration & Batching</label>
                <div 
                  className={cn(
                    "flex items-center justify-between p-3 border rounded-xl transition-all duration-200 mb-3",
                    gpuSettings.use_gpu && gpuSettings.cuda_available
                      ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30"
                      : "bg-gray-50 dark:bg-neutral-800/30 border-gray-100 dark:border-neutral-800"
                  )}
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-neutral-700 dark:text-neutral-200">NVIDIA GPU Support</span>
                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium">
                      {gpuSettings.cuda_available 
                        ? (gpuSettings.use_gpu 
                            ? (gpuSettings.gpu_name ? `Using ${gpuSettings.gpu_name}` : "Currently using CUDA") 
                            : "Directs tasks to GPU") 
                        : "No NVIDIA GPU detected"}
                    </span>
                  </div>
                  {uiTheme === 'modern' ? (
                    <button
                      type="button"
                      onClick={handleToggleGpu}
                      disabled={!gpuSettings.cuda_available || isSwitchingGpu}
                      className={cn(
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 cursor-pointer flex-shrink-0",
                        gpuSettings.use_gpu ? "bg-indigo-600" : "bg-gray-200 dark:bg-neutral-700"
                      )}
                      aria-label={gpuSettings.use_gpu ? "Disable NVIDIA GPU support" : "Enable NVIDIA GPU support"}
                    >
                      <span
                        className={cn(
                          "inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200",
                          gpuSettings.use_gpu ? "translate-x-6" : "translate-x-1"
                        )}
                      />
                      {isSwitchingGpu && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-full">
                          <Loader2 className="w-3 h-3 text-white animate-spin" />
                        </div>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleToggleGpu}
                      disabled={!gpuSettings.cuda_available || isSwitchingGpu}
                      className="relative inline-flex h-7 w-7 items-center justify-center bg-black border border-white focus:outline-none disabled:cursor-not-allowed flex-shrink-0"
                      aria-label={gpuSettings.use_gpu ? "Disable NVIDIA GPU support" : "Enable NVIDIA GPU support"}
                    >
                      {isSwitchingGpu
                        ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                        : gpuSettings.use_gpu && <Check className="w-5 h-5 text-white" strokeWidth={3} />}
                    </button>
                  )}
                </div>

                {!gpuSettings.cuda_available && (
                  <p className="text-[10px] text-amber-500 font-medium mt-1 mb-3 px-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> CUDA-capable GPU is required for GPU acceleration.
                  </p>
                )}

                {/* Batch Size & Precision Mode Grid */}
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="p-3 border border-gray-100 dark:border-neutral-800 rounded-xl bg-gray-50/50 dark:bg-neutral-800/20">
                    <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">
                      Batch Size
                    </label>
                    {uiTheme === 'modern' ? (
                      <SettingsSelect
                        value={String(gpuSettings.batch_size ?? 0)}
                        onChange={(val) => handleUpdatePerformanceSettings({ batch_size: val })}
                        options={[
                          { value: "0", label: "Auto" },
                          { value: "1", label: "1" },
                          { value: "4", label: "4" },
                          { value: "8", label: "8" },
                          { value: "16", label: "16" },
                          { value: "32", label: "32" },
                          { value: "64", label: "64" },
                        ]}
                        disabled={isSwitchingGpu}
                      />
                    ) : (
                      <select
                        value={gpuSettings.batch_size ?? 0}
                        onChange={(e) => handleUpdatePerformanceSettings({ batch_size: e.target.value })}
                        disabled={isSwitchingGpu}
                        className="w-full text-xs p-1.5 rounded-lg bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="0">Auto</option>
                        <option value="1">1</option>
                        <option value="4">4</option>
                        <option value="8">8</option>
                        <option value="16">16</option>
                        <option value="32">32</option>
                        <option value="64">64</option>
                      </select>
                    )}
                    <span className="block text-[9px] text-neutral-400 dark:text-neutral-500 mt-1.5">
                      {gpuSettings.batch_size === 0 
                        ? `Auto mode active (Effective batch size: ${gpuSettings.effective_batch_size || 16})` 
                        : "Higher batch size increases GPU utilization."}
                    </span>
                  </div>

                  <div className="p-3 border border-gray-100 dark:border-neutral-800 rounded-xl bg-gray-50/50 dark:bg-neutral-800/20">
                    <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1.5">
                      Precision Mode
                    </label>
                    {uiTheme === 'modern' ? (
                      <SettingsSelect
                        value={gpuSettings.precision_mode || 'auto'}
                        onChange={(val) => handleUpdatePerformanceSettings({ precision_mode: val })}
                        options={[
                          { value: "auto", label: `Auto (${gpuSettings.active_precision ? gpuSettings.active_precision.toUpperCase() : 'FP32'})` },
                          { value: "fp16", label: "FP16 (Half Precision)" },
                          { value: "fp32", label: "FP32 (Full Precision)" },
                        ]}
                        disabled={isSwitchingGpu}
                      />
                    ) : (
                      <select
                        value={gpuSettings.precision_mode || 'auto'}
                        onChange={(e) => handleUpdatePerformanceSettings({ precision_mode: e.target.value })}
                        disabled={isSwitchingGpu}
                        className="w-full text-xs p-1.5 rounded-lg bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="auto">Auto ({gpuSettings.active_precision ? gpuSettings.active_precision.toUpperCase() : 'FP32'})</option>
                        <option value="fp16">FP16 (Half Precision)</option>
                        <option value="fp32">FP32 (Full Precision)</option>
                      </select>
                    )}
                    <span className="block text-[9px] text-neutral-400 dark:text-neutral-500 mt-1.5">
                      {gpuSettings.fp16_supported ? "FP16 Tensor Cores supported" : "Auto fallback to FP32 for legacy GPUs"}
                    </span>
                  </div>
                </div>

                {/* OOM Protection Badge - Only displayed if an OOM / VRAM spill event actually occurred */}
                {(gpuSettings.oom_triggered || status.oom_triggered) && (
                  <div className="mt-2.5 p-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg flex items-center justify-between text-[10px] text-amber-700 dark:text-amber-300 animate-in fade-in duration-200">
                    <span className="font-semibold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                      OOM / Memory Safety Fallback Triggered
                    </span>
                    <span className="text-[9px] opacity-90">Auto-scaled to micro-batches to protect VRAM</span>
                  </div>
                )}
              </div>

              <div className="pt-2">
                <label className="block text-sm font-semibold text-neutral-500 dark:text-neutral-400 mb-0.5">Model Management</label>
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-3 leading-relaxed italic">
                  Each model has its own index. Switching models may require reindexing.
                </p>
                {!models.models || models.models.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-neutral-600 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {models.models?.map(m => {
                      const isActive = models.active_model === m.id;
                      const isDownloading = status.is_downloading && pendingModel === m.id;

                      return (
                        <div
                          key={m.id}
                          className={cn(
                            "group flex flex-col p-4 border rounded-xl transition-all duration-200",
                            isActive
                              ? (uiTheme === 'modern'
                                  ? "bg-indigo-50/80 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/40 ring-1 ring-indigo-500/20 shadow-sm"
                                  : "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/50 ring-1 ring-indigo-500/10 dark:ring-indigo-500/20")
                              : "bg-gray-50 dark:bg-neutral-800/30 border-gray-100 dark:border-neutral-800 hover:bg-gray-100 dark:hover:bg-neutral-800/50"
                          )}
                        >
                          <div className="flex items-center justify-between gap-5">
                            <div className="min-w-0 flex-1">
                              <span
                                className={cn("block truncate whitespace-nowrap text-sm font-semibold", isActive ? "text-indigo-600 dark:text-indigo-300" : "text-neutral-700 dark:text-neutral-200")}
                                title={m.id}
                              >
                                {m.id.split('/').pop()}
                              </span>
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className={cn(
                                  "text-[10px] uppercase tracking-wider font-bold whitespace-nowrap flex items-center gap-1",
                                  m.downloaded ? "text-emerald-500/90 dark:text-emerald-400" : (isDownloading || m.incomplete) ? "text-amber-500 font-extrabold" : "text-neutral-400"
                                )}>
                                  {m.downloaded
                                    ? "Ready to use"
                                    : isDownloading
                                      ? (
                                        <span className="flex items-center gap-1">
                                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                          Downloading ({formatBytes(status.download_current_bytes)} / {formatBytes(status.download_total_bytes || m.download_total_bytes)})
                                        </span>
                                      )
                                      : m.incomplete
                                        ? (
                                          <span className="flex items-center gap-1">
                                            <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                                            Incomplete ({formatBytes(m.download_current_bytes)} / {formatBytes(m.download_total_bytes)})
                                          </span>
                                        )
                                        : "Not Downloaded"}
                                </span>
                                {isActive && (
                                  uiTheme === 'modern' ? (
                                    <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/15 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-500/30">
                                      <CheckCircle2 className="w-2.5 h-2.5" />
                                      Active
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-1 px-1.5 py-0.5 border border-white text-[9px] uppercase tracking-wider font-extrabold whitespace-nowrap">
                                      <CheckCircle2 className="w-2.5 h-2.5" />
                                      Active
                                    </span>
                                  )
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {/* Action Buttons: Activate or Checkmark */}
                              {isActive ? (
                                <button
                                  onClick={handleUnloadModel}
                                  disabled={isUnloadingModel || status.is_indexing}
                                  className={cn(
                                    "flex items-center gap-1.5 text-xs px-3 py-1.5 font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50",
                                    uiTheme === 'modern'
                                      ? "bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 rounded-xl hover:scale-105 active:scale-95"
                                      : "border border-rose-500 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                                  )}
                                  title={status.is_indexing ? "Cannot eject model while indexing is in progress" : "Unload model to free GPU VRAM"}
                                >
                                  <LogOut className="w-3.5 h-3.5" />
                                  {isUnloadingModel ? "Unloading..." : "Eject"}
                                </button>
                              ) : m.downloaded ? (
                                <button
                                  onClick={() => handleModelSwitch(m.id)}
                                  disabled={isSwitchingModel || status.is_downloading || status.is_indexing}
                                  className={cn(
                                    "text-xs px-3.5 py-1.5 font-bold transition-all disabled:opacity-50 shadow-sm cursor-pointer",
                                    uiTheme === 'modern'
                                      ? "bg-gray-100 dark:bg-neutral-800 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 text-neutral-800 dark:text-neutral-200 rounded-xl border border-gray-200 dark:border-neutral-700 hover:border-indigo-600 hover:scale-105 active:scale-95"
                                      : "border border-white bg-black text-white"
                                  )}
                                  title={status.is_indexing ? "Cannot switch model while indexing is in progress" : "Activate model"}
                                >
                                  {isSwitchingModel && pendingModel === m.id ? "..." : "Activate"}
                                </button>
                              ) : isDownloading ? (
                                <div
                                  className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 bg-amber-50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 cursor-default"
                                >
                                  <div className="flex flex-col items-end min-w-[120px]">
                                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      <span className="text-[10px] font-bold uppercase">Downloading...</span>
                                    </div>
                                    {status.download_total_bytes > 0 && (
                                      <div className="flex flex-col w-full gap-1.5 mt-1.5">
                                        <div className="terminal-progress-track w-full h-1.5 bg-gray-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                                          <div
                                            className="terminal-progress-fill h-full bg-amber-500 transition-all duration-300"
                                            style={{ width: `${(status.download_current_bytes / status.download_total_bytes) * 100}%` }}
                                          />
                                        </div>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleCancelDownload();
                                          }}
                                          className={cn(
                                            "text-[9px] font-bold uppercase self-end transition-colors transition-all",
                                            status.cancel_download
                                              ? "text-rose-500 animate-pulse cursor-default"
                                              : "text-neutral-400 dark:text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer"
                                          )}
                                          disabled={status.cancel_download}
                                        >
                                          {status.cancel_download ? 'Cancelling...' : 'Cancel'}
                                        </button>
                                      </div>
                                    )}
                                    <span className="text-[9px] text-neutral-400 dark:text-neutral-500 mt-0.5 font-mono">
                                      {formatBytes(status.download_speed)}/s
                                    </span>
                                  </div>
                                </div>
                              ) : m.incomplete ? (
                                <button
                                  onClick={() => {
                                    setPendingModel(m.id);
                                    handleDownloadModel(m.id);
                                  }}
                                  disabled={status.is_downloading}
                                  className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 shadow-sm"
                                  title="Resume interrupted download"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  Resume
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setPendingModel(m.id);
                                    handleDownloadModel(m.id);
                                  }}
                                  disabled={status.is_downloading}
                                  className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                                >
                                  Download
                                </button>
                              )}

                              {/* Delete Action (Visible for any downloaded or incomplete model when NOT downloading or indexing) */}
                              {(m.downloaded || m.incomplete) && !isDownloading && !status.is_indexing && (
                                <div className="relative ml-1">
                                  {showConfirmDeleteModel === m.id ? (
                                    <div className="flex flex-col items-end gap-1 animate-in slide-in-from-right-2 duration-200">
                                      {/* Only show "Wipe Index" checkbox for fully downloaded models that could have been used */}
                                      {m.downloaded && (
                                        <label className="flex items-center gap-1.5 cursor-pointer group/check mb-1">
                                          <input
                                            type="checkbox"
                                            checked={deleteIndexWithModel}
                                            onChange={(e) => setDeleteIndexWithModel(e.target.checked)}
                                            className="w-2.5 h-2.5 rounded border-neutral-700 bg-neutral-800 text-rose-500 focus:ring-rose-500/20"
                                          />
                                          <span className="text-[9px] text-neutral-500 group-hover/check:text-neutral-300 transition-colors">Wipe Index</span>
                                        </label>
                                      )}
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => handleDeleteModel(m.id)}
                                          disabled={isDeletingModel}
                                          className="text-[9px] px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold uppercase transition-colors"
                                        >
                                          {isDeletingModel ? "..." : "Del"}
                                        </button>
                                        <button
                                          onClick={() => setShowConfirmDeleteModel(null)}
                                          className="text-[9px] px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-white rounded font-bold uppercase transition-colors"
                                        >
                                          X
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setShowConfirmDeleteModel(m.id)}
                                      className="p-2 text-neutral-500 hover:text-rose-400 transition-colors"
                                      title={m.incomplete ? "Delete partial files" : "Delete local files"}
                                    >
                                      <Trash2 className="w-4 h-4 text-rose-500/80 hover:text-rose-500" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>


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

              <div className="pt-4 mt-6 border-t border-gray-100 dark:border-neutral-800">
                {showConfirmClear ? (
                  <div className="p-4 bg-gray-50 dark:bg-neutral-950/50 border border-rose-200 dark:border-rose-500/30 rounded-xl space-y-3 animate-in zoom-in-95 duration-200">
                    <p className="text-sm font-bold text-rose-600 dark:text-rose-300">Are you sure? This cannot be undone.</p>
                    <div className="flex gap-2">
                      <button onClick={handleClearCache} disabled={isClearing} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg py-2 text-sm font-bold flex justify-center items-center gap-2 transition-colors">
                        {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {isClearing ? 'Deleting...' : 'Yes, Delete'}
                      </button>
                      <button onClick={() => setShowConfirmClear(false)} disabled={isClearing} className="flex-1 bg-gray-200 dark:bg-neutral-800 hover:bg-gray-300 dark:hover:bg-neutral-700 text-neutral-700 dark:text-white rounded-lg py-2 text-sm font-bold transition-colors">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setShowConfirmClear(true)}
                      disabled={isClearing || !models.active_model}
                      className="w-full px-4 py-3 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm border border-rose-200 dark:border-rose-500/20"
                    >
                      {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      {isClearing ? 'Clearing Database...' : 'Clear Indexed Database'}
                    </button>
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center mt-2 font-medium">Permanently deletes all vector embeddings and hashes for the active model.</p>
                  </>
                )}
              </div>

              <div className="pt-4 mt-2 border-t border-gray-100 dark:border-neutral-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Thumbnail Cache Management</h4>
                  <span className="text-[11px] font-mono font-medium text-neutral-400 dark:text-neutral-500">Total: {cacheStats.total.formatted}</span>
                </div>

                {/* Image Thumbnails Card */}
                <div className="p-3.5 bg-gray-50/80 dark:bg-neutral-950/40 border border-gray-200/80 dark:border-neutral-800 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-indigo-500" />
                      <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">Image Thumbnails</span>
                    </div>
                    <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-md text-[11px] font-mono font-semibold border border-indigo-100 dark:border-indigo-500/20">
                      {cacheStats.images.formatted} · {cacheStats.images.count} items
                    </span>
                  </div>

                  {showConfirmClearThumbnails === 'images' ? (
                    <div className="p-3 bg-white dark:bg-neutral-900 border border-indigo-200 dark:border-indigo-500/30 rounded-xl space-y-2 animate-in zoom-in-95 duration-150">
                      <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">Clear all image thumbnails? (Images regenerate quickly on demand)</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleClearThumbnailCache('images')}
                          disabled={isClearingThumbnails}
                          className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-1.5 text-xs font-bold flex justify-center items-center gap-1.5 transition-colors"
                        >
                          {isClearingThumbnails ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                          <span>Yes, Clear Images</span>
                        </button>
                        <button
                          onClick={() => setShowConfirmClearThumbnails(null)}
                          disabled={isClearingThumbnails}
                          className="flex-1 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-white rounded-lg py-1.5 text-xs font-bold transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowConfirmClearThumbnails('images')}
                      disabled={isClearingThumbnails || cacheStats.images.count === 0}
                      className="w-full px-3 py-2 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-xs border border-indigo-200/70 dark:border-indigo-500/20"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear Image Cache</span>
                    </button>
                  )}
                </div>

                {/* Video Keyframes Card */}
                <div className="p-3.5 bg-gray-50/80 dark:bg-neutral-950/40 border border-gray-200/80 dark:border-neutral-800 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Video className="w-4 h-4 text-cyan-500" />
                      <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">Video Keyframes</span>
                    </div>
                    <span className="px-2 py-0.5 bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-md text-[11px] font-mono font-semibold border border-cyan-100 dark:border-cyan-500/20">
                      {cacheStats.videos.formatted} · {cacheStats.videos.count} frames
                    </span>
                  </div>

                  {status.is_rebuilding_video_thumbnails ? (
                    <div className="p-3.5 bg-cyan-50/70 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-500/30 rounded-xl space-y-2.5 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-xs font-bold text-cyan-700 dark:text-cyan-300">
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500" />
                          Rebuilding Video Thumbnails...
                        </span>
                        <span>
                          {status.total_video_frames_to_rebuild > 0
                            ? `${Math.round((status.rebuilt_video_frames / status.total_video_frames_to_rebuild) * 100)}%`
                            : 'Starting...'}
                        </span>
                      </div>

                      <div className="terminal-progress-track w-full bg-cyan-200/50 dark:bg-cyan-900/40 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="terminal-progress-fill bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all duration-300 ease-out"
                          style={{
                            width: `${status.total_video_frames_to_rebuild > 0 ? Math.min(100, Math.round((status.rebuilt_video_frames / status.total_video_frames_to_rebuild) * 100)) : 8}%`
                          }}
                        />
                      </div>

                      <div className="flex justify-between items-center text-[10px] text-cyan-600/80 dark:text-cyan-400/80 font-mono">
                        <span>{status.rebuilt_video_frames} of {status.total_video_frames_to_rebuild || '?'} frames cached</span>
                        <span className="animate-pulse">Active</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      {showConfirmClearThumbnails === 'videos' ? (
                        <div className="w-full p-3 bg-white dark:bg-neutral-900 border border-cyan-200 dark:border-cyan-500/30 rounded-xl space-y-2 animate-in zoom-in-95 duration-150">
                          <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">Clear video thumbnails? (Requires video decoding to recreate)</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleClearThumbnailCache('videos')}
                              disabled={isClearingThumbnails}
                              className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg py-1.5 text-xs font-bold flex justify-center items-center gap-1.5 transition-colors"
                            >
                              {isClearingThumbnails ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                              <span>Yes, Clear Videos</span>
                            </button>
                            <button
                              onClick={() => setShowConfirmClearThumbnails(null)}
                              disabled={isClearingThumbnails}
                              className="flex-1 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-white rounded-lg py-1.5 text-xs font-bold transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={handleRebuildVideoThumbnails}
                            disabled={status.is_indexing || isTriggeringRebuildThumbnails}
                            className="flex-1 px-3 py-2 bg-cyan-50 dark:bg-cyan-500/10 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 rounded-xl flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-xs border border-cyan-200/70 dark:border-cyan-500/20"
                          >
                            {isTriggeringRebuildThumbnails ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                            <span>Rebuild Videos</span>
                          </button>
                          <button
                            onClick={() => setShowConfirmClearThumbnails('videos')}
                            disabled={isClearingThumbnails || cacheStats.videos.count === 0}
                            className="px-3 py-2 bg-gray-100 dark:bg-neutral-800 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-neutral-600 dark:text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-xs border border-gray-200/80 dark:border-neutral-700"
                            title="Clear only video thumbnails"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Clear</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
      )}

      {/* Folder Contents Modal */}
      {showFolderContents && browsingFolder && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 dark:bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
          onClick={handleCloseFolderContents}
        >
          <div
            className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-3xl w-[820px] max-w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-100 dark:border-neutral-800 flex items-start justify-between bg-gray-50/50 dark:bg-neutral-900/50">
              <div className="min-w-0 pr-6">
                <div className="flex items-center gap-3">
                  <div className="icon-tile w-10 h-10 bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 rounded-xl flex items-center justify-center ring-1 ring-cyan-200 dark:ring-cyan-500/20 flex-shrink-0">
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold text-neutral-900 dark:text-white">Folder Contents</h2>
                    <p className="text-xs text-neutral-500 font-mono truncate mt-1" title={browsingFolder.path}>
                      {browsingFolder.path}
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={handleCloseFolderContents}
                className="p-2 text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {folderContents && (
              <div className="px-6 py-3 border-b border-gray-100 dark:border-neutral-800 flex flex-wrap items-center gap-2 bg-gray-50/40 dark:bg-neutral-800/20">
                <span className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-bold">
                  {folderContents.image_count} images
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 text-xs font-bold">
                  {folderContents.video_count} videos
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-bold border border-emerald-200/60 dark:border-emerald-500/30 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  {folderContents.indexed_count || 0} indexed
                </span>
                {(folderContents.unindexed_count > 0) && (
                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-bold border border-amber-200/60 dark:border-amber-500/30">
                    {folderContents.unindexed_count} unindexed
                  </span>
                )}
                {(folderContents.missing_on_disk_count > 0) && (
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 text-xs font-bold border border-rose-200/60 dark:border-rose-500/30 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-rose-500" />
                      {folderContents.missing_on_disk_count} missing from disk
                    </span>
                    <button
                      type="button"
                      disabled={isCleaningGhostRecords}
                      onClick={async () => {
                        setIsCleaningGhostRecords(true);
                        try {
                          await handleReindexFolder(browsingFolder.path);
                        } finally {
                          setIsCleaningGhostRecords(false);
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                      title="Clean ghost records by re-syncing this folder"
                    >
                      <RefreshCw className={cn("w-3 h-3", isCleaningGhostRecords && "animate-spin")} />
                      {isCleaningGhostRecords ? "Cleaning..." : "Clean Ghost Records"}
                    </button>
                  </div>
                )}
                <span className="text-xs text-neutral-500 ml-auto">
                  {folderContents.total_count} total files
                </span>
              </div>
            )}

            <div
              className="flex-1 overflow-y-auto p-4 custom-scrollbar"
              onScroll={(e) => {
                const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                if (scrollHeight - scrollTop - clientHeight < 300) {
                  setFolderVisibleLimit(prev => Math.min(prev + 40, folderContents?.items?.length || prev));
                }
              }}
            >
              {isFetchingFolderContents ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                  <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
                  <p className="text-sm text-neutral-500">Scanning folder contents...</p>
                </div>
              ) : !folderContents || folderContents.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <FolderOpen className="w-12 h-12 text-neutral-300 dark:text-neutral-700 mb-4" />
                  <h3 className="text-base font-bold text-neutral-700 dark:text-neutral-300">No supported media found</h3>
                  <p className="text-sm text-neutral-500 mt-2">This folder does not contain supported image or video files.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {folderContents.truncated && (
                    <div className="p-3 mb-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
                      Showing the first {folderContents.limit} files. The folder contains more supported media.
                    </div>
                  )}

                  {folderContents.items.slice(0, folderVisibleLimit).map((item) => {
                    const isMissing = item.exists_on_disk === false;

                    return (
                      <div
                        key={item.path}
                        className={cn(
                          "flex items-center gap-4 p-3 rounded-2xl border transition-all",
                          isMissing
                            ? "border-rose-200 dark:border-rose-500/30 bg-rose-50/40 dark:bg-rose-950/20"
                            : uiTheme === 'modern'
                            ? "border-gray-100 dark:border-neutral-800 bg-gray-50/60 dark:bg-neutral-800/20 hover:bg-gray-100/80 dark:hover:bg-neutral-800/40"
                            : "border-white bg-black hover:border-indigo-400"
                        )}
                      >
                        <FolderItemThumbnail
                          item={item}
                          API_BASE={API_BASE}
                          uiTheme={uiTheme}
                          onSelect={setSelectedImage}
                        />

                        <div
                          className={cn(
                            "min-w-0 flex-1",
                            isMissing ? "cursor-not-allowed" : "cursor-pointer"
                          )}
                          onClick={() => {
                            if (!isMissing) {
                              setSelectedImage({
                                path: item.path,
                                name: item.name,
                                media_type: item.media_type,
                                size: item.size,
                                isBrowsing: true,
                                timestamp_seconds: item.media_type === 'video' ? 1.0 : 0
                              });
                            }
                          }}
                          title={isMissing ? `${item.name} is missing on disk` : `Click to preview ${item.name}`}
                        >
                          <p className={cn(
                            "text-sm font-bold truncate",
                            isMissing
                              ? "text-rose-600 dark:text-rose-400"
                              : uiTheme === 'modern'
                              ? "text-neutral-800 dark:text-neutral-200 hover:text-indigo-600 dark:hover:text-indigo-400"
                              : "text-white"
                          )}>
                            {item.name}
                          </p>
                          <p className="text-[10px] text-neutral-500 font-mono truncate mt-1" title={item.relative_path}>
                            {item.relative_path}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Indexing Status Badges */}
                          <div className="flex items-center gap-1.5">
                            {isMissing ? (
                              <span className="inline-block px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30">
                                Missing on Disk
                              </span>
                            ) : item.is_indexed ? (
                              <span className="inline-block px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-500/30">
                                Indexed
                              </span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-neutral-700">
                                Not Indexed
                              </span>
                            )}
                          </div>

                          <div className="text-right min-w-[50px]">
                            <span className={cn(
                              "inline-block px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider",
                              item.media_type === 'video'
                                ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                                : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                            )}>
                              {item.media_type}
                            </span>
                            {!isMissing && item.size > 0 && (
                              <p className="text-[10px] text-neutral-500 mt-1">{formatBytes(item.size)}</p>
                            )}
                          </div>

                          <button
                            type="button"
                            disabled={isMissing}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (window.electronAPI?.openInExplorer) {
                                const res = await window.electronAPI.openInExplorer(item.path);
                                if (!res?.success) {
                                  setToast({ type: 'error', message: res?.error || 'Failed to open file in explorer.' });
                                }
                              }
                            }}
                            className={cn(
                              "p-2 text-neutral-400 hover:text-indigo-500 hover:bg-indigo-500/10 rounded-xl transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed",
                              uiTheme !== 'modern' && "border border-white text-white"
                            )}
                            title={isMissing ? "File is missing on disk" : "Show in Explorer"}
                          >
                            <FolderOpen className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {folderVisibleLimit < folderContents.items.length && (
                    <div className="py-3 text-center">
                      <button
                        type="button"
                        onClick={() => setFolderVisibleLimit(prev => Math.min(prev + 100, folderContents.items.length))}
                        className={cn(
                          "text-xs font-bold px-4 py-1.5 rounded-xl border transition-all",
                          uiTheme === 'modern'
                            ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-100"
                            : "border border-white text-white"
                        )}
                      >
                        Load more ({folderContents.items.length - folderVisibleLimit} remaining)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            </div>
          </div>
      )}

      {/* Header */}
      <header data-ascii-protected="true" className="w-full max-w-7xl px-6 py-8 flex gap-6 items-center flex-col md:flex-row justify-between relative mt-4">
        <div className="flex items-center gap-3">
          <div className="icon-tile w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-500/20 flex-shrink-0">
            <ImageIcon className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-indigo-600 dark:text-indigo-400">VBLIS</h1>
            </div>
            {models.active_model ? (
              <div className="mt-0.5">
                <button
                  onClick={() => setShowSettings(true)}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50/80 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-200/80 dark:border-indigo-500/20 rounded-lg transition-all hover:scale-105 active:scale-95 text-[10px] font-bold text-indigo-600 dark:text-indigo-300 cursor-pointer shadow-sm"
                  title={`Active Vision Engine: ${models.active_model} (Click to manage models)`}
                >
                  <div className="model-status-dot model-status-dot-online w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" aria-hidden="true" />
                  <span className="font-mono text-[10px] truncate max-w-[200px]">{models.active_model.split('/').pop()}</span>
                </button>
              </div>
            ) : (
              <div className="mt-0.5">
                <button
                  onClick={() => setShowSettings(true)}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-amber-50/80 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-200/80 dark:border-amber-500/20 rounded-lg transition-all hover:scale-105 active:scale-95 text-[10px] font-bold text-amber-600 dark:text-amber-400 cursor-pointer shadow-sm"
                  title="No model currently loaded into memory. Click to select and activate a model in Settings."
                >
                  <div className="model-status-dot model-status-dot-offline w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" aria-hidden="true" />
                  <span className="font-mono text-[10px] tracking-wider uppercase">No Model Loaded</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSearch} className="flex-1 max-w-2xl w-full relative group flex gap-2">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              {isSearching ? <Loader2 className="w-5 h-5 text-neutral-400 dark:text-neutral-500 animate-spin" /> : <Search className="w-5 h-5 text-neutral-400 dark:text-neutral-500 group-focus-within:text-indigo-600 dark:group-focus-within:text-indigo-400 transition-colors" />}
            </div>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search images (e.g. 'golden retriever')..."
              className="w-full bg-white dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-800 rounded-2xl py-4 pl-12 pr-12 text-base outline-none transition-all duration-300 focus:bg-white dark:focus:bg-neutral-900 focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 shadow-xl shadow-black/5 dark:shadow-black/20 text-neutral-900 dark:text-white"
            />
            {query.length > 0 && (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
                className="absolute inset-y-0 right-3 flex items-center justify-center px-2"
                aria-label="Clear search text"
                title="Clear search text"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl transition-all hover:scale-105 active:scale-95 font-medium text-sm shadow-lg shadow-indigo-500/20"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2">
          <QueueStatusBadge queue={queue} uiTheme={uiTheme} />
          <button
            onClick={() => setShowSettings(true)}
            className="p-3 bg-white dark:bg-neutral-900/80 hover:bg-gray-50 dark:hover:bg-neutral-800 border border-gray-200 dark:border-neutral-800 rounded-xl transition-all hover:rotate-45 active:scale-95 text-neutral-500 hover:text-neutral-900 dark:hover:text-white shadow-sm dark:shadow-none"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Global Status Bar */}
      {(status.is_indexing || queue.activeTask || (queue.pendingCount > 0 && queue.workerState === 'paused')) && (() => {
        const isQueuePaused = status.is_paused || queue.activeTask?.is_paused || queue.activeTask?.status === 'paused' || queue.workerState === 'paused';
        const displayTask = queue.activeTask || queue.pendingTasks[0];
        const isMissingModel = (queue.modelMismatch?.reason === 'no_model_loaded') || (!queue.activeModel && (queue.pendingCount > 0 || Boolean(queue.activeTask)));
        const isModelMismatch = queue.modelMismatch?.reason === 'model_difference';
        const progressPct = queue.activeTask ? queue.activeTask.progress : (displayTask ? displayTask.progress : Math.round(status.percent));
        const processedCount = queue.activeTask ? queue.activeTask.processed_count : (displayTask ? displayTask.processed_count : 0);
        const totalCount = queue.activeTask ? (queue.activeTask.total_count || 0) : (displayTask ? (displayTask.total_count || 0) : 0);

        return (
          <div className="w-full max-w-7xl px-6 mb-6 animate-in slide-in-from-top-4 duration-500">
            <div
              className={cn(
                "border rounded-2xl p-4 flex flex-col gap-2.5 relative transition-all duration-300 shadow-sm",
                isMissingModel
                  ? "bg-rose-50/80 dark:bg-rose-950/30 border-rose-300 dark:border-rose-500/30 text-rose-900 dark:text-rose-200"
                  : isModelMismatch
                  ? "bg-amber-50/90 dark:bg-amber-950/40 border-amber-300 dark:border-amber-500/40 text-amber-950 dark:text-amber-200"
                  : isQueuePaused
                  ? "bg-amber-50/80 dark:bg-amber-950/30 border-amber-300 dark:border-amber-500/30 text-amber-900 dark:text-amber-200"
                  : "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-500/20 text-indigo-900 dark:text-indigo-200"
              )}
            >
              <div className="flex justify-between items-center text-sm font-bold">
                <div className="flex items-center gap-2.5 min-w-0">
                  {isMissingModel ? (
                    <div className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 shrink-0">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                  ) : isModelMismatch ? (
                    <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                  ) : isQueuePaused ? (
                    <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                      <Pause className="w-4 h-4" />
                    </div>
                  ) : (
                    <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 shrink-0">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  )}
                  <span className="truncate">
                    {displayTask?.title || "Indexing Media"}
                    {" "}
                    <span className="font-mono text-xs opacity-75 font-normal ml-1">
                      ({processedCount}/{totalCount || status.progress || 0})
                    </span>
                  </span>

                  {isMissingModel ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-rose-200/80 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30 shrink-0">
                      NO MODEL LOADED
                    </span>
                  ) : isModelMismatch ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-200/80 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-500/30 shrink-0">
                      MODEL MISMATCH
                    </span>
                  ) : isQueuePaused ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-200/80 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 shrink-0">
                      PAUSED
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="font-mono text-xs font-bold">
                    {progressPct}%
                  </span>

                  {/* Pause / Resume Button */}
                  {isQueuePaused ? (
                    <button
                      onClick={() => {
                        if (isMissingModel) {
                          setToast({
                            message: 'Cannot resume queue: No AI model is currently loaded in memory. Please select a model in Settings.',
                            type: 'error'
                          });
                          setShowSettings(true);
                          return;
                        }
                        if (queue.activeTask) {
                          queue.resumeTask(queue.activeTask.id);
                        }
                        if (queue.workerState === 'paused') {
                          if (queue.modelMismatch?.reason === 'model_difference') {
                            queue.controlWorker('start', true);
                          } else {
                            queue.controlWorker('start');
                          }
                        }
                      }}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold rounded-lg transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                      title={isModelMismatch ? `Resume and proceed with active model (${queue.modelMismatch.active_model?.split('/').pop()})` : "Resume indexing"}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{isModelMismatch ? "Adopt & Resume" : "Resume"}</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (queue.activeTask) {
                          queue.pauseTask(queue.activeTask.id);
                        } else {
                          queue.controlWorker('pause_immediate');
                        }
                      }}
                      className="px-2.5 py-1 bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 text-xs font-bold rounded-lg transition-all border border-gray-200 dark:border-neutral-700 flex items-center gap-1.5 cursor-pointer"
                      title="Pause indexing"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause</span>
                    </button>
                  )}

                  {/* Cancel Button */}
                  <button
                    onClick={() => {
                      if (queue.activeTask) {
                        queue.cancelTask(queue.activeTask.id);
                      } else if (queue.pendingTasks.length > 0) {
                        queue.cancelTask(queue.pendingTasks[0].id);
                      } else {
                        handleCancelIndexing();
                      }
                    }}
                    disabled={isCancellingIndexing || status.cancel_requested}
                    className="px-2.5 py-1 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 text-xs font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Stop and cancel current task"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{isCancellingIndexing || status.cancel_requested ? "Cancelling..." : "Cancel"}</span>
                  </button>
                </div>
              </div>

              {/* Progress Track */}
              <div className="terminal-progress-track w-full h-2 bg-gray-200 dark:bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "terminal-progress-fill h-full transition-all duration-300 ease-out",
                    isMissingModel
                      ? "bg-rose-500"
                      : isModelMismatch || isQueuePaused
                      ? "bg-amber-500"
                      : "bg-gradient-to-r from-indigo-500 to-cyan-500"
                  )}
                  style={{ width: `${Math.min(100, Math.max(2, progressPct))}%` }}
                />
              </div>

              <div className="flex justify-between items-center text-xs text-neutral-500 dark:text-neutral-400 font-medium pt-0.5 gap-3">
                <p className="flex-1 min-w-0 font-mono text-[11px] leading-snug" title={displayTask?.current_item || status.current_file}>
                  {isMissingModel
                    ? `No AI model loaded. Select a model in Settings to resume.`
                    : isModelMismatch
                    ? `Queued for '${queue.modelMismatch.queued_model?.split('/').pop()}', active: '${queue.modelMismatch.active_model?.split('/').pop()}'. Click Resume to adopt active model.`
                    : isQueuePaused
                    ? `Paused at: ${displayTask?.current_item || status.current_file || "Current item"}`
                    : `Processing: ${displayTask?.current_item || status.current_file || "Preparing..."}`}
                </p>
                <button
                  onClick={() => queue.setIsDrawerOpen(true)}
                  className="px-2 py-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 ml-2 rounded-md border border-indigo-200/50 dark:border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                >
                  View in Task Queue →
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Indexing Errors Alert */}
      {showErrorAlert && status.failed_files && status.failed_files.length > 0 && (
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
      )}

      {modelLoadError && !status.is_downloading && (
        <div className="w-full max-w-7xl px-6 mb-6 animate-in slide-in-from-top-4 duration-500">
          <div className="bg-gradient-to-r from-rose-500/10 via-rose-500/5 to-transparent border border-rose-500/30 dark:border-rose-500/20 rounded-2xl p-4 flex flex-col gap-3 relative text-rose-800 dark:text-rose-200 shadow-sm">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="icon-tile w-9 h-9 bg-rose-100 dark:bg-rose-500/20 rounded-xl flex items-center justify-center flex-shrink-0 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">
                    Model Failed to Load: {modelLoadError.model ? modelLoadError.model.split('/').pop() : 'Vision Model'}
                  </h3>
                  <p className="text-xs text-rose-700/80 dark:text-rose-300/80 font-medium">
                    The vision model weights or configuration could not be initialized into memory.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const targetModel = modelLoadError.model || pendingModel;
                    setModelLoadError(null);
                    setPendingModel(targetModel);
                    handleDownloadModel(targetModel);
                  }}
                  className="text-xs px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry / Resume
                </button>
                <button
                  onClick={() => setModelLoadError(null)}
                  className="p-1.5 text-rose-400 hover:text-rose-600 dark:hover:text-rose-200 rounded-lg transition-colors cursor-pointer"
                  title="Dismiss error"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="text-[11px] font-mono bg-white/80 dark:bg-neutral-900/60 p-2.5 rounded-xl border border-rose-200 dark:border-rose-500/20 break-all text-rose-800 dark:text-rose-300">
              {modelLoadError.message}
            </div>
          </div>
        </div>
      )}

      {status.is_downloading && (
        <div className="w-full max-w-7xl px-6 mb-6 animate-in slide-in-from-top-4 duration-500">
          <div className="bg-gradient-to-r from-emerald-500/5 to-transparent dark:from-emerald-500/10 dark:to-transparent border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-4 flex flex-col gap-2 relative text-emerald-700 dark:text-emerald-300">
            <div className="flex justify-between items-center text-sm font-bold">
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {status.is_loading_model
                    ? "Finalizing & Loading AI Vision Engine..."
                    : (status.download_total_bytes > 0 && status.download_current_bytes >= status.download_total_bytes)
                      ? "Verifying & Finalizing download..."
                      : `Downloading AI Vision Engine: ${pendingModel.split('/').pop()}`}
                </span>
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCancelDownload}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded border transition-all font-bold uppercase",
                    status.cancel_download
                      ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-500 animate-pulse cursor-default font-extrabold"
                      : "bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 border-gray-200 dark:border-neutral-700 shadow-sm dark:shadow-none"
                  )}
                  disabled={status.cancel_download}
                >
                  {status.cancel_download ? 'Cancelling...' : 'Cancel'}
                </button>
                <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  {status.is_loading_model
                    ? '99%'
                    : status.download_total_bytes > 0
                      ? `${Math.round((status.download_current_bytes / status.download_total_bytes) * 100)}%`
                      : 'Starting...'}
                </span>
              </div>
            </div>

            <div className="w-full h-1.5 bg-gray-100 dark:bg-neutral-900 rounded-full overflow-hidden">
              <div
                className="terminal-progress-fill h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 ease-out"
                style={{
                  width: status.is_loading_model
                    ? '99.5%'
                    : status.download_total_bytes > 0
                      ? `${(status.download_current_bytes / status.download_total_bytes) * 100}%`
                      : '0%'
                }}
              />
            </div>

            {!status.is_loading_model && (
              <div className="flex justify-between items-center mt-1">
                <div className="flex gap-4">
                  <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">
                    Size: {formatBytes(status.download_current_bytes)} / {formatBytes(status.download_total_bytes)}
                  </span>
                  {status.download_current_bytes < status.download_total_bytes && (
                    <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">
                      Speed: {formatBytes(status.download_speed)}/s
                    </span>
                  )}
                </div>
                {status.download_current_bytes < status.download_total_bytes && (
                  <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">
                    ETA: {formatDuration(status.download_eta)}
                  </span>
                )}
              </div>
            )}

            {status.is_loading_model && (
              <div className="mt-1">
                <p className="text-[10px] uppercase tracking-wider font-bold opacity-70">
                  Warming up tensors in memory...
                </p>
              </div>
            )}
          </div>
        </div>
      )}



      {/* Returned video frames grouped by their source video */}
      {selectedVideoGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 dark:bg-black/85 backdrop-blur-md p-6 animate-in fade-in duration-200"
          onClick={() => setSelectedVideoGroup(null)}
        >
          <div
            className={cn(
              "flex max-h-[86vh] w-full max-w-6xl flex-col shadow-2xl",
              uiTheme === 'modern'
                ? "bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-3xl overflow-hidden"
                : "border border-white bg-black"
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={cn(
              "flex items-start gap-4 p-5",
              uiTheme === 'modern' ? "border-b border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-900/50" : "border-b border-white"
            )}>
              <div className={cn(
                "flex h-12 w-12 flex-shrink-0 items-center justify-center",
                uiTheme === 'modern' ? "rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-200 dark:ring-indigo-500/20" : "icon-tile border border-white text-white"
              )}>
                <FolderOpen className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className={cn("text-xl font-bold break-all", uiTheme === 'modern' ? "text-neutral-900 dark:text-white" : "text-white")}>{selectedVideoGroup.name}</h2>
                <p className={cn("mt-1 text-xs break-all font-mono", uiTheme === 'modern' ? "text-neutral-500 dark:text-neutral-400" : "text-white/80")}>{selectedVideoGroup.path}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                  <span className={cn(
                    "px-2.5 py-1",
                    uiTheme === 'modern' ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-lg border border-indigo-100 dark:border-indigo-500/20" : "border border-white text-white"
                  )}>
                    {selectedVideoGroup.frames.length} RETURNED FRAME{selectedVideoGroup.frames.length === 1 ? '' : 'S'}
                  </span>
                  <span className={cn(
                    "px-2.5 py-1",
                    uiTheme === 'modern' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-100 dark:border-emerald-500/20" : "border border-white text-emerald-400"
                  )}>
                    BEST MATCH {Math.round(selectedVideoGroup.bestScore * 100)}%
                  </span>
                </div>
              </div>
              {window.electronAPI && (
                <button
                  onClick={async () => {
                    const response = await window.electronAPI.openInExplorer(selectedVideoGroup.path);
                    if (response && !response.success) {
                      setToast({ message: 'This video has been moved or deleted and is no longer available.', type: 'error' });
                    }
                  }}
                  className={cn(
                    "flex flex-shrink-0 items-center gap-2 px-4 py-2.5 font-bold text-xs transition-all",
                    uiTheme === 'modern'
                      ? "bg-gray-100 dark:bg-neutral-800 hover:bg-gray-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 rounded-xl border border-gray-200 dark:border-neutral-700"
                      : "border border-white text-white"
                  )}
                >
                  <FolderOpen className="w-4 h-4" />
                  Show in Explorer
                </button>
              )}
              <button
                onClick={() => setSelectedVideoGroup(null)}
                className={cn(
                  "flex h-10 w-10 flex-shrink-0 items-center justify-center transition-all",
                  uiTheme === 'modern'
                    ? "rounded-xl text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800"
                    : "icon-tile border border-white text-white"
                )}
                aria-label="Close video results"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="custom-scrollbar overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {selectedVideoGroup.frames.map((frame, index) => (
                  <VideoFrameCard
                    key={frame.id || `${frame.path}:${frame.timestamp_seconds || 0}:${index}`}
                    frame={frame}
                    index={index}
                    API_BASE={API_BASE}
                    onSelect={(f) => {
                      setSelectedImage(f);
                    }}
                    uiTheme={uiTheme}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-6 py-8 overflow-y-auto animate-in fade-in duration-200 custom-scrollbar"
          onClick={() => setSelectedImage(null)}
        >
          <div className="fixed top-12 right-6 flex gap-4 z-[90]">
            {window.electronAPI && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const res = await window.electronAPI.openInExplorer(selectedImage.path);
                  if (res && !res.success) {
                    setToast({ message: 'This file has been moved or deleted and is no longer available.', type: 'error' });
                  }
                }}
                className="px-4 py-2 bg-white/20 dark:bg-neutral-800/80 hover:bg-white/30 dark:hover:bg-neutral-700 text-white rounded-xl flex items-center gap-2 transition-all font-bold backdrop-blur-md border border-white/20 dark:border-neutral-700"
              >
                <FolderOpen className="w-4 h-4" />
                Show in Explorer
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImage(null);
              }}
              className="p-2 bg-white/20 dark:bg-neutral-800/80 hover:bg-white/30 dark:hover:bg-neutral-700 text-white rounded-xl transition-all backdrop-blur-md border border-white/20 dark:border-neutral-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <img
            src={getMediaPreviewUrl(API_BASE, selectedImage, 'full')}
            alt={selectedImage.media_type === 'video' ? `Video frame at ${formatVideoTimestamp(selectedImage.timestamp_seconds)}` : 'Full size result'}
            className={cn(
              "max-w-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300",
              selectedImage.isDuplicate ? "max-h-[70vh]" : "max-h-[80vh]"
            )}
            onClick={(e) => e.stopPropagation()}
          />

          <div className="mt-6 text-center" onClick={(e) => e.stopPropagation()}>
            {!selectedImage.isBrowsing && selectedImage.score !== undefined && (
              <p className="text-xl font-medium text-white mb-2">
                Match Score: {Math.round(selectedImage.score * 100)}%
              </p>
            )}
            {selectedImage.isBrowsing && (
              <div className="mb-2">
                <p className="text-xl font-medium text-white truncate max-w-3xl px-4 mx-auto" title={selectedImage.name || selectedImage.path}>
                  {selectedImage.name || selectedImage.path?.split('\\').pop().split('/').pop()}
                </p>
                {selectedImage.size ? (
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">{formatBytes(selectedImage.size)}</p>
                ) : null}
              </div>
            )}
            {selectedImage.media_type === 'video' && (
              <p className={cn(
                "mb-3 inline-flex items-center gap-2 px-3.5 py-1 text-xs font-bold",
                uiTheme === 'modern'
                  ? "bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 rounded-full backdrop-blur-md shadow-lg"
                  : "bg-cyan-500/15 border border-cyan-400/30 text-cyan-300"
              )}>
                <Video className="w-4 h-4" />
                Video frame at {formatVideoTimestamp(selectedImage.timestamp_seconds)}
              </p>
            )}
            {selectedImage.isDuplicate && (
              uiTheme === 'modern' ? (
                <div 
                  className="mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold animate-in zoom-in-95 duration-300 shadow-xl border backdrop-blur-md"
                  style={{ 
                    backgroundColor: `${selectedImage.dupeColor || '#6366f1'}25`,
                    borderColor: `${selectedImage.dupeColor || '#6366f1'}60`,
                    color: selectedImage.dupeColor || '#a5b4fc',
                    boxShadow: `0 0 20px -5px ${selectedImage.dupeColor || '#6366f1'}40`
                  }}
                >
                  {selectedImage.duplicateType === 'exact' ? <Copy className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>
                    {selectedImage.duplicateType === 'exact' ? 'Exact File Copy' : 'Visual Duplicate (98.5%+ Similarity)'} detected in {selectedImage.otherPaths.length} other location{selectedImage.otherPaths.length > 1 ? 's' : ''}
                  </span>
                </div>
              ) : (
                <div className="mb-4 inline-flex items-center gap-2 px-3.5 py-1.5 bg-black border border-white text-white rounded-none text-xs font-bold animate-in zoom-in-95 duration-300 shadow-lg">
                  {selectedImage.duplicateType === 'exact' ? <Copy className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>
                    {selectedImage.duplicateType === 'exact' ? 'Exact File Copy' : 'Visual Duplicate (98.5%+ Similarity)'} detected in {selectedImage.otherPaths.length} other location{selectedImage.otherPaths.length > 1 ? 's' : ''}
                  </span>
                </div>
              )
            )}
            <p className={cn(
              "text-xs break-all max-w-3xl mx-auto",
              uiTheme === 'modern' ? "text-neutral-300 font-sans" : "text-neutral-400 font-mono"
            )}>
              {selectedImage.path}
            </p>
            {selectedImage.isDuplicate && (
              <div className="mt-2 space-y-1.5">
                {selectedImage.otherPaths.map(p => (
                  <div
                    key={p}
                    className={cn(
                      "text-[11px] break-all max-w-2xl mx-auto flex items-center justify-center gap-1.5 flex-wrap",
                      uiTheme === 'modern' ? "text-neutral-400 font-sans" : "text-neutral-400 font-mono"
                    )}
                  >
                    <span className="opacity-75">Also found at:</span>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (window.electronAPI?.openInExplorer) {
                          const res = await window.electronAPI.openInExplorer(p);
                          if (!res?.success) {
                            setToast({ type: 'error', message: res?.error || 'Failed to open file in explorer.' });
                          }
                        }
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 cursor-pointer transition-all break-all text-left group",
                        uiTheme === 'modern'
                          ? "text-indigo-300 hover:text-indigo-200 underline underline-offset-2 hover:opacity-100 opacity-90"
                          : "text-white hover:underline underline-offset-2"
                      )}
                      title={`Show ${p} in Explorer`}
                    >
                      <FolderOpen className="w-3 h-3 flex-shrink-0 inline group-hover:scale-110 transition-transform" />
                      <span>{p}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global toast notification system */}
      {toast && (
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
          <button onClick={() => setToast(null)} className={cn(
            "ml-2 transition-colors flex-shrink-0 p-1 rounded-lg hover:bg-white/10",
            toast.type === 'success' ? "text-emerald-400 hover:text-emerald-100" : "text-rose-400 hover:text-rose-100"
          )}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
      )}

      {/* Inline / Floating Folder Manager */}
      {models.active_model && (
        <section data-ascii-protected="true" className="w-full max-w-7xl px-6 mb-3 relative z-30">
          <div
            ref={foldersRef}
            className="bg-white dark:bg-neutral-900/70 border border-gray-200 dark:border-neutral-800 rounded-3xl shadow-xl shadow-black/5 dark:shadow-black/20 transition-all duration-200"
          >
            <div
              className="px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-indigo-500/5 dark:bg-indigo-500/10 cursor-pointer select-none transition-colors hover:bg-indigo-500/10 dark:hover:bg-indigo-500/15 rounded-3xl"
              onClick={() => setIsFoldersExpanded(prev => !prev)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="icon-tile w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-500/20 flex-shrink-0">
                  <FolderOpen className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-neutral-900 dark:text-white">Indexed Folders</h2>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-[10px] font-extrabold border border-indigo-200/60 dark:border-indigo-500/30">
                      {indexedFolders.length}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {isFoldersExpanded ? "Browse, re-sync, or remove folders from the active model index." : "Click to view and manage indexed folders"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={handleOpenFolder}
                  className="flex items-center justify-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all hover:scale-[1.02] active:scale-95 text-xs font-bold shadow-md shadow-indigo-500/20 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" />
                  Add Folder(s)
                </button>
                <button
                  type="button"
                  onClick={() => setIsFoldersExpanded(prev => !prev)}
                  className="p-2 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all cursor-pointer"
                  title={isFoldersExpanded ? "Collapse folders" : "Expand folders"}
                  aria-expanded={isFoldersExpanded}
                >
                  {isFoldersExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {isFoldersExpanded && (
              <div
                className={cn(
                  "animate-in slide-in-from-top-2 fade-in duration-200 absolute top-[calc(100%+8px)] left-6 right-6 z-40 overflow-hidden",
                  uiTheme === 'modern'
                    ? "bg-white/95 dark:bg-neutral-900/95 backdrop-blur-2xl border border-gray-200 dark:border-neutral-800 rounded-3xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
                    : "bg-white dark:bg-black border border-black dark:border-white shadow-2xl"
                )}
              >
                {indexedFolders.length > 0 && (
                  <div className="px-6 py-3 bg-gray-50/70 dark:bg-neutral-800/20 border-b border-gray-100 dark:border-neutral-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                    >
                      {selectedFolders.length === allSelectableFolderPaths.length && allSelectableFolderPaths.length > 0
                        ? <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        : <Square className="w-4 h-4" />}
                      {selectedFolders.length === allSelectableFolderPaths.length && allSelectableFolderPaths.length > 0 ? 'Deselect All' : 'Select All'}
                    </button>

                    <div className="flex items-center gap-2 min-h-8">
                      {selectedFolders.length > 0 ? (
                        <>
                          <span className="text-[10px] text-neutral-500 font-bold mr-1">{selectedFolders.length} SELECTED</span>
                          <button
                            type="button"
                            onClick={handleBatchReindex}
                            disabled={isBatchProcessing || status.is_indexing}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                          >
                            <RefreshCw className={cn("w-3.5 h-3.5", isBatchProcessing && "animate-spin")} />
                            Reindex
                          </button>
                          <button
                            type="button"
                            onClick={handleBatchDelete}
                            disabled={isBatchProcessing || status.is_indexing}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </>
                      ) : (
                        <span className="text-[11px] text-neutral-500 italic">Select folders for batch actions</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="p-4 max-h-[380px] overflow-y-auto custom-scrollbar">
                  {isFetchingFolders && indexedFolders.length === 0 ? (
                    <div className="flex items-center justify-center gap-3 py-12 text-neutral-500">
                      <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                      <span className="text-sm font-medium">Fetching folders...</span>
                    </div>
                  ) : indexedFolders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                      <div className="icon-tile w-14 h-14 bg-gray-100 dark:bg-neutral-800 rounded-2xl flex items-center justify-center mb-4">
                        <FolderOpen className="w-7 h-7 text-neutral-400 dark:text-neutral-600" />
                      </div>
                      <h3 className="text-base font-bold text-neutral-800 dark:text-neutral-300">No folders selected</h3>
                      <p className="text-sm text-neutral-500 mt-2 max-w-md">Add a folder to index images and sample videos at two-second intervals.</p>
                    </div>
                  ) : (
                    <IndexedFolderTree
                      folders={indexedFolders}
                      selectedPaths={selectedFolders}
                      onToggleSelection={toggleFolderSelection}
                      onBrowse={handleBrowseFolderContents}
                      onReindex={handleReindexFolder}
                      onDelete={handleDeleteFolderIndex}
                      isIndexing={status.is_indexing}
                      uiTheme={uiTheme}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Main Content Area */}
      <main className="w-full max-w-7xl px-6 pb-24 flex-1">
        {imageSearchContext && (
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
        )}

        {results.length === 0 && !isSearching && hasSearched && models.active_model && !isSwitchingModel && query.length > 0 && (
          <div className="flex flex-col items-center justify-center mt-32 opacity-50">
            <Search className="w-16 h-16 mb-4 text-neutral-400 dark:text-neutral-600" />
            <p className="text-xl mb-1 text-neutral-800 dark:text-neutral-300 font-bold">No matches found</p>
            <p className="text-sm text-neutral-500 dark:text-neutral-500 font-medium">Try a different query or index more images.</p>
          </div>
        )}

        {(!backendReady || isSwitchingModel) && !status.is_downloading && (
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
        )}

        {backendReady && !isSwitchingModel && !models.active_model && !status.is_downloading && results.length === 0 && (() => {
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
        })()}

        {models.active_model && !isSearching && query.length === 0 && results.length === 0 && !isSwitchingModel && (
          uiTheme === 'terminal' ? (
            <div className="flex flex-col items-center justify-center mt-3 gap-2 animate-in fade-in duration-1000">
              <RotatingAsciiLogo />
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
        )}

        {/* In-page results grid for Modern theme */}
        {results.length > 0 && uiTheme === 'modern' && (
          <div className="w-full max-w-7xl animate-in fade-in duration-300 mt-2">
            {/* Video Matches */}
            {videoGroups.length > 0 && (
              <section className={imageResults.length > 0 ? 'mb-10' : ''}>
                <div className="mb-4 flex items-center gap-2.5 text-neutral-800 dark:text-neutral-200 border-b border-gray-100 dark:border-neutral-800 pb-3">
                  <FolderOpen className="w-5 h-5 text-indigo-500" />
                  <h3 className="text-lg font-bold">Video Results</h3>
                  <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-bold border border-indigo-100 dark:border-indigo-500/20">
                    {videoGroups.length}
                  </span>
                  <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500 font-medium">Sorted by best match</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {videoGroups.map((group, idx) => (
                    <VideoResultFolder
                      key={group.path}
                      group={group}
                      idx={idx}
                      API_BASE={API_BASE}
                      onSelect={setSelectedVideoGroup}
                      uiTheme={uiTheme}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Image Matches */}
            {imageResults.length > 0 && (
              <section>
                {videoGroups.length > 0 && (
                  <div className="mb-4 flex items-center gap-2.5 text-neutral-800 dark:text-neutral-200 border-b border-gray-100 dark:border-neutral-800 pb-3">
                    <ImageIcon className="w-5 h-5 text-indigo-500" />
                    <h3 className="text-lg font-bold">Image Results</h3>
                    <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-bold border border-indigo-100 dark:border-indigo-500/20">
                      {imageResults.length}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {visibleImageResults.map((res, idx) => (
                    <SearchResult
                      key={res.id || res.path}
                      res={res}
                      idx={idx}
                      API_BASE={API_BASE}
                      onSelect={setSelectedImage}
                      uiTheme={uiTheme}
                    />
                  ))}
                </div>

                {imageResults.length > visibleResultsCount && (
                  <div ref={sentinelRef} className="mt-8 mb-4 flex flex-col items-center justify-center gap-2 py-4">
                    <button
                      type="button"
                      onClick={() => setVisibleResultsCount(prev => Math.min(prev + 80, imageResults.length))}
                      className="px-6 py-2.5 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold text-xs rounded-2xl border border-indigo-200 dark:border-indigo-500/30 transition-all shadow-sm hover:shadow-md cursor-pointer flex items-center gap-2"
                    >
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Loading more results ({visibleResultsCount} of {imageResults.length})</span>
                    </button>
                    <span className="text-[11px] text-neutral-400 dark:text-neutral-500 font-mono">
                      Showing {visibleResultsCount} of {imageResults.length} matches
                    </span>
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {/* Terminal Modal Console for Terminal theme */}
        {showSearchResults && results.length > 0 && uiTheme === 'terminal' && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 p-6 animate-in fade-in duration-200"
            onClick={handleCloseSearchResults}
          >
            <div
              className="flex max-h-[86vh] w-full max-w-7xl flex-col border border-white bg-black"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-4 border-b border-white p-5">
                <Search className="w-6 h-6 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold">Search Results</h2>
                  <p className="mt-1 truncate text-sm">
                    {imageSearchContext ? `IMAGE: ${imageSearchContext}` : `QUERY: ${query}`}
                  </p>
                </div>
                <span className="border border-white px-3 py-2 text-sm font-bold">
                  {results.length} MATCH{results.length === 1 ? '' : 'ES'}
                </span>
                <button
                  onClick={handleCloseSearchResults}
                  className="icon-tile flex h-12 w-12 flex-shrink-0 items-center justify-center border border-white"
                  aria-label="Close search results"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="custom-scrollbar overflow-y-auto p-6">
                {videoGroups.length > 0 && (
                  <section className={imageResults.length > 0 ? 'mb-10' : ''}>
                    <div className="mb-4 flex items-center gap-3 border-b border-white pb-3">
                      <FolderOpen className="w-5 h-5" />
                      <h3 className="text-lg font-bold">Video Results</h3>
                      <span className="border border-white px-2 py-0.5 text-xs font-bold">{videoGroups.length}</span>
                      <span className="ml-auto text-xs">SORTED BY BEST MATCH</span>
                    </div>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                      {videoGroups.map((group, idx) => (
                        <VideoResultFolder
                          key={group.path}
                          group={group}
                          idx={idx}
                          API_BASE={API_BASE}
                          onSelect={setSelectedVideoGroup}
                          uiTheme={uiTheme}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {imageResults.length > 0 && (
                  <section>
                    {videoGroups.length > 0 && (
                      <div className="mb-4 flex items-center gap-3 border-b border-white pb-3">
                        <ImageIcon className="w-5 h-5" />
                        <h3 className="text-lg font-bold">Image Results</h3>
                        <span className="border border-white px-2 py-0.5 text-xs font-bold">{imageResults.length}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                      {visibleImageResults.map((res, idx) => (
                        <SearchResult
                          key={res.id || res.path}
                          res={res}
                          idx={idx}
                          API_BASE={API_BASE}
                          onSelect={setSelectedImage}
                          uiTheme={uiTheme}
                        />
                      ))}
                    </div>

                    {imageResults.length > visibleResultsCount && (
                      <div ref={sentinelTerminalRef} className="mt-8 mb-4 flex flex-col items-center justify-center gap-2 py-4">
                        <button
                          type="button"
                          onClick={() => setVisibleResultsCount(prev => Math.min(prev + 80, imageResults.length))}
                          className="px-6 py-2.5 bg-black border border-white text-white hover:bg-white hover:text-black font-bold text-xs transition-all cursor-pointer flex items-center gap-2"
                        >
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>LOAD MORE ({visibleResultsCount} OF {imageResults.length})</span>
                        </button>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Background Task Queue Drawer */}
      <QueueDrawer
        isOpen={queue.isDrawerOpen}
        onClose={() => queue.setIsDrawerOpen(false)}
        queue={queue}
        uiTheme={uiTheme}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* Model Switch Safeguard Warning Modal */}
      <ModelSwitchWarningModal
        isOpen={modelSwitchWarning.isOpen}
        mode={modelSwitchWarning.mode}
        targetModel={modelSwitchWarning.targetModel}
        activeTask={queue.activeTask}
        pendingCount={queue.pendingCount}
        onConfirmCancelAndSwitch={async () => {
          if (queue.activeTask) {
            await queue.cancelTask(queue.activeTask.id);
          }
          setTimeout(() => {
            executeModelSwitch(modelSwitchWarning.targetModel, false);
          }, 350);
        }}
        onConfirmProceedWithQueued={() => {
          executeModelSwitch(modelSwitchWarning.targetModel, false);
        }}
        onConfirmClearQueueAndSwitch={() => {
          executeModelSwitch(modelSwitchWarning.targetModel, true);
        }}
        onClose={() => setModelSwitchWarning(prev => ({ ...prev, isOpen: false }))}
        uiTheme={uiTheme}
      />
    </div>
  );
}

export default App;
