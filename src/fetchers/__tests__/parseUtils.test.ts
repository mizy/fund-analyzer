import { describe, it, expect } from 'vitest';
import { extractVar, extractJsonVar, toNavArray } from '../parseUtils.js';
import type { NavPoint } from '../parseUtils.js';

// ====== extractVar ======

describe('extractVar', () => {
  it('extracts quoted string variable', () => {
    expect(extractVar('var fS_name = "华夏成长";', 'fS_name')).toBe('华夏成长');
  });

  it('extracts unquoted number variable', () => {
    expect(extractVar('var fS_code = 000001;', 'fS_code')).toBe('000001');
  });

  it('extracts empty string variable', () => {
    expect(extractVar('var fS_name = "";', 'fS_name')).toBe('');
  });

  it('returns null when variable not found', () => {
    expect(extractVar('var other = "hello";', 'fS_name')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractVar('', 'fS_name')).toBeNull();
  });

  it('handles multiple variables, extracts correct one', () => {
    const js = 'var a = "first"; var b = "second"; var c = "third";';
    expect(extractVar(js, 'b')).toBe('second');
  });

  it('handles variable with spaces around equals', () => {
    expect(extractVar('var  fS_name  =  "test"  ;', 'fS_name')).toBe('test');
  });
});

// ====== extractJsonVar ======

describe('extractJsonVar', () => {
  it('extracts simple array', () => {
    const js = 'var data = [1, 2, 3];';
    expect(extractJsonVar<number[]>(js, 'data')).toEqual([1, 2, 3]);
  });

  it('extracts simple object', () => {
    const js = 'var obj = {"key": "value", "num": 42};';
    expect(extractJsonVar<Record<string, unknown>>(js, 'obj')).toEqual({ key: 'value', num: 42 });
  });

  it('extracts array of objects', () => {
    const js = 'var items = [{"x": 1, "y": 2.5}, {"x": 3, "y": 4.0}];';
    const result = extractJsonVar<Array<{ x: number; y: number }>>(js, 'items');
    expect(result).toEqual([{ x: 1, y: 2.5 }, { x: 3, y: 4.0 }]);
  });

  it('extracts nested objects', () => {
    const js = 'var data = {"a": {"b": [1, 2]}};';
    expect(extractJsonVar(js, 'data')).toEqual({ a: { b: [1, 2] } });
  });

  it('handles strings with semicolons inside', () => {
    // Semicolons inside strings should not end parsing
    const js = 'var data = ["a;b", "c;d"];';
    expect(extractJsonVar<string[]>(js, 'data')).toEqual(['a;b', 'c;d']);
  });

  it('handles escaped quotes in strings', () => {
    const js = 'var data = ["he said \\"hello\\""];';
    expect(extractJsonVar<string[]>(js, 'data')).toEqual(['he said "hello"']);
  });

  it('returns null when variable not found', () => {
    expect(extractJsonVar('var other = [1];', 'data')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    // Not valid JSON (missing quotes on keys)
    const js = 'var data = {key: "value"};';
    expect(extractJsonVar(js, 'data')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractJsonVar('', 'data')).toBeNull();
  });

  it('extracts from multi-line script with other variables', () => {
    const js = `
      var fS_name = "test";
      var Data_netWorthTrend = [{"x":1609459200000,"y":1.5,"equityReturn":5.0,"unitMoney":"1.00"}];
      var Data_other = "ignore";
    `;
    const result = extractJsonVar<NavPoint[]>(js, 'Data_netWorthTrend');
    expect(result).toEqual([{ x: 1609459200000, y: 1.5, equityReturn: 5.0, unitMoney: '1.00' }]);
  });

  it('handles empty array', () => {
    expect(extractJsonVar('var data = [];', 'data')).toEqual([]);
  });

  it('handles empty object', () => {
    expect(extractJsonVar('var data = {};', 'data')).toEqual({});
  });
});

// ====== toNavArray ======

describe('toNavArray', () => {
  it('converts NavPoint array to [timestamp, nav] array', () => {
    const input: NavPoint[] = [
      { x: 1609459200000, y: 1.0, equityReturn: 0, unitMoney: '1.00' },
      { x: 1609545600000, y: 1.05, equityReturn: 5, unitMoney: '1.05' },
    ];
    expect(toNavArray(input)).toEqual([
      [1609459200000, 1.0],
      [1609545600000, 1.05],
    ]);
  });

  it('returns null for null input', () => {
    expect(toNavArray(null)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(toNavArray([])).toBeNull();
  });

  it('handles single element', () => {
    const input: NavPoint[] = [
      { x: 1609459200000, y: 2.5, equityReturn: 10, unitMoney: '2.50' },
    ];
    expect(toNavArray(input)).toEqual([[1609459200000, 2.5]]);
  });
});
