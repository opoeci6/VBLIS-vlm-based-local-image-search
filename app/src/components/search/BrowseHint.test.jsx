import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BrowseHint } from './BrowseHint';

describe('BrowseHint', () => {
  afterEach(cleanup);

  it('says the library is being browsed and a search finds something specific', () => {
    render(<BrowseHint onDismiss={() => {}} />);
    expect(screen.getByRole('status').textContent).toContain('Currently browsing your library. Type a search to find something specific.');
  });

  it('does not mention the sort', () => {
    render(<BrowseHint onDismiss={() => {}} />);
    expect(screen.queryByText(/newest|oldest/i)).toBeNull();
  });

  it('calls onDismiss from the close button', () => {
    const onDismiss = vi.fn();
    render(<BrowseHint onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close hint' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
