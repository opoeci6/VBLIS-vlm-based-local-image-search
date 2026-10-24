import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VideoFrameCard } from './VideoFrameCard';

const API = 'http://127.0.0.1:8000';
const frame = { path: '/v/clip.mp4', media_type: 'video', score: 0.8, timestamp_seconds: 65 };

describe('VideoFrameCard', () => {
  afterEach(cleanup);

  it('renders the frame number, match percentage and timestamp', () => {
    render(<VideoFrameCard frame={frame} index={0} onSelect={() => {}} />);
    expect(screen.getByText('FRAME 1')).toBeTruthy();
    expect(screen.getByText('80% MATCH')).toBeTruthy();
    expect(screen.getAllByText('1:05').length).toBeGreaterThan(0);
    expect(screen.getByAltText('Video frame at 1:05').getAttribute('src')).toBe(
      `${API}/image?path=%2Fv%2Fclip.mp4&size=thumbnail&timestamp=65`
    );
  });

  it('numbers frames from the index', () => {
    render(<VideoFrameCard frame={frame} index={4} onSelect={() => {}} />);
    expect(screen.getByText('FRAME 5')).toBeTruthy();
  });

  it('calls onSelect(frame) on click, Enter and Space only', () => {
    const onSelect = vi.fn();
    render(<VideoFrameCard frame={frame} index={0} onSelect={onSelect} />);
    const card = screen.getByRole('button');

    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(card, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onSelect).toHaveBeenCalledTimes(3);
    onSelect.mock.calls.forEach(([arg]) => expect(arg).toBe(frame));
  });

  it('drops the image and keeps the timestamp placeholder when the image errors', () => {
    render(<VideoFrameCard frame={frame} index={0} onSelect={() => {}} uiTheme="terminal" />);
    fireEvent.error(screen.getByAltText('Video frame at 1:05'));
    expect(screen.queryByAltText('Video frame at 1:05')).toBeNull();
    expect(screen.getAllByText('1:05').length).toBeGreaterThan(0);
  });
});
