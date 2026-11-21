import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SectionTitle } from './SectionTitle';

describe('SectionTitle', () => {
  afterEach(cleanup);

  it('is a level 4 heading in the one section title style', () => {
    render(<SectionTitle>Library</SectionTitle>);
    const heading = screen.getByRole('heading', { level: 4, name: 'Library' });
    expect(heading.className).toContain('text-xs font-bold uppercase tracking-wider');
  });

  it('adds the class of its caller', () => {
    render(<SectionTitle className="mb-3">Language</SectionTitle>);
    expect(screen.getByRole('heading', { name: 'Language' }).className).toContain('mb-3');
  });
});
