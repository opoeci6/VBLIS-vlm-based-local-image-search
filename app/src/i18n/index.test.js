import { describe, expect, it } from 'vitest';
import i18n from './index';

describe('i18n setup', () => {
  it('runs tests in English whatever the machine language is', () => {
    expect(i18n.language).toBe('en');
  });

  it('builds the resources from the files in locales/', () => {
    expect(i18n.getResourceBundle('zh-CN', 'queue').taskTitle.indexName).toBe('索引：{{name}}');
    expect(i18n.getResourceBundle('en', 'common').cancel).toBe('Cancel');
    expect(i18n.options.ns).toEqual(expect.arrayContaining(['common', 'queue', 'format', 'settings']));
  });

  it('throws on a key that does not exist, naming it', () => {
    expect(() => i18n.t('common:no.such.key')).toThrow('common:no.such.key');
    expect(() => i18n.t('no.such.key')).toThrow('common:no.such.key');
  });

  it('does not throw for exists() on a missing key', () => {
    expect(i18n.exists('common:no.such.key')).toBe(false);
    expect(i18n.exists('common:cancel')).toBe(true);
  });

  it('does not throw for a key that is found through the English fallback', async () => {
    i18n.addResource('en', 'common', 'testOnlyInEnglish', 'English only');
    try {
      await i18n.changeLanguage('zh-CN');
      expect(i18n.t('common:testOnlyInEnglish')).toBe('English only');
    } finally {
      delete i18n.store.data.en.common.testOnlyInEnglish;
    }
  });

  it('does not escape interpolated values, and does not expand nested translations in them', () => {
    expect(i18n.t('filters:chip.folder', { name: 'Tom & Jerry <b>' })).toBe('Folder: Tom & Jerry <b>');
    expect(i18n.t('filters:chip.folder', { name: '$t(common.cancel)' })).toBe('Folder: $t(common.cancel)');
  });

  it('picks plural forms for English and a single form for Chinese', async () => {
    expect(i18n.t('common:itemsProgress', { x: 1, count: 1 })).toBe('1 of 1 item');
    expect(i18n.t('common:itemsProgress', { x: 1, count: 5 })).toBe('1 of 5 items');
    await i18n.changeLanguage('zh-CN');
    expect(i18n.t('common:itemsProgress', { x: 1, count: 1 })).toBe('1 / 1 项');
    expect(i18n.t('common:itemsProgress', { x: 2, count: 5 })).toBe('2 / 5 项');
  });
});
