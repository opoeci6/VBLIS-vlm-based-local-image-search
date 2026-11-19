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

  it('gives the clear button a hit area of at least 32 by 32 px and a name', () => {
    render(<ImageSearchChip imageSearchContext="cat.png" handleClearImageSearch={vi.fn()} />);
    const clear = screen.getByRole('button', { name: 'Clear visual search' });
    expect(clear.className).toContain('h-8');
    expect(clear.className).toContain('w-8');
  });

  it('truncates a long file name instead of overflowing a phone screen', () => {
    const { container } = render(<ImageSearchChip imageSearchContext={'x'.repeat(200) + '.png'} handleClearImageSearch={vi.fn()} />);
    expect(container.querySelector('.inline-flex').className).toContain('max-w-full');
    expect(screen.getByText(/^x{200}\.png$/).className).toContain('truncate');
  });
});
