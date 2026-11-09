import { describe, expect, it } from 'vitest';

// Guards for the translation catalogs (src/i18n/locales/<language>/<namespace>.json):
//  - every literal t('...') / i18n.t('...') key in the source exists in the English catalogs;
//  - zh-CN has no key that English lacks, and keeps the same {{placeholders}};
//  - (later) every English key has a zh-CN value;
//  - the JSON is valid, has no duplicate keys and no keys that break dot paths.

// T3 turns this on: every English key must then have a zh-CN value. The other zh-CN checks are always on.
const REQUIRE_FULL_ZH = false;

const rawCatalogs = import.meta.glob('./locales/*/*.json', { eager: true, query: '?raw', import: 'default' });
const rawSources = import.meta.glob('../**/*.{js,jsx}', { eager: true, query: '?raw', import: 'default' });

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const stripPlural = (key) => key.replace(PLURAL_SUFFIX, '');

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

// Throws on a duplicate key in the same object, which JSON.parse accepts silently (the last one wins).
function findDuplicateKeys(text) {
  const duplicates = [];
  const scopes = []; // one Set of keys per open object; null for an array
  let i = 0;
  const readString = () => {
    let out = '';
    i += 1;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') { out += text[i] + text[i + 1]; i += 2; } else { out += text[i]; i += 1; }
    }
    i += 1;
    return out;
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') { scopes.push(new Set()); i += 1; }
    else if (ch === '[') { scopes.push(null); i += 1; }
    else if (ch === '}' || ch === ']') { scopes.pop(); i += 1; }
    else if (ch === '"') {
      const value = readString();
      let j = i;
      while (/\s/.test(text[j] ?? '')) j += 1;
      const scope = scopes[scopes.length - 1];
      if (text[j] === ':' && scope) {
        if (scope.has(value)) duplicates.push(value);
        scope.add(value);
      }
    } else i += 1;
  }
  return duplicates;
}

// { language: { namespace: parsedJson } } plus the raw text for the duplicate check.
const catalogs = {};
const rawText = {};
for (const [path, text] of Object.entries(rawCatalogs)) {
  const [, language, namespace] = /^\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  rawText[`${language}/${namespace}`] = text;
  (catalogs[language] ??= {})[namespace] = JSON.parse(text);
}

// { 'ns:dot.path': 'string' } for every leaf of one language.
const flatten = (language) => {
  const flat = {};
  const walk = (node, prefix, namespace) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) walk(value, path, namespace);
      else flat[`${namespace}:${path}`] = value;
    }
  };
  for (const [namespace, catalog] of Object.entries(catalogs[language] ?? {})) walk(catalog, '', namespace);
  return flat;
};

const en = flatten('en');
const zh = flatten('zh-CN');
const enBaseKeys = new Set(Object.keys(en).map(stripPlural));

