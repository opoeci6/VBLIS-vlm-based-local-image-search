import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppHeader } from './AppHeader';
import { DESKTOP_SESSION, SessionContext } from '../../session/sessionContext';

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
    openSettings={vi.fn()}
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
    const openSettings = vi.fn();
    renderHeader({ openSettings });
    const pill = screen.getByText('model-a');
    expect(screen.getByText('VBLIS')).toBeTruthy();
    fireEvent.click(pill);
    expect(openSettings).toHaveBeenCalledWith('models');
  });

  it('shows "No Model Loaded" when no model is active and still opens settings', () => {
    const openSettings = vi.fn();
    renderHeader({ models: { active_model: '' }, openSettings });
    fireEvent.click(screen.getByText('No Model Loaded'));
    expect(openSettings).toHaveBeenCalledWith('models');
  });

  it('opens settings from the gear button', () => {
    const openSettings = vi.fn();
    const { container } = renderHeader({ openSettings });
    const gear = container.querySelector('button.hover\\:rotate-45');
    expect(gear).toBeTruthy();
    fireEvent.click(gear);
    // The gear names no group: Settings opens on the one used last.
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(openSettings).toHaveBeenCalledWith();
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

  it('passes hasSearchResults and onClearSearch to the search bar', () => {
    const setQuery = vi.fn();
    const onClearSearch = vi.fn();
    renderHeader({ setQuery, onClearSearch, hasSearchResults: true });
    fireEvent.click(screen.getByLabelText('Clear search text'));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
    expect(setQuery).not.toHaveBeenCalled();
  });

  it('shows no clear button without text or results', () => {
    renderHeader();
    expect(screen.queryByLabelText('Clear search text')).toBeNull();
  });

  it('does not render the browse hint', () => {
    renderHeader({ showBrowseHint: true });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close hint' })).toBeNull();
  });

  it('names the gear button and keeps the class the tests use to find it', () => {
    const { container } = renderHeader();
    const gear = container.querySelector('button.hover\\:rotate-45');
    expect(gear.getAttribute('aria-label')).toBe('Settings');
  });

  it('has the header menu only in a browser session', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: 'Account and appearance' })).toBeNull();
    cleanup();
    render(
      <SessionContext.Provider value={{ ...DESKTOP_SESSION, mode: 'network', account: { id: 'a1', name: 'alice' } }}>
        <AppHeader
          models={{ active_model: 'org/model-a' }}
          openSettings={vi.fn()}
          queue={makeQueue()}
          uiTheme="modern"
          handleSearch={vi.fn()}
          isSearching={false}
          searchInputRef={{ current: null }}
          query=""
          setQuery={vi.fn()}
          theme="light"
          setTheme={vi.fn()}
          setUiTheme={vi.fn()}
        />
      </SessionContext.Provider>
    );
    expect(screen.getByRole('button', { name: 'Account and appearance' })).toBeTruthy();
  });

  it('lays out three rows on a phone: logo and controls, the search box, then the buttons; one row from md up', () => {
    const { container } = renderHeader();
    const header = container.querySelector('header');
    expect(header.className).toContain('flex-wrap');
    expect(header.className).toContain('md:flex-nowrap');
    expect(header.className).toContain('px-4');
    expect(header.className).toContain('sm:px-6');
    // No top margin on a phone.
    expect(header.className).not.toMatch(/(^|\s)mt-4/);
    const [logo, search, controls] = Array.from(header.children);
    expect(logo.className).toContain('order-1');
    expect(controls.className).toContain('order-2');
    expect(search.className).toContain('order-3');
    expect(search.className).toContain('basis-full');
  });

  it('lets the model chip truncate', () => {
    renderHeader({ models: { active_model: 'org/' + 'm'.repeat(80) } });
    const chip = screen.getByText('m'.repeat(80));
    expect(chip.className).toContain('truncate');
    expect(chip.closest('button').className).toContain('max-w-full');
  });
});
