import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../config';

export const useModelManager = ({ status, setStatus, queue, setToast, onSwitchStart }) => {
  const [modelLoadError, setModelLoadError] = useState(null);

  const [models, setModels] = useState({ active_model: '', models: [] });
  const [pendingModel, setPendingModel] = useState("google/siglip2-base-patch16-224");
  const [backendReady, setBackendReady] = useState(false);
  const [isSwitchingModel, setIsSwitchingModel] = useState(false);
  const [isUnloadingModel, setIsUnloadingModel] = useState(false);
  const [isDeletingModel, setIsDeletingModel] = useState(false);
  const [deleteIndexWithModel, setDeleteIndexWithModel] = useState(false);
  const [showConfirmDeleteModel, setShowConfirmDeleteModel] = useState(null);
  const [modelSwitchWarning, setModelSwitchWarning] = useState({
    isOpen: false,
    mode: 'active_task',
    targetModel: null
  });
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
  const lastToastedError = useRef(null);
  const prevIsDownloading = useRef(false);

  // Poll models and GPU settings
  useEffect(() => {
    let mounted = true;

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

    fetchGpuSettings();
    fetchModels();

    const interval = setInterval(() => {
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
  }, [status.is_downloading, status.download_total_bytes, status.download_error, pendingModel, setToast]);

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
    setModelLoadError(null);
    setModelSwitchWarning(prev => ({ ...prev, isOpen: false }));
    // Reset search state immediately when switching models
    onSwitchStart?.();

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

  return {
    modelLoadError,
    setModelLoadError,
    models,
    pendingModel,
    setPendingModel,
    backendReady,
    isSwitchingModel,
    isUnloadingModel,
    isDeletingModel,
    deleteIndexWithModel,
    setDeleteIndexWithModel,
    showConfirmDeleteModel,
    setShowConfirmDeleteModel,
    modelSwitchWarning,
    setModelSwitchWarning,
    gpuSettings,
    isSwitchingGpu,
    handleUpdatePerformanceSettings,
    handleToggleGpu,
    handleModelSwitch,
    executeModelSwitch,
    handleUnloadModel,
    handleCancelDownload,
    handleDownloadModel,
    handleDeleteModel
  };
};
