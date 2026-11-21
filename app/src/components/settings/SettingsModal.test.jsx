import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setNetworkModeForTests } from '../../config';
import { resetBackToCloseForTests } from '../../hooks/useBackToClose';
import { resetEscapeKeyForTests, useEscapeKey } from '../../hooks/useEscapeKey';
import { ReplicaContext } from '../../session/replicaContext';
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

// A Settings window that keeps the "clear the index" confirmation and the open state itself, like App does.
const StatefulSettings = ({ openRequest = null, initialConfirmClear = false }) => {
  const [show, setShow] = useState(true);
  const [confirmClear, setConfirmClear] = useState(initialConfirmClear);
  return (
    <SettingsModal
      {...makeProps({ showSettings: show, setShowSettings: setShow, showConfirmClear: confirmClear, setShowConfirmClear: setConfirmClear, openRequest })}
    />
  );
};

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

const renderAs = (session, props = {}) => render(
  <SessionContext.Provider value={session}>
    <SettingsModal {...makeProps(props)} />
  </SessionContext.Provider>
);

const REPLICA = {
  source_host: 'PC-1',
  exported_at: '2026-11-20T12:00:00+00:00',
  imported_at: '2026-11-21T12:00:00+00:00',
  model_id: 'org/model-a',
  missing: 3,
};

