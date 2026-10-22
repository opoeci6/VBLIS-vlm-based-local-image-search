import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchResultCard } from './SearchResultCard';

const API = 'http://127.0.0.1:8000';

const imageRes = (extra = {}) => ({
  path: 'C:\\pics\\cat.jpg',
  media_type: 'image',
  score: 0.87,
  ...extra,
});

describe('SearchResultCard', () => {
  afterEach(cleanup);

  it('shows "Exact Copy (2)" for an exact duplicate with one other path', () => {
    render(
      <SearchResultCard
        res={imageRes({ isDuplicate: true, duplicateType: 'exact', dupeColor: '#0078d4', otherPaths: ['/b.jpg'] })}
        idx={0}
        API_BASE={API}
        onSelect={() => {}}
      />
    );
    expect(screen.getByText(/Exact Copy \(2\)/)).toBeTruthy();
  });

  it('shows "Visual Duplicate (3)" for a visual duplicate with two other paths', () => {
    render(
      <SearchResultCard
        res={imageRes({ isDuplicate: true, duplicateType: 'visual', dupeColor: '#f59e0b', otherPaths: ['/b.jpg', '/c.jpg'] })}
        idx={0}
        API_BASE={API}
        onSelect={() => {}}
      />
    );
    expect(screen.getByText(/Visual Duplicate \(3\)/)).toBeTruthy();
  });

  it('shows no duplicate badge for a normal result', () => {
    render(<SearchResultCard res={imageRes()} idx={0} API_BASE={API} onSelect={() => {}} />);
    expect(screen.queryByText(/Exact Copy|Visual Duplicate/)).toBeNull();
    expect(screen.getByText('cat.jpg')).toBeTruthy();
    expect(screen.getByText(/87% Match/)).toBeTruthy();
  });

  it('shows the timestamp badge for a video result', () => {
    render(
      <SearchResultCard
        res={{ path: '/v/clip.mp4', media_type: 'video', score: 0.5, timestamp_seconds: 65 }}
        idx={0}
        API_BASE={API}
        onSelect={() => {}}
      />
    );
    expect(screen.getByText('1:05')).toBeTruthy();
    expect(screen.getByAltText('Video frame at 1:05')).toBeTruthy();
  });

  it('calls onSelect with the result when clicked', () => {
    const onSelect = vi.fn();
    const res = imageRes();
    render(<SearchResultCard res={res} idx={0} API_BASE={API} onSelect={onSelect} />);
    fireEvent.click(screen.getByAltText('Result'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(res);
  });

  it.each(['modern', 'terminal'])('renders in the %s theme', (uiTheme) => {
    render(<SearchResultCard res={imageRes()} idx={0} API_BASE={API} onSelect={() => {}} uiTheme={uiTheme} />);
    expect(screen.getByAltText('Result').getAttribute('src')).toBe(
      `${API}/image?path=C%3A%5Cpics%5Ccat.jpg&size=thumbnail`
    );
  });
});
