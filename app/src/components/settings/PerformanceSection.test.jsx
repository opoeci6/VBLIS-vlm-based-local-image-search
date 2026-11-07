import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PerformanceSection } from './PerformanceSection';

const makeGpu = (overrides = {}) => ({
  use_gpu: false,
  cuda_available: true,
  device: 'cuda',
  batch_size: 0,
  effective_batch_size: 16,
  precision_mode: 'auto',
  active_precision: 'fp32',
  fp16_supported: true,
  gpu_name: '',
  ...overrides,
});

const makeProps = (overrides = {}) => ({
  gpuSettings: makeGpu(),
  status: {},
  uiTheme: 'modern',
  isSwitchingGpu: false,
  handleToggleGpu: vi.fn(),
  handleUpdatePerformanceSettings: vi.fn(),
  ...overrides,
});

describe('PerformanceSection', () => {
  afterEach(cleanup);

  describe('GPU toggle', () => {
    it.each(['modern', 'terminal'])('is disabled without CUDA and shows the warning (%s)', (uiTheme) => {
      render(<PerformanceSection {...makeProps({ uiTheme, gpuSettings: makeGpu({ cuda_available: false }) })} />);
      expect(screen.getByText('No NVIDIA GPU detected')).toBeTruthy();
      expect(screen.getByText(/CUDA-capable GPU is required for GPU acceleration\./)).toBeTruthy();
      expect(screen.getByLabelText('Enable NVIDIA GPU support').disabled).toBe(true);
    });

    it.each(['modern', 'terminal'])('calls handleToggleGpu (%s)', (uiTheme) => {
      const props = makeProps({ uiTheme });
      render(<PerformanceSection {...props} />);
      expect(screen.queryByText(/CUDA-capable GPU is required/)).toBeNull();
      fireEvent.click(screen.getByLabelText('Enable NVIDIA GPU support'));
      expect(props.handleToggleGpu).toHaveBeenCalledTimes(1);
    });

    it('describes the GPU in use', () => {
      render(<PerformanceSection {...makeProps({ gpuSettings: makeGpu({ use_gpu: true, gpu_name: 'RTX 4090' }) })} />);
      expect(screen.getByText('Using RTX 4090')).toBeTruthy();
      expect(screen.getByLabelText('Disable NVIDIA GPU support')).toBeTruthy();
    });

    it('is disabled while switching', () => {
      render(<PerformanceSection {...makeProps({ isSwitchingGpu: true })} />);
      expect(screen.getByLabelText('Enable NVIDIA GPU support').disabled).toBe(true);
    });
  });

  describe('batch size and precision', () => {
    it('uses the custom select in the modern theme', () => {
      const props = makeProps();
      const { container } = render(<PerformanceSection {...props} />);
      expect(container.querySelectorAll('select')).toHaveLength(0);

      fireEvent.click(screen.getByText('Auto'));
      fireEvent.click(screen.getByText('16'));
      expect(props.handleUpdatePerformanceSettings).toHaveBeenCalledWith({ batch_size: '16' });
    });

    it('changes precision with the custom select in the modern theme', () => {
      const props = makeProps();
      render(<PerformanceSection {...props} />);
      fireEvent.click(screen.getByText('Auto (FP32)'));
      fireEvent.click(screen.getByText('FP16 (Half Precision)'));
      expect(props.handleUpdatePerformanceSettings).toHaveBeenCalledWith({ precision_mode: 'fp16' });
    });

    it('uses native selects in the terminal theme', () => {
      const props = makeProps({ uiTheme: 'terminal' });
      const { container } = render(<PerformanceSection {...props} />);
      const selects = container.querySelectorAll('select');
      expect(selects).toHaveLength(2);

      fireEvent.change(selects[0], { target: { value: '16' } });
      expect(props.handleUpdatePerformanceSettings).toHaveBeenCalledWith({ batch_size: '16' });
      fireEvent.change(selects[1], { target: { value: 'fp16' } });
      expect(props.handleUpdatePerformanceSettings).toHaveBeenCalledWith({ precision_mode: 'fp16' });
    });

    it('labels the auto precision option with the active precision', () => {
      render(<PerformanceSection {...makeProps({ gpuSettings: makeGpu({ active_precision: 'fp16' }) })} />);
      expect(screen.getByText('Auto (FP16)')).toBeTruthy();
    });

    it('falls back to FP32 when no precision is reported', () => {
      render(<PerformanceSection {...makeProps({ gpuSettings: makeGpu({ active_precision: '' }), uiTheme: 'terminal' })} />);
      expect(screen.getByRole('option', { name: 'Auto (FP32)' })).toBeTruthy();
    });

    it('describes auto mode and the FP16 support hint', () => {
      render(<PerformanceSection {...makeProps({ gpuSettings: makeGpu({ effective_batch_size: 32 }) })} />);
      expect(screen.getByText('Auto mode active (Effective batch size: 32)')).toBeTruthy();
      expect(screen.getByText('FP16 Tensor Cores supported')).toBeTruthy();
    });

    it('shows the manual batch hint and the legacy GPU hint', () => {
      render(<PerformanceSection {...makeProps({ gpuSettings: makeGpu({ batch_size: 8, fp16_supported: false }) })} />);
      expect(screen.getByText('Higher batch size increases GPU utilization.')).toBeTruthy();
      expect(screen.getByText('Auto fallback to FP32 for legacy GPUs')).toBeTruthy();
    });
  });

  describe('OOM badge', () => {
    it('is hidden normally', () => {
      render(<PerformanceSection {...makeProps()} />);
      expect(screen.queryByText(/OOM \/ Memory Safety Fallback Triggered/)).toBeNull();
    });

    it.each([
      ['gpuSettings', { gpuSettings: makeGpu({ oom_triggered: true }) }],
      ['status', { status: { oom_triggered: true } }],
    ])('appears when %s reports an OOM', (_label, overrides) => {
      render(<PerformanceSection {...makeProps(overrides)} />);
      expect(screen.getByText(/OOM \/ Memory Safety Fallback Triggered/)).toBeTruthy();
    });
  });
});
