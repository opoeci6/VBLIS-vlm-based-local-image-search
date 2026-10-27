import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueuedTaskList } from './QueuedTaskList';

const tasks = [
  { id: 1, type: 'SCAN_MEDIA_INFO', title: 'Read media details', progress: 0 },
  { id: 2, type: 'INDEX_FOLDERS', title: 'Index folders', progress: 0 },
  { id: 3, type: 'REBUILD_VIDEO_THUMBNAILS', title: 'Rebuild thumbnails', progress: 0 },
];

describe('QueuedTaskList type icon', () => {
  afterEach(cleanup);

  it('renders the media-info scan with its own icon and colour next to the other types', () => {
    const { container } = render(
      <QueuedTaskList tasks={tasks} allTasks={tasks} onMove={vi.fn()} onReorder={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText('Read media details')).toBeTruthy();

    const scanIcons = container.querySelectorAll('svg.lucide-file-search');
    expect(scanIcons).toHaveLength(1);
    expect(scanIcons[0].getAttribute('class')).toContain('text-violet-500');

    expect(container.querySelector('svg.lucide-folder.text-indigo-500')).not.toBeNull();
    expect(container.querySelector('svg.lucide-video.text-cyan-500')).not.toBeNull();
  });
});
