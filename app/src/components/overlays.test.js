// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Read from disk: vitest hands CSS imports to the test as empty text.
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

// While a blurred full-window overlay is open, index.css pauses the page's endless animations: anything moving
// under the blur makes the browser blur the page again on every frame (about half of an integrated GPU).
// That rule finds the overlays by their `app-overlay` class, so every one of them needs it.
const sources = import.meta.glob(['./**/*.jsx', '!./**/*.test.jsx'], { query: '?raw', import: 'default', eager: true });

const classLists = (source) => [
  ...[...source.matchAll(/className="([^"]*)"/g)].map((match) => match[1]),
  ...[...source.matchAll(/className=\{cn\(([\s\S]*?)\)\}/g)].map((match) => match[1]),
];

describe('blurred overlays', () => {
  it('all carry app-overlay', () => {
    const overlays = [];
    const missing = [];
    for (const [file, source] of Object.entries(sources)) {
      for (const classes of classLists(source)) {
        if (!classes.includes('fixed inset-0') || !classes.includes('backdrop-blur')) continue;
        overlays.push(file);
        if (!/\bapp-overlay\b/.test(classes)) missing.push(file);
      }
    }
    // Settings, Accounts, the folder picker and contents, the queue, two confirmations, the full-size view,
    // the video's frames and the drop overlay.
    expect(overlays.length).toBeGreaterThanOrEqual(10);
    expect(missing).toEqual([]);
  });

  it('pause the endless animations outside them', () => {
    expect(css).toMatch(/body:has\(\.app-overlay\) :is\([^)]*\.animate-pulse[^)]*\):not\(\.app-overlay \*\) \{\s*animation-play-state: paused;/);
  });
});
