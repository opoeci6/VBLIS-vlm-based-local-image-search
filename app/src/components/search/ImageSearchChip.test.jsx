import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImageSearchChip } from './ImageSearchChip';

describe('ImageSearchChip', () => {
  afterEach(cleanup);

  it('renders nothing without a search context', () => {
    const { container } = render(<ImageSearchChip imageSearchContext={null} handleClearImageSearch={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the file name', () => {
    render(<ImageSearchChip imageSearchContext="cat.png" handleClearImageSearch={vi.fn()} />);
    expect(screen.getByText('Visual Search')).toBeTruthy();
    expect(screen.getByText('cat.png')).toBeTruthy();
  });

  it('calls the clear handler', () => {
    const handleClearImageSearch = vi.fn();
    render(<ImageSearchChip imageSearchContext="cat.png" handleClearImageSearch={handleClearImageSearch} />);
    fireEvent.click(screen.getByTitle('Clear visual search'));
    expect(handleClearImageSearch).toHaveBeenCalledTimes(1);
  });
});
