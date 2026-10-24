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

  it('shows a spinner instead of the search icon while searching', () => {
    const { container } = renderBar({ isSearching: true });
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });
});
