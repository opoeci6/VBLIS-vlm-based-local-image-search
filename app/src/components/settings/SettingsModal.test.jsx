import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';

const makeProps = (overrides = {}) => ({
  showSettings: true,
  setShowSettings: vi.fn(),
  uiTheme: 'modern',
  setUiTheme: vi.fn(),
  gpuSettings: {
    use_gpu: false, cuda_available: true, batch_size: 0, effective_batch_size: 16,
    precision_mode: 'auto', active_precision: 'fp32', fp16_supported: false, gpu_name: '',
  },
  status: { is_downloading: false, is_indexing: false, is_rebuilding_video_thumbnails: false },
  isSwitchingGpu: false,
  handleToggleGpu: vi.fn(),
  handleUpdatePerformanceSettings: vi.fn(),
  models: { active_model: 'org/model-a', models: [{ id: 'org/model-a', downloaded: true }] },
  pendingModel: 'org/model-a',
  handleUnloadModel: vi.fn(),
  isUnloadingModel: false,
  handleModelSwitch: vi.fn(),
  isSwitchingModel: false,
  setPendingModel: vi.fn(),
  handleDownloadModel: vi.fn(),
  handleCancelDownload: vi.fn(),
  showConfirmDeleteModel: null,
  setShowConfirmDeleteModel: vi.fn(),
  deleteIndexWithModel: false,
  setDeleteIndexWithModel: vi.fn(),
  handleDeleteModel: vi.fn(),
  isDeletingModel: false,
  minScore: 0.2,
  setMinScore: vi.fn(),
  maxResults: 50,
  setMaxResults: vi.fn(),
  showConfirmClear: false,
  setShowConfirmClear: vi.fn(),
  handleClearCache: vi.fn(),
  isClearing: false,
  cacheStats: {
    images: { count: 3, bytes: 3000, formatted: '2.9 KB' },
    videos: { count: 1, bytes: 1000, formatted: '1000 B' },
    total: { count: 4, bytes: 4000, formatted: '3.9 KB' },
  },
  showConfirmClearThumbnails: null,
  setShowConfirmClearThumbnails: vi.fn(),
  handleClearThumbnailCache: vi.fn(),
  isClearingThumbnails: false,
  handleRebuildVideoThumbnails: vi.fn(),
  isTriggeringRebuildThumbnails: false,
  ...overrides,
});

describe('SettingsModal', () => {
  afterEach(cleanup);

  it('renders nothing when closed', () => {
    const { container } = render(<SettingsModal {...makeProps({ showSettings: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('closes with the close button', () => {
    const props = makeProps();
    render(<SettingsModal {...props} />);
    fireEvent.click(screen.getByTitle('Close settings'));
    expect(props.setShowSettings).toHaveBeenCalledWith(false);
  });

  it('keeps the heading and renders the sections in order', () => {
    render(<SettingsModal {...makeProps()} />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();

    const labels = [
      'UI Theme Style',
      'Hardware Acceleration & Batching',
      'Model Management',
      'Minimum Match Score',
      'Maximum Display Results',
      'Clear Indexed Database',
      'Thumbnail Cache Management',
    ];
    const nodes = labels.map(label => screen.getByText(label));
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('passes props through to the sections', () => {
    const props = makeProps();
    render(<SettingsModal {...props} />);
    fireEvent.click(screen.getByText('Retro Terminal'));
    expect(props.setUiTheme).toHaveBeenCalledWith('terminal');
    fireEvent.click(screen.getByRole('button', { name: /Clear Indexed Database/ }));
    expect(props.setShowConfirmClear).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /Clear Image Cache/ }));
    expect(props.setShowConfirmClearThumbnails).toHaveBeenCalledWith('images');
  });
});
