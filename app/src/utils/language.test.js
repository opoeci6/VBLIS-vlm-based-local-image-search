import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LANGUAGE_STORAGE_KEY,
  readLanguagePreference,
  resolveLanguage,
  saveLanguagePreference,
} from './language';

const stubNavigator = (language, languages = [language]) => {
  vi.stubGlobal('navigator', { language, languages });
};

describe('resolveLanguage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an explicit choice as it is', () => {
    stubNavigator('en-US');
    expect(resolveLanguage('zh-CN')).toBe('zh-CN');
    stubNavigator('zh-CN');
    expect(resolveLanguage('en')).toBe('en');
  });

  it.each([
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
    ['ZH-hk', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['de-DE', 'en'],
    ['ja-JP', 'en'],
    ['', 'en'],
  ])('maps the system language %s to %s', (systemLanguage, expected) => {
    stubNavigator(systemLanguage);
    expect(resolveLanguage('system')).toBe(expected);
  });

  it('reads navigator.language only, not a second language in navigator.languages', () => {
    stubNavigator('en-US', ['en-US', 'zh-CN']);
    expect(resolveLanguage('system')).toBe('en');
  });

  it('treats an unknown preference as system', () => {
    stubNavigator('zh-CN');
    expect(resolveLanguage('klingon')).toBe('zh-CN');
    expect(resolveLanguage(undefined)).toBe('zh-CN');
    expect(resolveLanguage(null)).toBe('zh-CN');
  });

  it('falls back to English when navigator has no language', () => {
    vi.stubGlobal('navigator', {});
    expect(resolveLanguage('system')).toBe('en');
  });
});

describe('language preference storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to system', () => {
    expect(readLanguagePreference()).toBe('system');
  });

  it.each(['system', 'en', 'zh-CN'])('round-trips %s', (value) => {
    saveLanguagePreference(value);
    expect(readLanguagePreference()).toBe(value);
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(JSON.stringify(value));
  });

  it.each([
    ['not json', '{oops'],
    ['an unknown language', JSON.stringify('fr')],
    ['a number', '3'],
    ['null', 'null'],
    ['an object', '{"a":1}'],
    ['an empty string', '""'],
  ])('treats %s as system', (name, raw) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, raw);
    expect(readLanguagePreference()).toBe('system');
  });

  it('does not store a bad value', () => {
    saveLanguagePreference('fr');
    expect(readLanguagePreference()).toBe('system');
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readLanguagePreference()).toBe('system');
    expect(() => saveLanguagePreference('en')).not.toThrow();
  });
});