const placeholders = (text) => [...String(text).matchAll(/\{\{\s*([\w.]+)/g)].map(match => match[1]).sort();

// ---------------------------------------------------------------------------------------------
// Static scan of the source for literal keys
// ---------------------------------------------------------------------------------------------

const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// [{ ns, key }] for every t('...') and i18n.t('...') call whose key is a plain string literal.
function scanKeys(source) {
  const code = stripComments(source);
  const defaultNs = /useTranslation\(\s*\[?\s*['"]([\w-]+)['"]/.exec(code)?.[1] ?? 'common';
  const found = [];
  const call = /(?<![\w$.])(?:i18n\.)?t\(\s*(['"`])([^'"`$\\\n]+)\1/g;
  for (const match of code.matchAll(call)) {
    const raw = match[2];
    const colon = raw.indexOf(':');
    found.push(colon > 0 ? { ns: raw.slice(0, colon), key: raw.slice(colon + 1) } : { ns: defaultNs, key: raw });
  }
  return found;
}

const isSourceToScan = (path) => !/\.test\.[jt]sx?$/.test(path) && !path.startsWith('../test/');

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('scanKeys', () => {
  it('uses an explicit namespace, then useTranslation, then common', () => {
    const source = `
      const { t } = useTranslation('queue');
      t('title'); t("other:name"); i18n.t('format:duration.zero');
    `;
    expect(scanKeys(source)).toEqual([
      { ns: 'queue', key: 'title' },
      { ns: 'other', key: 'name' },
      { ns: 'format', key: 'duration.zero' },
    ]);
    expect(scanKeys(`t('a.b')`)).toEqual([{ ns: 'common', key: 'a.b' }]);
  });

  it('skips dynamic keys, other calls ending in t( and comments', () => {
    const source = `
      // t('commented.out')
      /* i18n.t('block.comment') */
      t(\`key.\${id}\`); t(name); split('x'); getText('y'); obj.t('z'); i18n.exists('w');
    `;
    expect(scanKeys(source)).toEqual([]);
  });

  it('finds duplicate keys', () => {
    expect(findDuplicateKeys('{"a":1,"b":{"a":2},"a":3}')).toEqual(['a']);
    expect(findDuplicateKeys('{"a":1,"b":{"a":2}}')).toEqual([]);
    expect(findDuplicateKeys('{"a":"x: y","b":["a","a"]}')).toEqual([]);
  });
});

describe('catalog files', () => {
  it('has the same namespaces in every language', () => {
    expect(Object.keys(catalogs).sort()).toEqual(['en', 'zh-CN']);
    expect(Object.keys(catalogs['zh-CN']).sort()).toEqual(Object.keys(catalogs.en).sort());
    expect(Object.keys(catalogs.en).sort()).toEqual([
      'common', 'filters', 'folders', 'format', 'home', 'media', 'messages', 'queue', 'search', 'settings', 'status',
    ]);
  });

  it('has no duplicate keys', () => {
    for (const [name, text] of Object.entries(rawText)) {
      expect(findDuplicateKeys(text), name).toEqual([]);
    }
  });

  it('holds only strings and nested objects, with keys that work as dot paths', () => {
    for (const flat of [en, zh]) {
      for (const [path, value] of Object.entries(flat)) {
        expect(typeof value, path).toBe('string');
        const key = path.slice(path.indexOf(':') + 1);
        for (const part of key.split('.')) {
          expect(part, path).not.toBe('');
          expect(part, path).not.toMatch(/[:]/);
        }
      }
    }
  });

  it('gives every English _one form an _other form', () => {
    for (const path of Object.keys(en)) {
      if (path.endsWith('_one')) expect(en[`${stripPlural(path)}_other`], path).toBeDefined();
    }
  });
});

describe('keys used in the source', () => {
  const has = (flat, ns, key) => [key, `${key}_one`, `${key}_other`].some(candidate => `${ns}:${candidate}` in flat);

  it('scans some keys at all', () => {
    const all = Object.entries(rawSources)
      .filter(([path]) => isSourceToScan(path))
      .flatMap(([, source]) => scanKeys(source));
    expect(all.length).toBeGreaterThan(10);
  });

  it('exist in the English catalogs', () => {
    const missing = [];
    for (const [path, source] of Object.entries(rawSources)) {
      if (!isSourceToScan(path)) continue;
      for (const { ns, key } of scanKeys(source)) {
        if (!has(en, ns, key)) missing.push(`${path}: ${ns}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('zh-CN against en', () => {
  it('has no key that English lacks', () => {
    const extra = Object.keys(zh).filter(path => !enBaseKeys.has(stripPlural(path)));
    expect(extra).toEqual([]);
  });

  it('keeps the same {{placeholders}}', () => {
    const mismatched = [];
    for (const [path, value] of Object.entries(zh)) {
      const reference = en[path] ?? en[`${stripPlural(path)}_other`];
      if (reference === undefined) continue; // reported by the test above
      if (placeholders(value).join() !== placeholders(reference).join()) {
        mismatched.push(`${path}: zh ${placeholders(value)} vs en ${placeholders(reference)}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  // Chinese has one plural form: an English _one/_other pair needs only zh _other.
  (REQUIRE_FULL_ZH ? it : it.skip)('has a value (an empty one counts) for every English key', () => {
    const missing = Object.keys(en).filter((path) => {
      if (path.endsWith('_one')) return false;
      return typeof zh[path] !== 'string';
    });
    expect(missing).toEqual([]);
  });
});
