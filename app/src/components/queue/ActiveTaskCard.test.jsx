import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ActiveTaskCard } from './ActiveTaskCard';

const makeTask = (type, extra = {}) => ({
  id: 1,
  type,
  title: 'Task title',
  status: 'running',
  progress: 10,
  processed_count: 1,
  total_count: 10,
  ...extra,
});

const renderCard = (task) =>
  render(<ActiveTaskCard task={task} onPause={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} />);

describe('ActiveTaskCard type icon', () => {
  afterEach(cleanup);

  it('renders the media-info scan with its own icon, colour and title', () => {
    const { container } = renderCard(makeTask('SCAN_MEDIA_INFO', { title: 'Read media details' }));
    expect(screen.getByText('Read media details')).toBeTruthy();
    expect(screen.getByText('SCAN_MEDIA_INFO')).toBeTruthy();
    const icon = container.querySelector('svg.lucide-file-search');
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('class')).toContain('text-violet-500');
  });

  it.each([
    ['INDEX_FOLDERS', 'lucide-folder', 'text-indigo-500'],
    ['REBUILD_VIDEO_THUMBNAILS', 'lucide-video', 'text-cyan-500'],
    ['SOMETHING_ELSE', 'lucide-refresh-cw', 'text-emerald-500'],
  ])('keeps the icon for %s', (type, iconClass, colour) => {
    const { container } = renderCard(makeTask(type));
    expect(container.querySelector('svg.lucide-file-search')).toBeNull();
    const icon = container.querySelector(`svg.${iconClass}`);
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('class')).toContain(colour);
  });
});
