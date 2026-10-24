import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BackendLoading, ModelSetupState, NoMatches, ReadyToSearch } from './EmptyStates';

// AsciiLogo needs canvas and matchMedia, which jsdom lacks.
vi.mock('../common/AsciiLogo', () => ({ AsciiLogo: () => 'ascii-logo-stub' }));

describe('NoMatches', () => {
  afterEach(cleanup);

  it('renders the message', () => {
    render(<NoMatches />);
    expect(screen.getByText('No matches found')).toBeTruthy();
    expect(screen.getByText('Try a different query or index more images.')).toBeTruthy();
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
