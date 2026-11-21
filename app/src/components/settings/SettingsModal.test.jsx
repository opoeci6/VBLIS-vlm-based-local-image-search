import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setNetworkModeForTests } from '../../config';
import { resetBackToCloseForTests } from '../../hooks/useBackToClose';
import { resetEscapeKeyForTests, useEscapeKey } from '../../hooks/useEscapeKey';
import { SessionContext } from '../../session/sessionContext';
import { AccountsModal } from './AccountsModal';
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
  minSimilarity: 0.7,
  setMinSimilarity: vi.fn(),
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

// jsdom runs history traversals asynchronously and fires popstate, like a browser: wait for them to land.
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
const back = async () => {
  await act(async () => { window.history.back(); });
  await settle();
};

// A Settings window that opens and closes like in the app.
const OpenableSettings = () => {
  const [show, setShow] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setShow(true)}>open settings</button>
      <SettingsModal {...makeProps({ showSettings: show, setShowSettings: setShow })} />
    </>
  );
};

// Some other view that opened later (a window over Settings): it registers its Esc after Settings does.
const ViewAbove = ({ onEscape }) => {
  useEscapeKey(true, onEscape);
  return null;
};

describe('SettingsModal', () => {
  // The desktop's Sharing section reads the backend when it opens; here that read never answers.
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))));
  afterEach(() => {
    cleanup();
    resetEscapeKeyForTests();
    vi.unstubAllGlobals();
  });

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

  describe('closing', () => {
    it('names its close button', () => {
      render(<SettingsModal {...makeProps()} />);
      const button = screen.getByRole('button', { name: 'Close settings' });
      expect(button.tagName).toBe('BUTTON');
    });

    it('closes with Esc', () => {
      const props = makeProps();
      render(<SettingsModal {...props} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(props.setShowSettings).toHaveBeenCalledWith(false);
    });

    it('does not listen for Esc while closed', () => {
      const props = makeProps({ showSettings: false });
      render(<SettingsModal {...props} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(props.setShowSettings).not.toHaveBeenCalled();
    });

    it('cancels an open "clear the index" confirmation before closing', () => {
      const props = makeProps({ showConfirmClear: true });
      render(<SettingsModal {...props} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(props.setShowConfirmClear).toHaveBeenCalledWith(false);
      expect(props.setShowSettings).not.toHaveBeenCalled();
    });

    it('cancels an open "delete model" confirmation before closing', () => {
      const props = makeProps({ showConfirmDeleteModel: 'org/model-a' });
      render(<SettingsModal {...props} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(props.setShowConfirmDeleteModel).toHaveBeenCalledWith(null);
      expect(props.setShowSettings).not.toHaveBeenCalled();
    });

    it('cancels an open "clear thumbnails" confirmation before closing', () => {
      const props = makeProps({ showConfirmClearThumbnails: 'videos' });
      render(<SettingsModal {...props} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(props.setShowConfirmClearThumbnails).toHaveBeenCalledWith(null);
      expect(props.setShowSettings).not.toHaveBeenCalled();
    });

    it('closes on a click on the backdrop, not on the panel', () => {
      const props = makeProps();
      render(<SettingsModal {...props} />);
      fireEvent.click(screen.getByRole('heading', { name: 'Settings' }));
      expect(props.setShowSettings).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Close settings' }).parentElement.parentElement);
      expect(props.setShowSettings).toHaveBeenCalledWith(false);
    });

    it('leaves Esc to a window opened over it', () => {
      const props = makeProps();
      const onEscape = vi.fn();
      const { rerender } = render(<><SettingsModal {...props} /><ViewAbove onEscape={onEscape} /></>);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onEscape).toHaveBeenCalledTimes(1);
      expect(props.setShowSettings).not.toHaveBeenCalled();

      rerender(<SettingsModal {...props} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(props.setShowSettings).toHaveBeenCalledWith(false);
    });

    it('closes only the Accounts window when Esc is pressed over it, then Settings', () => {
      const props = makeProps();
      const onCloseAccounts = vi.fn();
      const view = (accountsOpen) => (
        <>
          <SettingsModal {...props} />
          {accountsOpen && <AccountsModal mode="desktop" onClose={onCloseAccounts} />}
        </>
      );
      const { rerender } = render(view(true));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onCloseAccounts).toHaveBeenCalledTimes(1);
      expect(props.setShowSettings).not.toHaveBeenCalled();

      rerender(view(false));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(props.setShowSettings).toHaveBeenCalledWith(false);
    });
  });

  describe('the Back button', () => {
    let pushState;
    let go;

    beforeEach(() => {
      window.history.replaceState(null, '');
      pushState = vi.spyOn(window.history, 'pushState');
      go = vi.spyOn(window.history, 'go');
    });

    afterEach(async () => {
      cleanup();
      await settle();
      resetBackToCloseForTests();
      setNetworkModeForTests(false);
      vi.restoreAllMocks();
      window.history.replaceState(null, '');
    });

    it('makes no history calls outside network mode', async () => {
      render(<OpenableSettings />);
      fireEvent.click(screen.getByRole('button', { name: 'open settings' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
      await settle();
      expect(pushState).not.toHaveBeenCalled();
      expect(go).not.toHaveBeenCalled();
    });

    it('pushes one history entry when it opens and closes it with Back, in network mode', async () => {
      setNetworkModeForTests(true);
      render(<OpenableSettings />);
      await settle();
      expect(pushState).not.toHaveBeenCalled();

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'open settings' })); });
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
      expect(pushState).toHaveBeenCalledTimes(1);

      await back();
      expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
      expect(window.history.state?.vblisBack ?? 0).toBe(0);
    });
  });

  it('keeps the heading and renders the sections in order', () => {
    render(<SettingsModal {...makeProps()} />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();

    const labels = [
      'UI Theme Style',
      'Language',
      'Hardware Acceleration & Batching',
      'Model Management',
      'Minimum Match Score',
      'Minimum Similarity',
      'Maximum Display Results',
      'Clear Indexed Database',
      'Thumbnail Cache Management',
    ];
    const nodes = labels.map(label => screen.getByText(label));
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('puts the Sharing section of the desktop app after the owner sections', () => {
    render(<SettingsModal {...makeProps()} />);
    const sharing = screen.getByRole('heading', { name: 'Network sharing' });
    const thumbnails = screen.getByText('Thumbnail Cache Management');
    expect(thumbnails.compareDocumentPosition(sharing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Loading sharing settings...')).toBeTruthy();
  });

  it('puts the Export section of the desktop owner right after the thumbnail cache', () => {
    render(<SettingsModal {...makeProps()} />);
    const exportHeading = screen.getByRole('heading', { name: 'Export for another device' });
    const thumbnails = screen.getByText('Thumbnail Cache Management');
    const sharing = screen.getByRole('heading', { name: 'Network sharing' });
    expect(thumbnails.compareDocumentPosition(exportHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(exportHeading.compareDocumentPosition(sharing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    const sliders = document.querySelectorAll('input[type="range"]');
    fireEvent.change(sliders[0], { target: { value: '0.3' } });
    expect(props.setMinScore).toHaveBeenCalledWith(0.3);
    fireEvent.change(sliders[1], { target: { value: '0.8' } });
    expect(props.setMinSimilarity).toHaveBeenCalledWith(0.8);
  });

  describe('network sessions', () => {
    afterEach(() => vi.unstubAllGlobals());

    const networkSession = (role) => ({
      mode: 'network',
      signedIn: true,
      role,
      isOwner: role === 'owner',
      account: { id: 'x1', name: role === 'owner' ? 'alice' : 'bob' },
      permissions: { originals: true, image_search: true, places: true },
      may: () => role === 'owner',
      signOut: vi.fn(),
      refresh: vi.fn(),
    });

    const renderAs = (session) => render(
      <SessionContext.Provider value={session}>
        <SettingsModal {...makeProps()} />
      </SessionContext.Provider>
    );

    it('shows "Your account" to a viewer, and no server section', () => {
      vi.stubGlobal('fetch', vi.fn());
      renderAs(networkSession('viewer'));
      expect(screen.getByRole('heading', { name: 'Your account' })).toBeTruthy();
      expect(screen.getByText('bob')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Server' })).toBeNull();
    });

    it('shows "Your account" before the server section to an owner', () => {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
      renderAs(networkSession('owner'));
      const account = screen.getByRole('heading', { name: 'Your account' });
      const server = screen.getByRole('heading', { name: 'Server' });
      expect(account.compareDocumentPosition(server) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows no account section in the desktop app', () => {
      render(<SettingsModal {...makeProps()} />);
      expect(screen.queryByRole('heading', { name: 'Your account' })).toBeNull();
    });

    it('shows no export section to a network owner or viewer', () => {
      renderAs(networkSession('owner'));
      expect(screen.queryByRole('heading', { name: 'Export for another device' })).toBeNull();
      cleanup();
      renderAs(networkSession('viewer'));
      expect(screen.queryByRole('heading', { name: 'Export for another device' })).toBeNull();
    });

    it('shows no sharing section to a network owner or viewer', () => {
      renderAs(networkSession('owner'));
      expect(screen.queryByRole('heading', { name: 'Network sharing' })).toBeNull();
      cleanup();
      renderAs(networkSession('viewer'));
      expect(screen.queryByRole('heading', { name: 'Network sharing' })).toBeNull();
    });
  });
});
