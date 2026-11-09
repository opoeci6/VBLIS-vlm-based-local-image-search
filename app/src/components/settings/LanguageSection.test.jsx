import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { LanguageSection } from './LanguageSection';
import { ThemeStyleSection } from './ThemeStyleSection';

const pressed = (name) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

describe('LanguageSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the title and three buttons', () => {
    render(<LanguageSection />);
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Follow system', 'English', '简体中文']);
  });

  it('presses Follow system by default and nothing else', () => {
    render(<LanguageSection />);
    expect(pressed('Follow system')).toBe('true');
    expect(pressed('English')).toBe('false');
    expect(pressed('简体中文')).toBe('false');
  });

  it('presses the saved preference', () => {
    localStorage.setItem('ui_language', JSON.stringify('zh-CN'));
    render(<LanguageSection />);
    expect(pressed('简体中文')).toBe('true');
    expect(pressed('Follow system')).toBe('false');
  });

  it('ignores a bad saved value', () => {
    localStorage.setItem('ui_language', JSON.stringify('fr'));
    render(<LanguageSection />);
    expect(pressed('Follow system')).toBe('true');
  });

  it('switches to Chinese at once, saves the choice and sets <html lang>', async () => {
    render(<LanguageSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '简体中文' }));
    });
    expect(i18n.language).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(JSON.parse(localStorage.getItem('ui_language'))).toBe('zh-CN');
    expect(pressed('简体中文')).toBe('true');
    expect(pressed('跟随系统')).toBe('false');
    // The section itself is translated: the title and "Follow system", but not the language names.
    expect(screen.getByText('语言')).toBeTruthy();
    expect(screen.getByRole('button', { name: '跟随系统' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'English' })).toBeTruthy();
  });

  it('switches back to English', async () => {
    render(<LanguageSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '简体中文' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'English' }));
    });
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(JSON.parse(localStorage.getItem('ui_language'))).toBe('en');
    expect(screen.getByText('Language')).toBeTruthy();
  });

  it('resolves Follow system from navigator.language', async () => {
    vi.stubGlobal('navigator', { language: 'zh-TW', languages: ['zh-TW'] });
    try {
      render(<LanguageSection />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Follow system' }));
      });
      expect(i18n.language).toBe('zh-CN');
      expect(JSON.parse(localStorage.getItem('ui_language'))).toBe('system');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('still switches when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<LanguageSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '简体中文' }));
    });
    expect(i18n.language).toBe('zh-CN');
    expect(pressed('简体中文')).toBe('true');
  });

  it('changes the text of ThemeStyleSection beside it', async () => {
    render(
      <>
        <ThemeStyleSection uiTheme="modern" setUiTheme={vi.fn()} />
        <LanguageSection />
      </>,
    );
    expect(screen.getByText('UI Theme Style')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '简体中文' }));
    });
    expect(screen.getByText('界面主题风格')).toBeTruthy();
    expect(screen.getByText('复古终端')).toBeTruthy();
    expect(screen.getByText('等宽字体与 ASCII')).toBeTruthy();
  });
});
