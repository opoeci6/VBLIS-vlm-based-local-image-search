import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchBar } from './SearchBar';

const renderBar = (props = {}) => {
  const searchInputRef = { current: null };
  const utils = render(
    <SearchBar
      handleSearch={vi.fn((e) => e.preventDefault())}
      isSearching={false}
      searchInputRef={searchInputRef}
      query=""
      setQuery={vi.fn()}
      {...props}
    />
  );
  return { ...utils, searchInputRef };
};

describe('SearchBar', () => {
  afterEach(cleanup);

  it('calls setQuery as the user types', () => {
    const setQuery = vi.fn();
    renderBar({ setQuery });
    fireEvent.change(screen.getByPlaceholderText(/Search images/), { target: { value: 'cats' } });
    expect(setQuery).toHaveBeenCalledWith('cats');
  });

  it('calls handleSearch on submit', () => {
    const handleSearch = vi.fn((e) => e.preventDefault());
    renderBar({ handleSearch, query: 'cats' });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(handleSearch).toHaveBeenCalledTimes(1);
  });

  it('attaches the input to searchInputRef', () => {
    const { searchInputRef } = renderBar();
    expect(searchInputRef.current).toBe(screen.getByPlaceholderText(/Search images/));
  });

  it('shows the clear button only with text, and clearing resets the query and refocuses', () => {
    const setQuery = vi.fn();
    const { rerender, searchInputRef } = renderBar({ setQuery });
    expect(screen.queryByLabelText('Clear search text')).toBeNull();

    rerender(
      <SearchBar
        handleSearch={vi.fn()}
        isSearching={false}
        searchInputRef={searchInputRef}
        query="dog"
        setQuery={setQuery}
      />
    );
    fireEvent.click(screen.getByLabelText('Clear search text'));
    expect(setQuery).toHaveBeenCalledWith('');
    expect(document.activeElement).toBe(searchInputRef.current);
  });

  describe('clear button with a search behind the box', () => {
    it('is hidden with no text and no results', () => {
      renderBar({ hasSearchResults: false });
      expect(screen.queryByLabelText('Clear search text')).toBeNull();
    });

    it('shows with text only, and a click clears just the text and refocuses', () => {
      const setQuery = vi.fn();
      const onClearSearch = vi.fn();
      const { searchInputRef } = renderBar({ setQuery, onClearSearch, query: 'dog' });
      fireEvent.click(screen.getByLabelText('Clear search text'));
      expect(setQuery).toHaveBeenCalledWith('');
      expect(onClearSearch).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(searchInputRef.current);
    });

    it('shows with results and an empty box, and a click clears the search and refocuses', () => {
      const setQuery = vi.fn();
      const onClearSearch = vi.fn();
      const { searchInputRef } = renderBar({ setQuery, onClearSearch, query: '', hasSearchResults: true });
      fireEvent.click(screen.getByLabelText('Clear search text'));
      expect(onClearSearch).toHaveBeenCalledTimes(1);
      expect(setQuery).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(searchInputRef.current);
    });

    it('clears the search, not just the text, when there is both text and results', () => {
      const setQuery = vi.fn();
      const onClearSearch = vi.fn();
      renderBar({ setQuery, onClearSearch, query: 'cats', hasSearchResults: true });
      fireEvent.click(screen.getByLabelText('Clear search text'));
      expect(onClearSearch).toHaveBeenCalledTimes(1);
    });

    it('keeps the input focused by preventing the default of mousedown', () => {
      renderBar({ query: 'dog' });
      const notPrevented = fireEvent.mouseDown(screen.getByLabelText('Clear search text'));
      expect(notPrevented).toBe(false);
    });

    it('falls back to clearing the text when no onClearSearch is given', () => {
      const setQuery = vi.fn();
      renderBar({ setQuery, query: 'dog', hasSearchResults: true });
      fireEvent.click(screen.getByLabelText('Clear search text'));
      expect(setQuery).toHaveBeenCalledWith('');
    });
  });

  it('shows a spinner instead of the search icon while searching', () => {
    const { container } = renderBar({ isSearching: true });
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });
  it('renders the Filters button between the input and Search, without submitting the form', () => {
    const handleSearch = vi.fn((e) => e.preventDefault());
    const onToggleFilters = vi.fn();
    renderBar({ handleSearch, onToggleFilters, activeFilterCount: 2, filtersOpen: true });

    const filters = screen.getByRole('button', { name: 'Search filters (2 active)' });
    expect(filters.getAttribute('aria-expanded')).toBe('true');
    const search = screen.getByRole('button', { name: 'Search' });
    expect(filters.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search images/).compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(filters);
    expect(onToggleFilters).toHaveBeenCalledTimes(1);
    expect(handleSearch).not.toHaveBeenCalled();
  });

  it('shows the Filters button without a badge by default', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'Search filters' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('filters-count')).toBeNull();
  });
});
