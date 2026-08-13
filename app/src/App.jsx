import { useState, useEffect, useRef, memo } from 'react';
import { Search, FolderOpen, Settings, Loader2, Image as ImageIcon, CheckCircle2, Trash2, AlertTriangle, X, RefreshCw, CheckSquare, Square, ChevronRight, Info, Sparkles, LogOut, XCircle } from 'lucide-react';
import TitleBar from './TitleBar';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const API_BASE = 'http://127.0.0.1:8000';
const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds === Infinity) return 'Calculating...';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const SearchResult = memo(({ res, idx, API_BASE, onSelect }) => {
  return (
    <div
      className={cn(
        "relative group rounded-3xl overflow-hidden shadow-xl ring-1 ring-black/5 dark:ring-white/5 cursor-pointer h-[250px]",
        "animate-in fade-in zoom-in-95 fill-mode-both",
        res.isDuplicate && "ring-2"
      )}
      style={{
        animationDelay: `${idx * 50}ms`,
        animationDuration: '400ms',
        boxShadow: res.isDuplicate ? `0 0 20px -5px ${res.dupeColor}66, 0 0 0 2px ${res.dupeColor}` : undefined
      }}
      onClick={() => onSelect(res)}
    >
      <img
        src={`${API_BASE}/image?path=${encodeURIComponent(res.path)}&size=thumbnail`}
        alt="Result"
        className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
        loading="lazy"
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-5">
        <div className="translate-y-4 group-hover:translate-y-0 transition-transform duration-300 ease-out">
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

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  const [minScore, setMinScore] = useState(0.20);
  const [maxResults, setMaxResults] = useState(50);

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
    is_loading_model: false
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
  const [showConfirmClearThumbnails, setShowConfirmClearThumbnails] = useState(false);
  const [toast, setToast] = useState(null);
  const [imageSearchContext, setImageSearchContext] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragError, setDragError] = useState(null);
  const [indexedFolders, setIndexedFolders] = useState([]);
  const [isFetchingFolders, setIsFetchingFolders] = useState(false);
  const [showFolderManager, setShowFolderManager] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [showErrorAlert, setShowErrorAlert] = useState(false);
  const [gpuSettings, setGpuSettings] = useState({ 
    use_gpu: false, 
    cuda_available: false, 
    device: 'cpu', 
    batch_size: 16, 
    precision_mode: 'auto', 
    active_precision: 'fp32', 
    fp16_supported: false, 
    gpu_name: '' 
  });
  const [isSwitchingGpu, setIsSwitchingGpu] = useState(false);
  const [isCancellingIndexing, setIsCancellingIndexing] = useState(false);
  const lastToastedError = useRef(null);
  const prevIsDownloading = useRef(false);
  const prevIsIndexing = useRef(false);
  const prevLastTaskId = useRef(0);

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
      batch_size: updates.batch_size !== undefined ? Number(updates.batch_size) : (gpuSettings.batch_size || 16),
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
      } catch (e) { }
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
      } catch (e) {
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
        } catch (e) { }
      };
      fetchModels();
    }
    return () => { mounted = false; };
  }, [status.is_downloading, backendReady]);

  // Toast for download completion
  useEffect(() => {
    // 1. Success case: download finished with no error
    if (prevIsDownloading.current === true && status.is_downloading === false && !status.download_error && status.download_total_bytes > 0) {
      const modelName = pendingModel.split('/').pop();
      setToast({ message: `Model ${modelName} downloaded and activated successfully!`, type: 'success' });
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
      } else if (status.total_files === 0 && !status.is_indexing) {
        // Only toast about 0 files if it's a "fresh" completion
        setToast({ message: "No supported images (.jpg, .png, etc.) found in the selected folder.", type: 'error' });
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
  }, [status.is_indexing, status.errors, status.last_task_id]);

  const processSearchResults = (dataResults) => {
    // Duplicate detection logic
    const resultsWithDuplicates = dataResults || [];
    const hashGroups = {};

    resultsWithDuplicates.forEach(res => {
      // Fallback to path if hash is missing (though normally they should have hashes)
      const id = res.hash || res.path;
      if (id) {
        if (!hashGroups[id]) hashGroups[id] = [];
        hashGroups[id].push(res.path);
      }
    });

    // Filter groups that actually have duplicates
    const dupeGroups = Object.entries(hashGroups)
      .filter(([_, paths]) => paths.length > 1)
      .reduce((acc, [id, paths]) => ({ ...acc, [id]: paths }), {});

    // Assign unique colors to each dupe group
    // Vibrant colors for outlines
    const vibrantColors = [
      '#6366f1', // Indigo
      '#ef4444', // Red
      '#10b981', // Emerald
      '#f59e0b', // Amber
      '#ec4899', // Pink
      '#8b5cf6', // Violet
      '#06b6d4', // Cyan
      '#f97316', // Orange
    ];

    const dupeColorMap = {};
    Object.keys(dupeGroups).forEach((hash, i) => {
      dupeColorMap[hash] = vibrantColors[i % vibrantColors.length];
    });

    return resultsWithDuplicates.map(res => ({
      ...res,
      isDuplicate: !!dupeGroups[res.hash],
      dupeColor: dupeColorMap[res.hash] || null,
      otherPaths: dupeGroups[res.hash] ? dupeGroups[res.hash].filter(p => p !== res.path) : []
    }));
  };

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

    setIsSearching(true);
    setHasSearched(true);
    setImageSearchContext(null);
    try {
      const res = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k: parseInt(maxResults) === 0 ? 20000 : parseInt(maxResults), min_score: parseFloat(minScore) })
      });
      const data = await res.json();
      setResults(processSearchResults(data.results));
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

    setIsSearching(true);
    setHasSearched(true);
    setImageSearchContext(file.name);
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
      setResults(processSearchResults(data.results));
      setToast({ message: `Found ${data.results?.length || 0} similar images.`, type: 'success' });
    } catch (err) {
      console.error(err);
      setToast({ message: "Failed to search by image.", type: 'error' });
    } finally {
      setIsSearching(false);
    }
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
      const filePath = window.electronAPI?.getPathForFile ? window.electronAPI.getPathForFile(file) : file.path;
      if (!filePath) continue;

      const isDir = await window.electronAPI.isDirectory(filePath);
      if (isDir) {
        folderPaths.push(filePath);
      } else if (file.type.startsWith('image/')) {
        imageFiles.push(file);
      }
    }

    if (folderPaths.length > 0) {
      try {
        const res = await fetch(`${API_BASE}/index/folders/batch-index`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_paths: folderPaths })
        });
        if (res.ok) {
          setToast({ message: `Started indexing ${folderPaths.length} folder(s).`, type: 'success' });
        } else {
          const err = await res.json();
          setToast({ message: `Error: ${err.detail}`, type: 'error' });
        }
      } catch (err) {
        console.error(err);
        setToast({ message: "Failed to start indexing.", type: 'error' });
      }
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
      try {
        await fetch(`${API_BASE}/index/folders/batch-index`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_paths: paths })
        });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleModelSwitch = async (model_name) => {
    setIsSwitchingModel(true);
    setShowSettings(false);
    setModelLoadError(null);
    // Reset search state immediately when switching models
    setResults([]);
    setHasSearched(false);
    setQuery('');
    setImageSearchContext(null);

    try {
      const res = await fetch(`${API_BASE}/models/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name })
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
    } catch (err) {
      console.error(err);
    } finally {
      setIsClearing(false);
      setShowConfirmClear(false);
      setShowSettings(false); // Optionally close modal on success
    }
  };

  const handleClearThumbnailCache = async () => {
    setIsClearingThumbnails(true);
    try {
      await fetch(`${API_BASE}/image/cache/clear`, {
        method: 'POST'
      });
      setToast({ message: 'Thumbnail cache cleared successfully.', type: 'success' });
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to clear thumbnail cache.', type: 'error' });
    } finally {
      setIsClearingThumbnails(false);
      setShowConfirmClearThumbnails(false);
    }
  };



  const handleClearImageSearch = () => {
    setImageSearchContext(null);
    setResults([]);
    setHasSearched(false);
  };

  const fetchIndexedFolders = async () => {
    if (!models.active_model) return;
    setIsFetchingFolders(true);
    try {
      const res = await fetch(`${API_BASE}/index/folders`);
      const data = await res.json();
      setIndexedFolders(data.folders || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetchingFolders(false);
    }
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
        const error = await res.json();
        setToast({ message: `Error: ${error.detail}`, type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to start re-indexing.', type: 'error' });
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

  const toggleFolderSelection = (folder) => {
    setSelectedFolders(prev =>
      prev.includes(folder.path)
        ? prev.filter(f => f !== folder.path)
        : [...prev, folder.path]
    );
  };

  const toggleSelectAll = () => {
    if (selectedFolders.length === indexedFolders.length) {
      setSelectedFolders([]);
    } else {
      setSelectedFolders(indexedFolders.map(f => f.path));
    }
  };

  useEffect(() => {
    if (showSettings || showFolderManager) {
      fetchIndexedFolders();
    }
  }, [showSettings, showFolderManager, models.active_model]);

  return (
    <div
      className="h-screen w-full overflow-y-auto overflow-x-hidden bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans flex flex-col items-center relative pt-8 custom-scrollbar"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <TitleBar theme={theme} setTheme={setTheme} />

      {/* Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-indigo-600/20 backdrop-blur-sm flex items-center justify-center p-8 pointer-events-none animate-in fade-in duration-200">
          <div className="w-full max-w-2xl h-64 border-2 border-dashed border-indigo-400 rounded-3xl bg-neutral-900/80 flex flex-col items-center justify-center gap-4 shadow-2xl scale-110">
            <div className="w-20 h-20 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center ring-1 ring-indigo-500/40">
              <ImageIcon className="w-10 h-10 animate-bounce" />
            </div>
            <div className="text-center">
              <h3 className="text-2xl font-bold text-white mb-2">Drop to search or index</h3>
              <p className="text-neutral-400">Drop images to search, or folders to start indexing</p>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 p-6 rounded-2xl w-[480px] max-w-full max-h-[90vh] overflow-y-auto shadow-2xl relative animate-in fade-in zoom-in-95 duration-200 custom-scrollbar">
            <button
              onClick={() => setShowSettings(false)}
              className="absolute top-4 right-4 p-2 text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-neutral-900 dark:text-white">
              <Settings className="w-5 h-5 text-indigo-500 dark:text-indigo-400" /> Settings
            </h2>
            <div className="space-y-6">
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
                  <button
                    onClick={handleToggleGpu}
                    disabled={!gpuSettings.cuda_available || isSwitchingGpu}
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-30",
                      gpuSettings.use_gpu ? "bg-indigo-600" : "bg-gray-200 dark:bg-neutral-700"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                        gpuSettings.use_gpu ? "translate-x-6" : "translate-x-1"
                      )}
                    />
                    {isSwitchingGpu && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-full">
                        <Loader2 className="w-3 h-3 text-white animate-spin" />
                      </div>
                    )}
                  </button>
                </div>

                {!gpuSettings.cuda_available && (
                  <p className="text-[10px] text-amber-500 font-medium mt-1 mb-3 px-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> CUDA-capable GPU is required for GPU acceleration.
                  </p>
                )}

                {/* Batch Size & Precision Mode Grid */}
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="p-3 border border-gray-100 dark:border-neutral-800 rounded-xl bg-gray-50/50 dark:bg-neutral-800/20">
                    <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                      Batch Size
                    </label>
                    <select
                      value={gpuSettings.batch_size || 16}
                      onChange={(e) => handleUpdatePerformanceSettings({ batch_size: e.target.value })}
                      disabled={isSwitchingGpu}
                      className="w-full text-xs p-1.5 rounded-lg bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="1">1 (Single / Safest)</option>
                      <option value="4">4</option>
                      <option value="8">8</option>
                      <option value="16">16 (Recommended)</option>
                      <option value="32">32 (High VRAM)</option>
                      <option value="64">64 (Max Throughput)</option>
                    </select>
                    <span className="block text-[9px] text-neutral-400 dark:text-neutral-500 mt-1">
                      Higher batch size increases GPU utilization.
                    </span>
                  </div>

                  <div className="p-3 border border-gray-100 dark:border-neutral-800 rounded-xl bg-gray-50/50 dark:bg-neutral-800/20">
                    <label className="block text-xs font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                      Precision Mode
                    </label>
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
                    <span className="block text-[9px] text-neutral-400 dark:text-neutral-500 mt-1">
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
                            "group flex flex-col p-3 border rounded-xl transition-all duration-200",
                            isActive
                              ? "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/50 ring-1 ring-indigo-500/10 dark:ring-indigo-500/20"
                              : "bg-gray-50 dark:bg-neutral-800/30 border-gray-100 dark:border-neutral-800 hover:bg-gray-100 dark:hover:bg-neutral-800/50"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span className={cn("text-sm font-semibold", isActive ? "text-indigo-600 dark:text-indigo-300" : "text-neutral-700 dark:text-neutral-200")}>
                                  {m.id.split('/').pop()}
                                </span>
                                {isActive && (
                                  <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-500/20">
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                    Active
                                  </span>
                                )}
                              </div>
                              <span className={cn(
                                "text-[10px] uppercase tracking-wider font-bold mt-0.5",
                                m.downloaded ? "text-emerald-400/70" : m.incomplete ? "text-amber-500 font-extrabold flex items-center gap-1" : "text-neutral-400"
                              )}>
                                {m.downloaded
                                  ? "Ready to use"
                                  : m.incomplete
                                    ? `⚠️ Incomplete (${formatBytes(m.download_current_bytes)} / ${formatBytes(m.download_total_bytes)})`
                                    : "Not Downloaded"}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {/* Action Buttons: Activate or Checkmark */}
                              {isActive ? (
                                <button
                                  onClick={handleUnloadModel}
                                  disabled={isUnloadingModel || status.is_indexing}
                                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 rounded-lg font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
                                  title={status.is_indexing ? "Cannot eject model while indexing is in progress" : "Unload model to free GPU VRAM"}
                                >
                                  <LogOut className="w-3.5 h-3.5" />
                                  {isUnloadingModel ? "Unloading..." : "Eject"}
                                </button>
                              ) : m.downloaded ? (
                                  <button
                                    onClick={() => handleModelSwitch(m.id)}
                                    disabled={isSwitchingModel || status.is_downloading || status.is_indexing}
                                  className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-neutral-700 hover:bg-gray-200 dark:hover:bg-indigo-600 text-neutral-900 dark:text-white rounded-lg font-bold transition-all disabled:opacity-50 border border-gray-200 dark:border-transparent shadow-sm dark:shadow-none"
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
                                        <div className="w-full h-1 bg-gray-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                                          <div
                                            className="h-full bg-amber-500 transition-all duration-300"
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

              {/* Indexed Folders Management Link */}
              {models.active_model && (
                <div className="pt-2">
                  <label className="block text-sm font-semibold text-neutral-500 dark:text-neutral-400 mb-2">Folder Index Management</label>
                  <button
                    onClick={() => {
                      setShowSettings(false);
                      setShowFolderManager(true);
                    }}
                    className="w-full group flex items-center justify-between p-4 bg-gray-50 dark:bg-neutral-800/30 border border-gray-200 dark:border-neutral-800 rounded-xl hover:bg-gray-100 dark:hover:bg-neutral-800/50 hover:border-indigo-300 dark:hover:border-indigo-500/30 transition-all duration-300"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 rounded-lg flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-500/20 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors">
                        <FolderOpen className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200">Manage Indexed Folders</p>
                        <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                          {indexedFolders.length} folder{indexedFolders.length !== 1 ? 's' : ''} currently managed
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-neutral-400 dark:text-neutral-600 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors" />
                  </button>
                  <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-2 px-1 leading-relaxed">
                    View, re-sync, or batch remove specific folder indexes without clearing the whole database.
                  </p>
                </div>
              )}

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
                  className="w-full accent-indigo-500 cursor-pointer"
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
                  className="w-full accent-indigo-500 cursor-pointer"
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

              <div className="pt-4 mt-2 border-t border-gray-100 dark:border-neutral-800">
                {showConfirmClearThumbnails ? (
                  <div className="p-4 bg-gray-50 dark:bg-neutral-950/50 border border-indigo-200 dark:border-indigo-500/30 rounded-xl space-y-3 animate-in zoom-in-95 duration-200">
                    <p className="text-sm font-bold text-indigo-600 dark:text-indigo-300">Are you sure? Thumbnails will be regenerated as needed.</p>
                    <div className="flex gap-2">
                      <button onClick={handleClearThumbnailCache} disabled={isClearingThumbnails} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 text-sm font-bold flex justify-center items-center gap-2 transition-colors">
                        {isClearingThumbnails ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {isClearingThumbnails ? 'Clearing...' : 'Yes, Clear'}
                      </button>
                      <button onClick={() => setShowConfirmClearThumbnails(false)} disabled={isClearingThumbnails} className="flex-1 bg-gray-200 dark:bg-neutral-800 hover:bg-gray-300 dark:hover:bg-neutral-700 text-neutral-700 dark:text-white rounded-lg py-2 text-sm font-bold transition-colors">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setShowConfirmClearThumbnails(true)}
                      disabled={isClearingThumbnails}
                      className="w-full px-4 py-3 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm border border-indigo-200 dark:border-indigo-500/20"
                    >
                      {isClearingThumbnails ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      {isClearingThumbnails ? 'Clearing Cache...' : 'Clear Thumbnail Cache'}
                    </button>
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center mt-2 font-medium">Removes all generated thumbnails from disk to free up space.</p>
                  </>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Folder Manager Modal */}
      {showFolderManager && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-3xl w-[640px] max-w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between bg-gray-50/50 dark:bg-neutral-900/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 rounded-xl flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-500/20">
                  <FolderOpen className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-neutral-900 dark:text-white">Folder Index Manager</h2>
                  <p className="text-xs text-neutral-500 dark:text-neutral-500">Manage {indexedFolders.length} indexed directories</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowFolderManager(false);
                  setSelectedFolders([]);
                }}
                className="p-2 text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Toolbar */}
            {indexedFolders.length > 0 && (
              <div className="px-6 py-3 bg-gray-50/50 dark:bg-neutral-800/20 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  {selectedFolders.length === indexedFolders.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  {selectedFolders.length === indexedFolders.length ? 'Deselect All' : 'Select All'}
                </button>

                <div className="flex items-center gap-2">
                  {selectedFolders.length > 0 ? (
                    <div className="flex items-center gap-2 animate-in slide-in-from-right-2 duration-300">
                      <span className="text-[10px] text-neutral-500 font-bold mr-2">{selectedFolders.length} SELECTED</span>
                      <button
                        onClick={handleBatchReindex}
                        disabled={isBatchProcessing}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", isBatchProcessing && "animate-spin")} />
                        Reindex
                      </button>
                      <button
                        onClick={handleBatchDelete}
                        disabled={isBatchProcessing}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-neutral-500 italic">Select folders for batch actions</p>
                  )}
                </div>
              </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {isFetchingFolders ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                  <p className="text-sm text-neutral-500">Fetching folders...</p>
                </div>
              ) : indexedFolders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center px-10">
                  <div className="w-16 h-16 bg-gray-100 dark:bg-neutral-800 rounded-full flex items-center justify-center mb-4">
                    <FolderOpen className="w-8 h-8 text-neutral-400 dark:text-neutral-600" />
                  </div>
                  <h3 className="text-lg font-bold text-neutral-800 dark:text-neutral-300">No Folders Indexed</h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-500 mt-2 max-w-xs">
                    You haven't indexed any folders yet for this model. Use the "Index Folder" button in the header to get started.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {indexedFolders.map((folder) => {
                    const isSelected = selectedFolders.includes(folder.path);
                    const folderName = folder.path.split('\\').pop().split('/').pop() || folder.path;
                    return (
                      <div
                        key={folder.path}
                        className={cn(
                          "group flex items-center gap-4 p-3 rounded-2xl border transition-all duration-200",
                          isSelected
                            ? "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30 ring-1 ring-indigo-500/10"
                            : "bg-gray-50 dark:bg-neutral-800/20 border-gray-100 dark:border-neutral-800/50 hover:bg-gray-100 dark:hover:bg-neutral-800/40 hover:border-gray-300 dark:hover:border-neutral-700",
                          !folder.exists && "opacity-80 border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/5"
                        )}
                      >
                        <button
                          onClick={() => toggleFolderSelection(folder)}
                          className={cn(
                            "flex items-center justify-center w-6 h-6 rounded-lg border transition-all",
                            isSelected
                              ? "bg-indigo-600 dark:bg-indigo-500 border-indigo-600 dark:border-indigo-500 text-white"
                              : "bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 text-transparent group-hover:border-gray-300 dark:group-hover:border-neutral-600"
                          )}
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        </button>

                        <div className="flex-1 min-w-0 pr-4">
                          <div className="flex items-center gap-2">
                            <p className={cn("text-sm font-bold truncate", !folder.exists ? "text-rose-600 dark:text-rose-400" : "text-neutral-800 dark:text-neutral-200")} title={folder.path}>
                              {folderName}
                            </p>
                            {!folder.exists && (
                              <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider font-extrabold text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 whitespace-nowrap">
                                <AlertTriangle className="w-2.5 h-2.5" />
                                Folder missing
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-neutral-500 truncate font-mono mt-0.5" title={folder.path}>
                            {folder.path}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleReindexFolder(folder.path)}
                            className="p-2 text-neutral-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition-all"
                            title="Re-sync folder (Sync disk changes)"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteFolderIndex(folder.path)}
                            className="p-2 text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all"
                            title="Delete index for this folder"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 bg-gray-50 dark:bg-neutral-900 border-t border-gray-100 dark:border-neutral-800">
              <p className="text-center text-[11px] text-neutral-500 dark:text-neutral-500 leading-relaxed font-medium">
                <span className="text-indigo-600 dark:text-indigo-400 font-bold uppercase mr-1">Pro Tip:</span>
                Re-syncing a folder will add files you've recently moved in and remove entries for files you've deleted from your computer.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="w-full max-w-7xl px-6 py-8 flex gap-6 items-center flex-col md:flex-row justify-between relative mt-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center ring-1 ring-indigo-200 dark:ring-indigo-500/20 flex-shrink-0">
            <ImageIcon className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-cyan-600 dark:from-indigo-400 dark:to-cyan-400 bg-clip-text text-transparent">VBLIS</h1>
            </div>
            {models.active_model ? (
              <div className="mt-0.5">
                <button
                  onClick={() => setShowSettings(true)}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50/80 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-200/80 dark:border-indigo-500/20 rounded-lg transition-all hover:scale-105 active:scale-95 text-[10px] font-bold text-indigo-600 dark:text-indigo-300 cursor-pointer shadow-sm"
                  title={`Active Vision Engine: ${models.active_model} (Click to manage models)`}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
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
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
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
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search images (e.g. 'a golden retriever in the snow')..."
              className="w-full bg-white dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-800 rounded-2xl py-4 pl-12 pr-4 text-base outline-none transition-all duration-300 focus:bg-white dark:focus:bg-neutral-900 focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 shadow-xl shadow-black/5 dark:shadow-black/20 text-neutral-900 dark:text-white"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl transition-all hover:scale-105 active:scale-95 font-medium text-sm shadow-lg shadow-indigo-500/20"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenFolder}
            className="flex items-center gap-2 px-4 py-3 bg-white dark:bg-neutral-900/80 hover:bg-gray-50 dark:hover:bg-neutral-800 border border-gray-200 dark:border-neutral-800 rounded-xl transition-all hover:scale-105 active:scale-95 text-sm font-semibold text-neutral-700 dark:text-neutral-200 hover:border-gray-300 dark:hover:border-neutral-700 shadow-sm dark:shadow-none"
          >
            <FolderOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Index Folder(s)
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="p-3 bg-white dark:bg-neutral-900/80 hover:bg-gray-50 dark:hover:bg-neutral-800 border border-gray-200 dark:border-neutral-800 rounded-xl transition-all hover:rotate-45 active:scale-95 text-neutral-500 hover:text-neutral-900 dark:hover:text-white shadow-sm dark:shadow-none"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Global Status Bar */}
      {status.is_indexing && (
        <div className="w-full max-w-7xl px-6 mb-6 animate-in slide-in-from-top-4 duration-500">
          <div className="bg-gradient-to-r from-indigo-500/5 to-transparent dark:from-indigo-500/10 dark:to-transparent border border-indigo-200 dark:border-indigo-500/20 rounded-xl p-4 flex flex-col gap-2 relative text-indigo-700 dark:text-indigo-300">
            <div className="flex justify-between items-center text-sm font-bold">
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Extracting Embeddings ({status.progress})
              </span>
              <div className="flex items-center gap-3">
                <span className="text-indigo-600 dark:text-indigo-400/80">{Math.round(status.percent)}%</span>
                <button
                  onClick={handleCancelIndexing}
                  disabled={isCancellingIndexing || status.cancel_requested}
                  className="px-2.5 py-1 bg-rose-500 hover:bg-rose-600 active:scale-95 text-white text-xs font-semibold rounded-lg transition-all shadow-sm flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Stop and cancel current indexing task"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  {isCancellingIndexing || status.cancel_requested ? "Cancelling..." : "Cancel"}
                </button>
              </div>
            </div>
            <div className="w-full h-1.5 bg-gray-100 dark:bg-neutral-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-cyan-500 dark:from-indigo-500 dark:to-cyan-400 transition-all duration-500 ease-out"
                style={{ width: `${status.percent}%` }}
              />
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-500 truncate mt-1 font-medium" title={status.current_file}>
              Processing: {status.current_file}
            </p>
          </div>
        </div>
      )}

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
              <div className="w-10 h-10 bg-amber-100 dark:bg-amber-500/10 rounded-xl flex items-center justify-center flex-shrink-0 border border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-500">
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
                <div className="w-9 h-9 bg-rose-100 dark:bg-rose-500/20 rounded-xl flex items-center justify-center flex-shrink-0 text-rose-600 dark:text-rose-400">
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
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 ease-out"
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



      {/* Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-6 py-8 overflow-y-auto animate-in fade-in duration-200 custom-scrollbar"
          onClick={() => setSelectedImage(null)}
        >
          <div className="fixed top-12 right-6 flex gap-4 z-[60]">
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
            src={`${API_BASE}/image?path=${encodeURIComponent(selectedImage.path)}`}
            alt="Full size result"
            className={cn(
              "max-w-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300",
              selectedImage.isDuplicate ? "max-h-[70vh]" : "max-h-[80vh]"
            )}
            onClick={(e) => e.stopPropagation()}
          />

          <div className="mt-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-xl font-medium text-white mb-1">
              Match Score: {Math.round(selectedImage.score * 100)}%
            </p>
            {selectedImage.isDuplicate && (
              <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-500/20 border border-amber-500/30 rounded-lg text-amber-300 text-xs font-bold animate-in zoom-in-95 duration-300">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Duplicate detected in {selectedImage.otherPaths.length} other location{selectedImage.otherPaths.length > 1 ? 's' : ''}</span>
              </div>
            )}
            <p className="text-sm text-neutral-400 font-mono break-all max-w-3xl">
              {selectedImage.path}
            </p>
            {selectedImage.isDuplicate && (
              <div className="mt-3 space-y-1">
                {selectedImage.otherPaths.map(p => (
                  <p key={p} className="text-[10px] text-neutral-500 font-mono break-all max-w-2xl mx-auto">
                    Also found at: {p}
                  </p>
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
              <div className="flex flex-col items-center justify-center mt-32 gap-6 animate-in fade-in duration-1000">
                <div className="w-24 h-24 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center relative">
                  <div className="absolute inset-0 rounded-full border border-amber-200 dark:border-amber-500/20 animate-ping opacity-20" style={{ animationDuration: '3s' }} />
                  <ImageIcon className="w-10 h-10 text-amber-500 dark:text-amber-400 opacity-80" />
                </div>
                <div className="text-center space-y-4 flex flex-col items-center">
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
            <div className="flex flex-col items-center justify-center mt-32 gap-6 animate-in fade-in duration-1000">
              <div className="w-24 h-24 rounded-full bg-rose-500/10 flex items-center justify-center relative">
                <div className="absolute inset-0 rounded-full border border-rose-500/20 animate-ping opacity-20" style={{ animationDuration: '3s' }} />
                <ImageIcon className="w-10 h-10 text-rose-400 opacity-80" />
              </div>
              <div className="text-center space-y-4 flex flex-col items-center">
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

        {models.active_model && results.length === 0 && !isSearching && query.length === 0 && !isSwitchingModel && (
          <div className="flex flex-col items-center justify-center mt-32 gap-6 animate-in fade-in duration-1000">
            <div className="w-24 h-24 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center relative">
              <div className="absolute inset-0 rounded-full border border-indigo-200 dark:border-indigo-500/20 animate-ping opacity-20" style={{ animationDuration: '3s' }} />
              <ImageIcon className="w-10 h-10 text-indigo-500 dark:text-indigo-400 opacity-80" />
            </div>
            <div className="text-center space-y-3 flex flex-col items-center">
              <h2 className="text-2xl font-light text-neutral-800 dark:text-neutral-300">Ready to Search</h2>
              <p className="text-neutral-500 dark:text-neutral-500 max-w-md font-medium">Select a folder to extract intelligence, then search your memories using natural language.</p>
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
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {results.map((res, idx) => (
            <SearchResult
              key={res.path}
              res={res}
              idx={idx}
              API_BASE={API_BASE}
              onSelect={setSelectedImage}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;
