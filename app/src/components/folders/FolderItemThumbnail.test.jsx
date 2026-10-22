import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FolderItemThumbnail } from './FolderItemThumbnail';

const API = 'http://127.0.0.1:8000';

describe('FolderItemThumbnail', () => {
  afterEach(cleanup);

  it('renders the missing state and ignores clicks when the file is gone', () => {
    const onSelect = vi.fn();
    const item = { path: '/p/gone.jpg', name: 'gone.jpg', media_type: 'image', exists_on_disk: false };
    render(<FolderItemThumbnail item={item} API_BASE={API} onSelect={onSelect} />);

    const tile = screen.getByTitle(/is missing from disk/);
    expect(tile.getAttribute('title')).toBe('gone.jpg is missing from disk');
    fireEvent.click(tile);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('selects an image with timestamp 0 and isBrowsing', () => {
    const onSelect = vi.fn();
    const item = { path: '/p/a.jpg', name: 'a.jpg', media_type: 'image', size: 1234, exists_on_disk: true };
    render(<FolderItemThumbnail item={item} API_BASE={API} onSelect={onSelect} />);

    fireEvent.click(screen.getByTitle('Click to preview a.jpg'));
    expect(onSelect).toHaveBeenCalledWith({
      path: '/p/a.jpg',
      name: 'a.jpg',
      media_type: 'image',
      size: 1234,
      isBrowsing: true,
      timestamp_seconds: 0,
    });
  });

  it('selects a video with timestamp 1.0 and isBrowsing', () => {
    const onSelect = vi.fn();
    const item = { path: '/p/v.mp4', name: 'v.mp4', media_type: 'video', size: 99 };
    render(<FolderItemThumbnail item={item} API_BASE={API} onSelect={onSelect} uiTheme="terminal" />);

    fireEvent.click(screen.getByTitle('Click to preview v.mp4'));
    expect(onSelect).toHaveBeenCalledWith({
      path: '/p/v.mp4',
      name: 'v.mp4',
      media_type: 'video',
      size: 99,
      isBrowsing: true,
      timestamp_seconds: 1.0,
    });
  });

  it('does not bubble the click to parent handlers', () => {
    const parentClick = vi.fn();
    const item = { path: '/p/a.jpg', name: 'a.jpg', media_type: 'image' };
    render(
      <div onClick={parentClick}>
        <FolderItemThumbnail item={item} API_BASE={API} onSelect={() => {}} />
      </div>
    );
    fireEvent.click(screen.getByTitle('Click to preview a.jpg'));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
