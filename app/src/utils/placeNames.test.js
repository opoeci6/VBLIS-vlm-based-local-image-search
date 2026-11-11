import { describe, expect, it } from 'vitest';
import {
  findSelectedPlaceAncestor,
  formatPlaceLine,
  isPlaceInside,
  isPlaceSelected,
  placeName,
  togglePlaceSelection,
} from './placeNames';

describe('placeName', () => {
  it('uses the Chinese name for a Chinese interface and the English one otherwise', () => {
    const names = { en: 'Japan', zh: '日本' };
    expect(placeName(names, 'en')).toBe('Japan');
    expect(placeName(names, 'zh-CN')).toBe('日本');
    expect(placeName(names, 'zh')).toBe('日本');
    expect(placeName(names, 'ZH-cn')).toBe('日本');
  });

  it('falls back to English when there is no Chinese name', () => {
    expect(placeName({ en: 'Kyoto', zh: null }, 'zh-CN')).toBe('Kyoto');
    expect(placeName({ en: 'Kyoto', zh: '' }, 'zh-CN')).toBe('Kyoto');
    expect(placeName({ en: 'Kyoto' }, 'zh-CN')).toBe('Kyoto');
  });

  it('is empty when there is no name at all, and null-safe', () => {
    expect(placeName({ en: null, zh: null }, 'en')).toBe('');
    expect(placeName({ en: null, zh: null }, 'zh-CN')).toBe('');
    expect(placeName(null, 'en')).toBe('');
    expect(placeName(undefined, 'zh-CN')).toBe('');
    expect(placeName({ en: 'Japan', zh: '日本' }, undefined)).toBe('Japan');
  });
});

describe('formatPlaceLine', () => {
  const place = {
    id: 'JP.26.1857910',
    country: { en: 'Japan', zh: '日本' },
    region: { en: 'Kyoto Prefecture', zh: '京都府' },
    city: { en: 'Kyoto', zh: '京都市' },
  };

  it('runs from small to large in English', () => {
    expect(formatPlaceLine(place, 'en')).toBe('Kyoto, Kyoto Prefecture, Japan');
  });

  it('runs from large to small in Chinese', () => {
    expect(formatPlaceLine(place, 'zh-CN')).toBe('日本 · 京都府 · 京都市');
  });

  it('collapses adjacent equal names', () => {
    const same = { country: { en: 'Japan', zh: '日本' }, region: { en: 'Kyoto', zh: '京都' }, city: { en: 'Kyoto', zh: '京都' } };
    expect(formatPlaceLine(same, 'en')).toBe('Kyoto, Japan');
    expect(formatPlaceLine(same, 'zh-CN')).toBe('日本 · 京都');
    const sameCountry = { country: { en: 'Singapore', zh: '新加坡' }, region: { en: 'Singapore', zh: '新加坡' }, city: { en: 'Singapore', zh: '新加坡' } };
    expect(formatPlaceLine(sameCountry, 'en')).toBe('Singapore');
    expect(formatPlaceLine(sameCountry, 'zh-CN')).toBe('新加坡');
  });

  it('keeps equal names that are not neighbours', () => {
    const odd = { country: { en: 'A', zh: null }, region: { en: 'B', zh: null }, city: { en: 'A', zh: null } };
    expect(formatPlaceLine(odd, 'en')).toBe('A, B, A');
  });

  it('skips the parts that are missing', () => {
    expect(formatPlaceLine({ country: { en: 'Japan', zh: '日本' }, region: null, city: null }, 'en')).toBe('Japan');
    expect(formatPlaceLine({ country: { en: 'Japan', zh: '日本' }, region: { en: null, zh: null }, city: { en: 'Kyoto', zh: null } }, 'zh-CN'))
      .toBe('日本 · Kyoto');
    expect(formatPlaceLine({ country: { en: 'Japan', zh: '日本' } }, 'en')).toBe('Japan');
  });

  it('uses English for a part without a Chinese name', () => {
    expect(formatPlaceLine({ country: { en: 'Japan', zh: null }, region: null, city: { en: 'Kyoto', zh: '京都市' } }, 'zh-CN'))
      .toBe('Japan · 京都市');
  });

  it('is empty when nothing is known', () => {
    expect(formatPlaceLine(null, 'en')).toBe('');
    expect(formatPlaceLine({}, 'en')).toBe('');
    expect(formatPlaceLine({ country: { en: null, zh: null }, region: null, city: null }, 'zh-CN')).toBe('');
  });
});

