import { Loader2, Check, AlertTriangle } from 'lucide-react';
import { SettingsSelect } from '../common/SettingsSelect';
import { cn } from '../../utils/cn';

export const PerformanceSection = ({ gpuSettings, status, uiTheme, isSwitchingGpu, handleToggleGpu, handleUpdatePerformanceSettings }) => {
  return (
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
  );
};
