import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VideoResultFolder } from './VideoResultFolder';

const API = 'http://127.0.0.1:8000';

let counter = 0;
// The prewarm Set in utils/media.js is module-level, so every test needs its own path.
const makeGroup = () => {
  const path = `/videos/folder-card-${++counter}.mp4`;
  const frames = [
    { path, media_type: 'video', score: 0.87, timestamp_seconds: 5 },
    { path, media_type: 'video', score: 0.4, timestamp_seconds: 20 },
  ];
  return { path, name: `folder-card-${counter}.mp4`, frames, bestScore: 0.87, bestFrame: frames[0] };
};

describe('VideoResultFolder', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the name, best score and frame count', () => {
    const group = makeGroup();
    render(<VideoResultFolder group={group} idx={0} onSelect={() => {}} />);
    expect(screen.getByText(group.name)).toBeTruthy();
    expect(screen.getByText(/BEST 87%/)).toBeTruthy();
    expect(screen.getByText(/2 returned frames/)).toBeTruthy();
  });

  it('uses the singular for a single frame', () => {
    const group = makeGroup();
    group.frames = [group.frames[0]];
    render(<VideoResultFolder group={group} idx={0} onSelect={() => {}} />);
    expect(screen.getByText(/1 returned frame$/)).toBeTruthy();
  });

  it('prewarms frames with one POST on mouse enter, even if hovered repeatedly', () => {
    const group = makeGroup();
    render(<VideoResultFolder group={group} idx={0} onSelect={() => {}} />);
    const card = screen.getByRole('button');
    fireEvent.mouseEnter(card);
    fireEvent.mouseEnter(card);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/video/frames/batch-extract`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ path: group.path, timestamps: [5, 20] });
  });

  it('calls onSelect(group) on click and on Enter', () => {
    const onSelect = vi.fn();
    const group = makeGroup();
    render(<VideoResultFolder group={group} idx={0} onSelect={onSelect} />);
    const card = screen.getByRole('button');

    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith(group);

    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(group);
  });

  it('also selects on Space but ignores other keys', () => {
    const onSelect = vi.fn();
    const group = makeGroup();
    render(<VideoResultFolder group={group} idx={0} onSelect={onSelect} />);
    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: 'a' });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(card, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith(group);
  });

  it.each(['modern', 'terminal'])('renders in the %s theme', (uiTheme) => {
    const group = makeGroup();
    render(<VideoResultFolder group={group} idx={0} onSelect={() => {}} uiTheme={uiTheme} />);
    expect(screen.getByText('VIDEO')).toBeTruthy();
  });
});
