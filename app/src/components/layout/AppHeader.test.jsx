import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppHeader } from './AppHeader';

const makeQueue = () => ({
  activeTask: null,
  pendingCount: 0,
  workerState: 'running',
  isDrawerOpen: false,
  setIsDrawerOpen: vi.fn(),
});

const renderHeader = (props = {}) => render(
  <AppHeader
    models={{ active_model: 'org/model-a' }}
    setShowSettings={vi.fn()}
    queue={makeQueue()}
    uiTheme="modern"
    handleSearch={vi.fn((e) => e.preventDefault())}
    isSearching={false}
    searchInputRef={{ current: null }}
    query=""
    setQuery={vi.fn()}
    {...props}
  />
);

describe('AppHeader', () => {
  afterEach(cleanup);

  it('shows the active model basename and opens settings on click', () => {
    const setShowSettings = vi.fn();
    renderHeader({ setShowSettings });
    const pill = screen.getByText('model-a');
    expect(screen.getByText('VBLIS')).toBeTruthy();
    fireEvent.click(pill);
    expect(setShowSettings).toHaveBeenCalledWith(true);
  });

  it('shows "No Model Loaded" when no model is active and still opens settings', () => {
    const setShowSettings = vi.fn();
    renderHeader({ models: { active_model: '' }, setShowSettings });
    fireEvent.click(screen.getByText('No Model Loaded'));
    expect(setShowSettings).toHaveBeenCalledWith(true);
  });

  it('opens settings from the gear button', () => {
    const setShowSettings = vi.fn();
    const { container } = renderHeader({ setShowSettings });
    const gear = container.querySelector('button.hover\\:rotate-45');
    expect(gear).toBeTruthy();
    fireEvent.click(gear);
    expect(setShowSettings).toHaveBeenCalledWith(true);
  });

  it('passes the search props through to the search bar', () => {
    const setQuery = vi.fn();
    const handleSearch = vi.fn((e) => e.preventDefault());
    renderHeader({ setQuery, handleSearch, query: 'cats' });
    fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'dogs' } });
    expect(setQuery).toHaveBeenCalledWith('dogs');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(handleSearch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Clear search text'));
    expect(setQuery).toHaveBeenCalledWith('');
  });
});