const tabNames = () => screen.getAllByRole('tab').map(tab => tab.textContent);
const selectedTab = () => screen.getAllByRole('tab').find(tab => tab.getAttribute('aria-selected') === 'true');
const clickTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));
const pageIsOpen = () => !screen.getByRole('tabpanel').classList.contains('hidden');
// The phone list item of a group, found by its one-line description.
const listItem = (description) => screen.getByText(description).closest('button');
const follows = (first, second) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('SettingsModal', () => {
  // The desktop's Sharing section reads the backend when it opens; here that read never answers.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    // The group Settings was left on is remembered in localStorage.
    localStorage.clear();
  });
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

    it('starts below the title bar of the Windows app, and not in a browser, which has none', () => {
      render(<SettingsModal {...makeProps()} />);
      expect(document.querySelector('[data-settings-backdrop]').className.split(/\s+/)).toContain('top-8');
      cleanup();
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
      renderAs(networkSession('owner'));
      expect(document.querySelector('[data-settings-backdrop]').className.split(/\s+/)).not.toContain('top-8');
    });

    it('closes on a click on the backdrop, not on the panel', () => {
      const props = makeProps();
      render(<SettingsModal {...props} />);
      fireEvent.click(screen.getByRole('heading', { name: 'Settings' }));
      expect(props.setShowSettings).not.toHaveBeenCalled();
      fireEvent.click(document.querySelector('[data-settings-backdrop]'));
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

    it('goes back from a group page to the list before it closes, in network mode', async () => {
      setNetworkModeForTests(true);
      render(<OpenableSettings />);
      await settle();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'open settings' })); });
      expect(pushState).toHaveBeenCalledTimes(1);
      expect(pageIsOpen()).toBe(false);

      // Tapping a group in the phone list opens its page: a second history entry on top of Settings'.
      await act(async () => { fireEvent.click(listItem('Match scores and how many results to show')); });
      expect(pageIsOpen()).toBe(true);
      expect(pushState).toHaveBeenCalledTimes(2);

      await back();
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
      expect(pageIsOpen()).toBe(false);
      expect(window.history.state?.vblisBack ?? 0).toBe(1);

      await back();
      expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
      expect(window.history.state?.vblisBack ?? 0).toBe(0);
    });

    it('closes a group page and Settings together with the close button, leaving no history entry behind', async () => {
      setNetworkModeForTests(true);
      render(<OpenableSettings />);
      await settle();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'open settings' })); });
      await act(async () => { fireEvent.click(listItem('Match scores and how many results to show')); });
      expect(pushState).toHaveBeenCalledTimes(2);

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close settings' })); });
      await settle();
      expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
      expect(window.history.state?.vblisBack ?? 0).toBe(0);
    });
  });

  describe('groups', () => {
    it('keeps one heading, and renders the sections of a group in order', () => {
      render(<SettingsModal {...makeProps()} />);
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);

      // Appearance (the first group, nothing used before)
      expect(follows(screen.getByText('UI Theme Style'), screen.getByText('Language'))).toBe(true);

      clickTab('Search');
      const sliders = ['Minimum Match Score', 'Minimum Similarity', 'Maximum Display Results'].map(label => screen.getByText(label));
      expect(follows(sliders[0], sliders[1]) && follows(sliders[1], sliders[2])).toBe(true);

      clickTab('Models and GPU');
      expect(follows(screen.getByText('Hardware Acceleration & Batching'), screen.getByText('Model Management'))).toBe(true);
    });

    it('puts the thumbnails, then the export, then Clear Indexed Database in the Library of the desktop owner', () => {
      render(<SettingsModal {...makeProps()} />);
      clickTab('Library');
      const thumbnails = screen.getByText('Thumbnail Cache Management');
      const exportTitle = screen.getByText('Export for another device');
      const clear = screen.getByRole('button', { name: /Clear Indexed Database/ });
      expect(follows(thumbnails, exportTitle)).toBe(true);
      expect(follows(exportTitle, clear)).toBe(true);
    });

    it('puts the Sharing group of the desktop app after the Library, with its sections inside', () => {
      render(<SettingsModal {...makeProps()} />);
      const tabs = screen.getAllByRole('tab');
      expect(follows(screen.getByRole('tab', { name: 'Library' }), screen.getByRole('tab', { name: 'Network sharing' }))).toBe(true);
      expect(tabs[tabs.length - 1].textContent).toBe('Network sharing');
      clickTab('Network sharing');
      // The page title is the group's: the section has no heading of its own.
      expect(screen.getAllByRole('heading', { name: 'Network sharing' })).toHaveLength(1);
      expect(screen.getByText('Loading sharing settings...')).toBeTruthy();
    });

    it('passes props through to the sections', () => {
      const props = makeProps();
      render(<SettingsModal {...props} />);
      fireEvent.click(screen.getByText('Retro Terminal'));
      expect(props.setUiTheme).toHaveBeenCalledWith('terminal');

      clickTab('Library');
      fireEvent.click(screen.getByRole('button', { name: /Clear Indexed Database/ }));
      expect(props.setShowConfirmClear).toHaveBeenCalledWith(true);
      fireEvent.click(screen.getByRole('button', { name: /Clear Image Cache/ }));
      expect(props.setShowConfirmClearThumbnails).toHaveBeenCalledWith('images');

      clickTab('Search');
      const sliders = document.querySelectorAll('input[type="range"]');
      fireEvent.change(sliders[0], { target: { value: '0.3' } });
      expect(props.setMinScore).toHaveBeenCalledWith(0.3);
      fireEvent.change(sliders[1], { target: { value: '0.8' } });
      expect(props.setMinSimilarity).toHaveBeenCalledWith(0.8);
    });

    it.each([
      ['the desktop owner', null, ['Appearance', 'Search', 'Models and GPU', 'Library', 'Network sharing']],
      ['a network owner', 'owner', ['Appearance', 'Search', 'Models and GPU', 'Library', 'Server', 'Your account']],
      ['a network viewer', 'viewer', ['Appearance', 'Search', 'Your account']],
    ])('lists the groups of %s in order, as a vertical tab list with one selected tab', (_name, role, names) => {
      if (role) renderAs(networkSession(role)); else render(<SettingsModal {...makeProps()} />);
      expect(tabNames()).toEqual(names);

      const tablist = screen.getByRole('tablist');
      expect(tablist.getAttribute('aria-orientation')).toBe('vertical');
      expect(tablist.getAttribute('aria-label')).toBe('Settings groups');

      const selected = screen.getAllByRole('tab').filter(tab => tab.getAttribute('aria-selected') === 'true');
      expect(selected).toHaveLength(1);
      expect(selected[0].textContent).toBe('Appearance');
      expect(selected[0].getAttribute('tabindex')).toBe('0');
      expect(screen.getAllByRole('tab').filter(tab => tab !== selected[0]).every(tab => tab.getAttribute('tabindex') === '-1')).toBe(true);
      const panel = screen.getByRole('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(selected[0].id);
      expect(selected[0].getAttribute('aria-controls')).toBe(panel.id);
    });

    it('renders only the sections of the selected group', () => {
      render(<SettingsModal {...makeProps()} />);
      expect(screen.getByText('UI Theme Style')).toBeTruthy();
      expect(screen.queryByText('Model Management')).toBeNull();
      expect(screen.queryByText('Minimum Match Score')).toBeNull();
      expect(screen.queryByText('Thumbnail Cache Management')).toBeNull();

      clickTab('Models and GPU');
      expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('settings-tab-models');
      expect(screen.getByRole('heading', { name: 'Models and GPU' })).toBeTruthy();
      expect(screen.getByText('Model Management')).toBeTruthy();
      expect(screen.queryByText('UI Theme Style')).toBeNull();
    });

    it('shows a viewer the Appearance, Search and account groups only', () => {
      vi.stubGlobal('fetch', vi.fn());
      renderAs(networkSession('viewer'));
      expect(screen.queryByRole('tab', { name: 'Models and GPU' })).toBeNull();
      expect(screen.queryByRole('tab', { name: 'Library' })).toBeNull();
      expect(screen.queryByRole('tab', { name: 'Server' })).toBeNull();
      clickTab('Your account');
      expect(screen.getByRole('heading', { name: 'Your account' })).toBeTruthy();
      expect(screen.getByText('bob')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Server' })).toBeNull();
    });

    it('lists "Your account" after the server group for a network owner, and shows the server group', () => {
      renderAs(networkSession('owner'));
      expect(follows(screen.getByRole('tab', { name: 'Server' }), screen.getByRole('tab', { name: 'Your account' }))).toBe(true);
      clickTab('Server');
      expect(screen.getByRole('heading', { name: 'Server' })).toBeTruthy();
      expect(screen.getByText('Loading server settings...')).toBeTruthy();
      clickTab('Your account');
      expect(screen.getByRole('heading', { name: 'Your account' })).toBeTruthy();
      expect(screen.getByText('alice')).toBeTruthy();
    });

    it('shows no account group in the desktop app', () => {
      render(<SettingsModal {...makeProps()} />);
      expect(screen.queryByRole('tab', { name: 'Your account' })).toBeNull();
    });

    it('shows no export section to a network owner or viewer', () => {
      renderAs(networkSession('owner'));
      clickTab('Library');
      expect(screen.getByText('Thumbnail Cache Management')).toBeTruthy();
      expect(screen.queryByText('Export for another device')).toBeNull();
      cleanup();
      renderAs(networkSession('viewer'));
      expect(screen.queryByRole('tab', { name: 'Library' })).toBeNull();
      expect(screen.queryByText('Export for another device')).toBeNull();
    });

    it('shows no sharing group to a network owner or viewer', () => {
      renderAs(networkSession('owner'));
      expect(screen.queryByRole('tab', { name: 'Network sharing' })).toBeNull();
      cleanup();
      renderAs(networkSession('viewer'));
      expect(screen.queryByRole('tab', { name: 'Network sharing' })).toBeNull();
    });
  });

  describe('keyboard on the tab list', () => {
    const press = (key) => fireEvent.keyDown(document.activeElement, { key });

    it('moves the selection and the focus with Down and Up, wrapping around', () => {
      render(<SettingsModal {...makeProps()} />);
      screen.getByRole('tab', { name: 'Appearance' }).focus();

      press('ArrowDown');
      expect(selectedTab().textContent).toBe('Search');
      expect(document.activeElement).toBe(selectedTab());
      press('ArrowDown');
      expect(selectedTab().textContent).toBe('Models and GPU');

      press('ArrowUp');
      press('ArrowUp');
      expect(selectedTab().textContent).toBe('Appearance');
      press('ArrowUp');
      expect(selectedTab().textContent).toBe('Network sharing');
      expect(document.activeElement).toBe(selectedTab());
      press('ArrowDown');
      expect(selectedTab().textContent).toBe('Appearance');
      expect(document.activeElement).toBe(selectedTab());
    });

    it('jumps to the first and the last tab with Home and End', () => {
      render(<SettingsModal {...makeProps()} />);
      clickTab('Models and GPU');
      screen.getByRole('tab', { name: 'Models and GPU' }).focus();
      press('End');
      expect(selectedTab().textContent).toBe('Network sharing');
      expect(document.activeElement).toBe(selectedTab());
      press('Home');
      expect(selectedTab().textContent).toBe('Appearance');
      expect(document.activeElement).toBe(selectedTab());
      expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
    });

    it('ignores other keys', () => {
      render(<SettingsModal {...makeProps()} />);
      screen.getByRole('tab', { name: 'Appearance' }).focus();
      press('a');
      press('ArrowRight');
      expect(selectedTab().textContent).toBe('Appearance');
    });
  });

  describe('opening at a group', () => {
    it('opens at the requested group', () => {
      render(<SettingsModal {...makeProps({ openRequest: { group: 'library' } })} />);
      expect(selectedTab().textContent).toBe('Library');
      expect(screen.getByText('Thumbnail Cache Management')).toBeTruthy();
    });

    it('falls back to Appearance when the group is unknown or not visible to the session', () => {
      render(<SettingsModal {...makeProps({ openRequest: { group: 'server' } })} />);
      expect(selectedTab().textContent).toBe('Appearance');
      cleanup();
      localStorage.clear();
      render(<SettingsModal {...makeProps({ openRequest: { group: 'no-such-group' } })} />);
      expect(selectedTab().textContent).toBe('Appearance');
      cleanup();
      localStorage.clear();
      vi.stubGlobal('fetch', vi.fn());
      renderAs(networkSession('viewer'), { openRequest: { group: 'models' } });
      expect(selectedTab().textContent).toBe('Appearance');
      // On a phone a group the session doesn't have opens the list, not the page of the fallback group.
      expect(pageIsOpen()).toBe(false);
    });

    it('falls back to the group used last, when that one is visible', () => {
      localStorage.setItem('settings_group', JSON.stringify('search'));
      render(<SettingsModal {...makeProps({ openRequest: { group: 'server' } })} />);
      expect(selectedTab().textContent).toBe('Search');
    });

    it('switches to the group of a new request while it is open, even for the same group', () => {
      const props = makeProps({ openRequest: { group: 'search' } });
      const { rerender } = render(<SettingsModal {...props} />);
      expect(selectedTab().textContent).toBe('Search');

      clickTab('Library');
      // The same request object again changes nothing.
      rerender(<SettingsModal {...props} />);
      expect(selectedTab().textContent).toBe('Library');

      rerender(<SettingsModal {...props} openRequest={{ group: 'search' }} />);
      expect(selectedTab().textContent).toBe('Search');
      rerender(<SettingsModal {...props} openRequest={{ group: 'models' }} />);
      expect(selectedTab().textContent).toBe('Models and GPU');
      // The gear names no group: it keeps the group in use (the one used last).
      rerender(<SettingsModal {...props} openRequest={{ group: null }} />);
      expect(selectedTab().textContent).toBe('Models and GPU');
    });
  });

  describe('the remembered group', () => {
    it('is the one selected last, and the gear (a request with no group) opens on it', () => {
      const props = makeProps();
      const { rerender } = render(<SettingsModal {...props} openRequest={{ group: null }} />);
      clickTab('Library');
      expect(JSON.parse(localStorage.getItem('settings_group'))).toBe('library');

      rerender(<SettingsModal {...props} showSettings={false} openRequest={{ group: null }} />);
      rerender(<SettingsModal {...props} showSettings openRequest={{ group: null }} />);
      expect(selectedTab().textContent).toBe('Library');

      // A fresh window reads it back from storage.
      cleanup();
      render(<SettingsModal {...makeProps({ openRequest: { group: null } })} />);
      expect(selectedTab().textContent).toBe('Library');
    });

    it('follows the arrow keys and requests too', () => {
      render(<SettingsModal {...makeProps({ openRequest: { group: 'search' } })} />);
      expect(JSON.parse(localStorage.getItem('settings_group'))).toBe('search');
      screen.getByRole('tab', { name: 'Search' }).focus();
      fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
      expect(JSON.parse(localStorage.getItem('settings_group'))).toBe('models');
    });

    it.each(['{not json', '42', '"no-such-group"', 'null', '["library"]'])('ignores %s in storage', (stored) => {
      localStorage.setItem('settings_group', stored);
      render(<SettingsModal {...makeProps({ openRequest: { group: null } })} />);
      expect(selectedTab().textContent).toBe('Appearance');
    });

    it('is ignored when that group is not visible to the session', () => {
      localStorage.setItem('settings_group', JSON.stringify('server'));
      render(<SettingsModal {...makeProps({ openRequest: { group: null } })} />);
      expect(selectedTab().textContent).toBe('Appearance');
    });

    it('is not written while Settings is closed', () => {
      render(<SettingsModal {...makeProps({ showSettings: false, openRequest: { group: 'search' } })} />);
      expect(localStorage.getItem('settings_group')).toBeNull();
    });
  });

  describe('leaving a group', () => {
    it('cancels the open inline confirmations', () => {
      const props = makeProps({ showConfirmClear: true, showConfirmDeleteModel: 'org/model-a', showConfirmClearThumbnails: 'images' });
      render(<SettingsModal {...props} />);
      clickTab('Search');
      expect(props.setShowConfirmClear).toHaveBeenCalledWith(false);
      expect(props.setShowConfirmDeleteModel).toHaveBeenCalledWith(null);
      expect(props.setShowConfirmClearThumbnails).toHaveBeenCalledWith(null);
    });

    it('calls no setter when none is open, or when the same group is picked again', () => {
      const props = makeProps();
      render(<SettingsModal {...props} />);
      clickTab('Search');
      clickTab('Search');
      for (const setter of [props.setShowConfirmClear, props.setShowConfirmDeleteModel, props.setShowConfirmClearThumbnails]) {
        expect(setter).not.toHaveBeenCalled();
      }
    });

    it('cancels only the confirmations that are open', () => {
      const props = makeProps({ showConfirmClearThumbnails: 'videos' });
      render(<SettingsModal {...props} />);
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Appearance' }), { key: 'End' });
      expect(props.setShowConfirmClearThumbnails).toHaveBeenCalledWith(null);
      expect(props.setShowConfirmClear).not.toHaveBeenCalled();
      expect(props.setShowConfirmDeleteModel).not.toHaveBeenCalled();
    });

    it('cancels them when a phone page goes back to the list, and when another group is picked from the list', () => {
      const props = makeProps({ openRequest: { group: 'library' }, showConfirmClear: true });
      render(<SettingsModal {...props} />);
      expect(pageIsOpen()).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Back to all settings' }));
      expect(props.setShowConfirmClear).toHaveBeenCalledTimes(1);
      expect(props.setShowConfirmClear).toHaveBeenCalledWith(false);

      fireEvent.click(listItem('Match scores and how many results to show'));
      expect(props.setShowConfirmClear).toHaveBeenCalledTimes(2);
    });
  });

  describe('on a phone: the list of groups and one page at a time', () => {
    it('lists every visible group with its description, as plain buttons', () => {
      render(<SettingsModal {...makeProps()} />);
      const expected = [
        ['Appearance', 'Theme style and language'],
        ['Search', 'Match scores and how many results to show'],
        ['Models and GPU', 'Models, GPU acceleration and batching'],
        ['Library', 'Thumbnails, export and the index'],
        ['Network sharing', 'Let browsers on your network open the library'],
      ];
      for (const [title, description] of expected) {
        const item = listItem(description);
        expect(item.getAttribute('role')).toBeNull();
        expect(item.textContent).toBe(title + description);
      }
      expect(screen.getAllByRole('tab')).toHaveLength(expected.length);
    });

    it('describes the Library without the export outside the desktop app', () => {
      renderAs(networkSession('owner'));
      expect(listItem('Thumbnails and the index').textContent).toContain('Library');
      expect(screen.queryByText('Thumbnails, export and the index')).toBeNull();
      expect(listItem('Addresses, accounts and sign-ins').textContent).toContain('Server');
      expect(listItem('Change your password or sign out').textContent).toContain('Your account');
    });

    it('opens the page of a tapped group, and the Back arrow returns to the list', () => {
      render(<SettingsModal {...makeProps()} />);
      const nav = screen.getByRole('tablist').closest('nav');
      expect(pageIsOpen()).toBe(false);
      expect(nav.classList.contains('hidden')).toBe(false);

      fireEvent.click(listItem('Models, GPU acceleration and batching'));
      expect(pageIsOpen()).toBe(true);
      expect(nav.classList.contains('hidden')).toBe(true);
      expect(nav.classList.contains('md:flex')).toBe(true);
      expect(screen.getByRole('heading', { name: 'Models and GPU' })).toBeTruthy();
      expect(screen.getByText('Model Management')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Back to all settings' }));
      expect(pageIsOpen()).toBe(false);
      expect(nav.classList.contains('hidden')).toBe(false);
      // Settings is still open, on the same group (the wide layout shows it).
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
      expect(selectedTab().textContent).toBe('Models and GPU');
    });

    it('opens the page directly when a request names a group and the screen is narrow', () => {
      // jsdom has no matchMedia: narrow.
      render(<SettingsModal {...makeProps({ openRequest: { group: 'models' } })} />);
      expect(pageIsOpen()).toBe(true);
    });

    it('opens on the list for a request with no group, narrow or not', () => {
      render(<SettingsModal {...makeProps({ openRequest: { group: null } })} />);
      expect(pageIsOpen()).toBe(false);
    });

    it('does not open the page on a wide screen', () => {
      const matchMedia = vi.fn(() => ({ matches: true }));
      vi.stubGlobal('matchMedia', matchMedia);
      render(<SettingsModal {...makeProps({ openRequest: { group: 'models' } })} />);
      expect(matchMedia).toHaveBeenCalledWith('(min-width: 768px)');
      expect(pageIsOpen()).toBe(false);
      expect(selectedTab().textContent).toBe('Models and GPU');
    });

    it('treats a matchMedia that throws as a narrow screen', () => {
      vi.stubGlobal('matchMedia', () => { throw new Error('no'); });
      render(<SettingsModal {...makeProps({ openRequest: { group: 'models' } })} />);
      expect(pageIsOpen()).toBe(true);
    });

    it('goes back to the list, then closes, with Esc; a confirmation goes first', () => {
      render(<StatefulSettings openRequest={{ group: 'library' }} initialConfirmClear />);
      expect(pageIsOpen()).toBe(true);
      expect(screen.getByText('Yes, Delete')).toBeTruthy();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByText('Yes, Delete')).toBeNull();
      expect(pageIsOpen()).toBe(true);

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(pageIsOpen()).toBe(false);
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
    });
  });

  describe('the Library on a read-only copy', () => {
    const renderLibrary = (replica) => render(
      <ReplicaContext.Provider value={{ readOnly: replica !== null, replica }}>
        <SettingsModal {...makeProps({ openRequest: { group: 'library' } })} />
      </ReplicaContext.Provider>
    );

    it('shows the notice and no Clear Indexed Database, but keeps the thumbnails and the export', () => {
      renderLibrary(REPLICA);
      const notice = screen.getByTestId('replica-notice');
      expect(notice.textContent).toContain('PC-1');
      expect(screen.queryByText('Clear Indexed Database')).toBeNull();
      expect(follows(screen.getByText('Thumbnail Cache Management'), screen.getByText('Export for another device'))).toBe(true);
      expect(follows(screen.getByText('Export for another device'), notice)).toBe(true);
    });

    it('leaves no visible wrapper for the notice of an ordinary library', () => {
      renderLibrary(null);
      expect(screen.queryByTestId('replica-notice')).toBeNull();
      expect(screen.getByRole('button', { name: /Clear Indexed Database/ })).toBeTruthy();
      const wrappers = [...screen.getByRole('tabpanel').querySelectorAll('.divide-y > div')];
      expect(wrappers).toHaveLength(4);
      const empty = wrappers.filter(wrapper => wrapper.childElementCount === 0);
      expect(empty).toHaveLength(1);
      expect(empty[0].classList.contains('empty:hidden')).toBe(true);
    });
  });
});
