import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DragOverlay } from './DragOverlay';

describe('DragOverlay', () => {
  afterEach(cleanup);

  it('offers search or index when nothing is queued', () => {
    render(<DragOverlay activeTask={null} pendingCount={0} />);
    expect(screen.getByText('Drop to search or index')).toBeTruthy();
    expect(screen.getByText('Drop images to search, or folders to start indexing')).toBeTruthy();
  });

  it('shows the queue position when a task is active', () => {
    render(<DragOverlay activeTask={{ id: 1 }} pendingCount={1} />);
    expect(screen.getByText('Drop to add to Queue (#3)')).toBeTruthy();
    expect(screen.getByText('Folders will be added to the background processing queue')).toBeTruthy();
  });

  it('shows the queue position when only pending tasks exist', () => {
    render(<DragOverlay activeTask={null} pendingCount={2} />);
    expect(screen.getByText('Drop to add to Queue (#3)')).toBeTruthy();
  });
});
