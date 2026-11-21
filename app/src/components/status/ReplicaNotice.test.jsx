import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ReplicaNotice } from './ReplicaNotice';
import { ReplicaContext } from '../../session/replicaContext';
import { SessionContext, DESKTOP_SESSION } from '../../session/sessionContext';
import i18n from '../../i18n';

const REPLICA = {
  source_host: 'PC-1',
  exported_at: '2026-11-20T12:00:00+00:00',
  imported_at: '2026-11-21T12:00:00+00:00',
  model_id: 'org/model-a',
  missing: 3,
};

const renderNotice = (replica, session = DESKTOP_SESSION) => render(
  <SessionContext.Provider value={session}>
    <ReplicaContext.Provider value={{ readOnly: replica !== null, replica }}>
      <ReplicaNotice />
    </ReplicaContext.Provider>
  </SessionContext.Provider>
);

describe('ReplicaNotice', () => {
  afterEach(async () => {
    cleanup();
    await act(() => i18n.changeLanguage('en'));
  });

  it('renders nothing for an ordinary library', () => {
    const { container } = renderNotice(null);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a viewer, who gets no replica details', () => {
    const { container } = renderNotice(REPLICA, { ...DESKTOP_SESSION, isOwner: false, role: 'viewer' });
    expect(container.firstChild).toBeNull();
  });

  it('says where the copy came from, when, and how many of its files are missing', () => {
    renderNotice(REPLICA);
    const text = screen.getByRole('note').textContent;
    expect(text).toMatch(/^Read-only copy of the library on PC-1, exported Nov \d\d, 2026\./);
    expect(text).toContain("3 files of the copy aren't on this computer.");
  });

  it('formats a large missing count the way the language groups numbers', () => {
    renderNotice({ ...REPLICA, missing: 12345 });
    expect(screen.getByRole('note').textContent).toContain("12,345 files of the copy aren't on this computer.");
  });

  it('is in Chinese when the interface is', async () => {
    await act(() => i18n.changeLanguage('zh-CN'));
    renderNotice(REPLICA);
    const text = screen.getByRole('note').textContent;
    expect(text).toContain('只读副本');
    expect(text).toContain('PC-1');
    expect(text).toContain('副本中有 3 个文件不在这台电脑上。');
  });

  it('names no host as another computer', () => {
    renderNotice({ ...REPLICA, source_host: null, exported_at: null, missing: 0 });
    expect(screen.getByRole('note').textContent).toMatch(/^Read-only copy of the library on another computer\. Indexing happens/);
  });
});
