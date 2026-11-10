import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BackendLoading, ModelSetupState, NoMatches, ReadyToSearch } from './EmptyStates';
import i18n from '../../i18n';

// AsciiLogo needs canvas and matchMedia, which jsdom lacks.
vi.mock('../common/AsciiLogo', () => ({ AsciiLogo: () => 'ascii-logo-stub' }));

describe('NoMatches', () => {
  afterEach(cleanup);

  it('renders the message', () => {
    render(<NoMatches />);
    expect(screen.getByText('No matches found')).toBeTruthy();
    expect(screen.getByText('Try a different query or index more images.')).toBeTruthy();
  });

  it('keeps the plain message when filters are not active, even if a handler is given', () => {
    render(<NoMatches filtersActive={false} onClearFilters={vi.fn()} />);
    expect(screen.getByText('No matches found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('names the filters and offers to clear them when they are active', () => {
    const onClearFilters = vi.fn();
    render(<NoMatches filtersActive onClearFilters={onClearFilters} />);
    expect(screen.getByText('No matches with the current filters')).toBeTruthy();
    expect(screen.queryByText('No matches found')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  describe('files without media details', () => {
    it('explains that the filters skip them and offers to read the details', () => {
      const onReadDetails = vi.fn();
      const onClearFilters = vi.fn();
      render(<NoMatches filtersActive missingDetails={1234} onReadDetails={onReadDetails} onClearFilters={onClearFilters} />);
      expect(screen.getByText('1,234 files have no media details yet, so these filters skip them.')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Read details now' }));
      expect(onReadDetails).toHaveBeenCalledTimes(1);
      // Clear filters stays available next to it.
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(onClearFilters).toHaveBeenCalledTimes(1);
    });

    it('shows progress instead of the button while the scan runs', () => {
      render(<NoMatches filtersActive missingDetails={5} scanActive onReadDetails={vi.fn()} />);
      expect(screen.getByText('5 files have no media details yet, so these filters skip them.')).toBeTruthy();
      expect(screen.getByText('Reading media details...')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Read details now' })).toBeNull();
    });

    it('uses the singular for one file', () => {
      render(<NoMatches filtersActive missingDetails={1} onReadDetails={vi.fn()} />);
      expect(screen.getByText('1 file has no media details yet, so these filters skip it.')).toBeTruthy();
    });

    it('says nothing about details when none are missing', () => {
      render(<NoMatches filtersActive missingDetails={0} onReadDetails={vi.fn()} />);
      expect(screen.queryByText(/no media details yet/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Read details now' })).toBeNull();
    });

    it('does not show the hint without filters', () => {
      render(<NoMatches missingDetails={5} onReadDetails={vi.fn()} />);
      expect(screen.getByText('No matches found')).toBeTruthy();
      expect(screen.queryByText(/no media details yet/)).toBeNull();
    });
  });
});

describe('BackendLoading', () => {
  afterEach(cleanup);

  it('shows the initializing title by default', () => {
    render(<BackendLoading isSwitchingModel={false} />);
    expect(screen.getByText('Initializing AI Engine')).toBeTruthy();
    expect(screen.getByText(/Connecting to backend/)).toBeTruthy();
  });

  it('shows the switching title while a model switch runs', () => {
    render(<BackendLoading isSwitchingModel />);
    expect(screen.getByText('Switching Model')).toBeTruthy();
    expect(screen.getByText(/Loading model weights into memory/)).toBeTruthy();
  });
});

describe('ModelSetupState', () => {
  afterEach(cleanup);

  const props = (overrides = {}) => ({
    models: { models: [] },
    handleModelSwitch: vi.fn(),
    setShowSettings: vi.fn(),
    handleDownloadModel: vi.fn(),
    pendingModel: 'google/siglip2-base-patch16-224',
    ...overrides,
  });

  it('offers to activate a downloaded model', () => {
    const p = props({
      models: { models: [{ id: 'org/not-downloaded', downloaded: false }, { id: 'org/model-a', downloaded: true }] },
    });
    render(<ModelSetupState {...p} />);
    expect(screen.getByText('No Model Loaded')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Activate model-a' }));
    expect(p.handleModelSwitch).toHaveBeenCalledWith('org/model-a');

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(p.setShowSettings).toHaveBeenCalledWith(true);
  });

  it('asks for a download when no model is downloaded', () => {
    const p = props({ models: { models: [{ id: 'org/model-a', downloaded: false }] } });
    render(<ModelSetupState {...p} />);
    expect(screen.getByText('AI Model Required')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Download siglip2-base-patch16-224' }));
    expect(p.handleDownloadModel).toHaveBeenCalledWith('google/siglip2-base-patch16-224');

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(p.setShowSettings).toHaveBeenCalledWith(true);
  });

  it('handles a missing models list and labels the OpenAI CLIP download', () => {
    const p = props({ models: {}, pendingModel: 'openai/clip-vit-base-patch32' });
    render(<ModelSetupState {...p} />);
    expect(screen.getByText('AI Model Required')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download OpenAI CLIP' })).toBeTruthy();
  });
});

describe('ReadyToSearch', () => {
  afterEach(cleanup);

  const props = (overrides = {}) => ({
    uiTheme: 'modern',
    indexedFolders: [],
    models: { active_model: 'org/model-a' },
    setShowSettings: vi.fn(),
    handleUnloadModel: vi.fn(),
    isUnloadingModel: false,
    status: { is_indexing: false },
    ...overrides,
  });

  it.each(['modern', 'terminal'])('renders in the %s theme and wires the buttons', (uiTheme) => {
    const p = props({ uiTheme });
    render(<ReadyToSearch {...p} />);
    expect(screen.getByText('Ready to Search')).toBeTruthy();
    expect(screen.getByText('model-a')).toBeTruthy();
    expect(screen.queryByText('ascii-logo-stub') !== null).toBe(uiTheme === 'terminal');

    fireEvent.click(screen.getByText(/Active Model:/));
    expect(p.setShowSettings).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: /Eject/ }));
    expect(p.handleUnloadModel).toHaveBeenCalledTimes(1);
  });

  it('describes the folder count', () => {
    const { rerender } = render(<ReadyToSearch {...props()} />);
    expect(screen.getByText(/Select a folder to extract intelligence/)).toBeTruthy();

    rerender(<ReadyToSearch {...props({ indexedFolders: [{ path: '/a' }] })} />);
    expect(screen.getByText('1 folder is ready. Search your media using natural language.')).toBeTruthy();

    rerender(<ReadyToSearch {...props({ indexedFolders: [{ path: '/a' }, { path: '/b' }] })} />);
    expect(screen.getByText('2 folders are ready. Search your media using natural language.')).toBeTruthy();
  });

  it('disables Eject while indexing or unloading', () => {
    const { rerender } = render(<ReadyToSearch {...props({ status: { is_indexing: true } })} />);
    expect(screen.getByRole('button', { name: /Eject/ }).disabled).toBe(true);

    rerender(<ReadyToSearch {...props({ isUnloadingModel: true })} />);
    const button = screen.getByRole('button', { name: /Unloading/ });
    expect(button.disabled).toBe(true);
  });
});

describe('browse wording', () => {
  afterEach(cleanup);

  it.each(['modern', 'terminal'])('ReadyToSearch tells how to browse the library in the %s theme', (uiTheme) => {
    render(
      <ReadyToSearch
        uiTheme={uiTheme}
        indexedFolders={[]}
        models={{ active_model: 'org/model-a' }}
        setShowSettings={vi.fn()}
        handleUnloadModel={vi.fn()}
        isUnloadingModel={false}
        status={{ is_indexing: false }}
      />
    );
    expect(screen.getByText('Press Search with an empty box to browse your library.')).toBeTruthy();
  });

  const SEARCH_TIP = '为保证搜索效果，请使用常见的词语进行搜索，如“猫”或“寺庙”。网络用语和叠词可能影响搜索结果，可以使用英文进行尝试。';
  const readyProps = (uiTheme) => ({
    uiTheme,
    indexedFolders: [],
    models: { active_model: 'org/model-a' },
    setShowSettings: vi.fn(),
    handleUnloadModel: vi.fn(),
    isUnloadingModel: false,
    status: { is_indexing: false },
  });

  it.each(['modern', 'terminal'])('ReadyToSearch shows no search tip in English in the %s theme', (uiTheme) => {
    const { container } = render(<ReadyToSearch {...readyProps(uiTheme)} />);
    // The folder sentence and the browse hint only.
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  it.each(['modern', 'terminal'])('ReadyToSearch shows the search tip in Chinese in the %s theme', async (uiTheme) => {
    await act(() => i18n.changeLanguage('zh-CN'));
    const { container } = render(<ReadyToSearch {...readyProps(uiTheme)} />);
    const tip = screen.getByText(SEARCH_TIP);
    expect(container.querySelectorAll('p')).toHaveLength(3);
    // Right after the browse hint, in the same style.
    const hint = tip.previousElementSibling;
    expect(hint.tagName).toBe('P');
    expect(tip.className).toBe(hint.className);
  });

  it('NoMatches for a browse with filters offers Clear filters', () => {
    const onClearFilters = vi.fn();
    render(<NoMatches browsing filtersActive onClearFilters={onClearFilters} />);
    expect(screen.getByText('Nothing in your library matches the current filters')).toBeTruthy();
    expect(screen.queryByText(/No matches/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('NoMatches for a browse without filters says there is nothing to browse yet', () => {
    render(<NoMatches browsing />);
    expect(screen.getByText('Nothing to browse yet: add a folder to index it.')).toBeTruthy();
    expect(screen.queryByText('No matches found')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('NoMatches without browsing keeps its search wording', () => {
    const { rerender } = render(<NoMatches />);
    expect(screen.getByText('No matches found')).toBeTruthy();
    rerender(<NoMatches filtersActive onClearFilters={vi.fn()} />);
    expect(screen.getByText('No matches with the current filters')).toBeTruthy();
  });
});
