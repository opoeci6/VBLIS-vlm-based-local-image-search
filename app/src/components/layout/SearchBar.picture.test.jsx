import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchBar } from './SearchBar';
import { SessionProvider } from '../../session/SessionProvider';

const info = (role, imageSearch) => ({
  signed_in: true,
  role,
  account: { id: 'a1', name: 'alice' },
  permissions: { originals: false, image_search: imageSearch, places: true },
  secure: true,
  case_sensitive_paths: true,
});

const bar = (onPickImage) => (
  <SearchBar handleSearch={vi.fn()} isSearching={false} searchInputRef={{ current: null }} query="" setQuery={vi.fn()} onPickImage={onPickImage} />
);

const inSession = (session, ui) => render(<SessionProvider info={session} onSignOut={vi.fn()}>{ui}</SessionProvider>);

describe('SearchBar picture button', () => {
  afterEach(cleanup);

  it('opens a hidden image file input from the button', () => {
    inSession(info('viewer', true), bar(vi.fn()));
    const input = screen.getByTestId('picture-input');
    expect(input.getAttribute('type')).toBe('file');
    expect(input.getAttribute('accept')).toBe('image/*');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Search with a picture' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('hands the chosen file to the search and resets the input', () => {
    const onPickImage = vi.fn();
    inSession(info('owner', true), bar(onPickImage));
    const input = screen.getByTestId('picture-input');
    const file = new File(['x'], 'cat.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onPickImage).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('does nothing when the file dialog is cancelled', () => {
    const onPickImage = vi.fn();
    inSession(info('owner', true), bar(onPickImage));
    fireEvent.change(screen.getByTestId('picture-input'), { target: { files: [] } });
    expect(onPickImage).not.toHaveBeenCalled();
  });

  it('is hidden without the image search permission', () => {
    inSession(info('viewer', false), bar(vi.fn()));
    expect(screen.queryByTestId('picture-input')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search with a picture' })).toBeNull();
  });

  it('is hidden on the desktop app', () => {
    render(bar(vi.fn()));
    expect(screen.queryByTestId('picture-input')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search with a picture' })).toBeNull();
  });
});