describe('place ids', () => {
  it('knows what lies inside a place, by whole id parts only', () => {
    expect(isPlaceInside('JP.22', 'JP')).toBe(true);
    expect(isPlaceInside('JP.22.1857910', 'JP')).toBe(true);
    expect(isPlaceInside('JP.22.1857910', 'JP.22')).toBe(true);
    expect(isPlaceInside('JP', 'JP')).toBe(false);
    expect(isPlaceInside('JPX.22', 'JP')).toBe(false);
    expect(isPlaceInside('JP.221', 'JP.22')).toBe(false);
    expect(isPlaceInside('JP', 'JP.22')).toBe(false);
    expect(isPlaceInside('JP.22', '')).toBe(false);
    expect(isPlaceInside(null, 'JP')).toBe(false);
  });

  it('finds the selected place that covers an id', () => {
    const selected = [{ id: 'JP', en: 'Japan', zh: '日本' }];
    expect(findSelectedPlaceAncestor(selected, 'JP.22')).toBe(selected[0]);
    expect(findSelectedPlaceAncestor(selected, 'JP')).toBeNull();
    expect(findSelectedPlaceAncestor(selected, 'CN.23')).toBeNull();
    expect(isPlaceSelected(selected, 'JP')).toBe(true);
    expect(isPlaceSelected(selected, 'JP.22')).toBe(false);
  });
});

describe('togglePlaceSelection', () => {
  const japan = { id: 'JP', en: 'Japan', zh: '日本' };
  const kyoto = { id: 'JP.22', en: 'Kyoto Prefecture', zh: '京都府' };
  const osaka = { id: 'JP.32', en: 'Osaka Prefecture', zh: null };
  const china = { id: 'CN', en: 'China', zh: '中国' };

  it('adds a place with its own names', () => {
    expect(togglePlaceSelection([], japan)).toEqual([japan]);
    // Only id and names are kept, whatever else the options node carries.
    expect(togglePlaceSelection([], { ...japan, count: 12, regions: [] })).toEqual([japan]);
  });

  it('stores null names for a region without any', () => {
    expect(togglePlaceSelection([], { id: 'JP.99' })).toEqual([{ id: 'JP.99', en: null, zh: null }]);
    expect(togglePlaceSelection([], { id: 'JP.99', en: null, zh: null })).toEqual([{ id: 'JP.99', en: null, zh: null }]);
  });

  it('removes a selected place', () => {
    expect(togglePlaceSelection([japan, china], japan)).toEqual([china]);
    expect(togglePlaceSelection([japan], japan)).toEqual([]);
  });

  it('drops selected descendants when their ancestor is selected', () => {
    expect(togglePlaceSelection([kyoto, osaka, china], japan)).toEqual([china, japan]);
    const city = { id: 'JP.22.1857910', en: 'Kyoto', zh: '京都市' };
    expect(togglePlaceSelection([city, china], kyoto)).toEqual([china, kyoto]);
  });

  it('returns the same array for a place below a selected one', () => {
    const selected = [japan];
    expect(togglePlaceSelection(selected, kyoto)).toBe(selected);
    expect(togglePlaceSelection(selected, { id: 'JP.22.1857910', en: 'Kyoto', zh: null })).toBe(selected);
  });

  it('keeps a sibling with a shared id prefix separate', () => {
    const jpx = { id: 'JPX', en: 'Other', zh: null };
    expect(togglePlaceSelection([japan], jpx)).toEqual([japan, jpx]);
    expect(togglePlaceSelection([jpx], japan)).toEqual([jpx, japan]);
  });
});
