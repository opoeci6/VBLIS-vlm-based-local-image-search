import { describe, expect, it } from 'vitest';
import { isJsonEqual, keepIfEqual } from './jsonEqual';

describe('isJsonEqual', () => {
  it('compares primitives and null', () => {
    expect(isJsonEqual(1, 1)).toBe(true);
    expect(isJsonEqual('a', 'a')).toBe(true);
    expect(isJsonEqual(true, true)).toBe(true);
    expect(isJsonEqual(null, null)).toBe(true);
    expect(isJsonEqual(undefined, undefined)).toBe(true);
    expect(isJsonEqual(NaN, NaN)).toBe(true);
    expect(isJsonEqual(1, 2)).toBe(false);
    expect(isJsonEqual(1, '1')).toBe(false);
    expect(isJsonEqual(0, false)).toBe(false);
    expect(isJsonEqual(null, 0)).toBe(false);
    expect(isJsonEqual(null, {})).toBe(false);
    expect(isJsonEqual({}, null)).toBe(false);
    expect(isJsonEqual(null, undefined)).toBe(false);
  });

  it('compares nested objects and arrays structurally', () => {
    const make = () => ({ a: 1, b: [1, { c: 'x', d: [null, true] }], e: { f: { g: 2 } } });
    expect(isJsonEqual(make(), make())).toBe(true);
    const changed = make();
    changed.b[1].d[1] = false;
    expect(isJsonEqual(make(), changed)).toBe(false);
    const deep = make();
    deep.e.f.g = 3;
    expect(isJsonEqual(make(), deep)).toBe(false);
  });

  it('is order sensitive for arrays and length sensitive', () => {
    expect(isJsonEqual([1, 2], [2, 1])).toBe(false);
    expect(isJsonEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(isJsonEqual([], [])).toBe(true);
    expect(isJsonEqual([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }])).toBe(true);
    expect(isJsonEqual([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }])).toBe(false);
  });

  it('ignores object key order but not key sets', () => {
    expect(isJsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(isJsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isJsonEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(isJsonEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });

  it('does not treat undefined and a missing key as equal', () => {
    expect(isJsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(false);
    expect(isJsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(isJsonEqual({ a: undefined, c: 1 }, { b: undefined, c: 1 })).toBe(false);
  });

  it('never equates an array with an object', () => {
    expect(isJsonEqual([], {})).toBe(false);
    expect(isJsonEqual({}, [])).toBe(false);
    expect(isJsonEqual({ 0: 'a' }, ['a'])).toBe(false);
  });
});

describe('keepIfEqual', () => {
  it('returns the previous reference when equal', () => {
    const prev = { a: [1, 2] };
    expect(keepIfEqual({ a: [1, 2] })(prev)).toBe(prev);
  });

  it('returns the next value when different', () => {
    const prev = { a: [1, 2] };
    const next = { a: [1, 3] };
    expect(keepIfEqual(next)(prev)).toBe(next);
  });

  it('works with primitives and null', () => {
    expect(keepIfEqual(null)(null)).toBeNull();
    expect(keepIfEqual(2)(1)).toBe(2);
  });
});
