// tests/unit/filters.test.js
// 免译过滤器测试
//
// 覆盖: DEFAULT_FILTERS integrity, validateFilter, createCustomFilter, getEnabledFilters

import { describe, it, expect } from 'vitest';

// Mock logger
import { vi } from 'vitest';
vi.mock('../../src/utils/logger.js', () => ({
  default: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

const {
  DEFAULT_FILTERS,
  validateFilter,
  createCustomFilter,
  getEnabledFilters,
} = await import('../../src/config/filters.js');

describe('DEFAULT_FILTERS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(DEFAULT_FILTERS)).toBe(true);
    expect(DEFAULT_FILTERS.length).toBeGreaterThan(0);
  });

  it('every filter has required fields', () => {
    for (const filter of DEFAULT_FILTERS) {
      expect(filter).toHaveProperty('name');
      expect(filter).toHaveProperty('pattern');
      expect(filter).toHaveProperty('description');
      expect(filter).toHaveProperty('enabled');
      expect(typeof filter.name).toBe('string');
      expect(filter.pattern).toBeInstanceOf(RegExp);
      expect(filter.pattern.global).toBe(true);  // must have g flag
    }
  });

  it('has unique names', () => {
    const names = DEFAULT_FILTERS.map(f => f.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('includes code_block filter', () => {
    const codeBlock = DEFAULT_FILTERS.find(f => f.name === 'code_block');
    expect(codeBlock).toBeDefined();
    expect(codeBlock.pattern.test('```\ncode\n```')).toBe(true);
  });

  it('includes url filter', () => {
    const url = DEFAULT_FILTERS.find(f => f.name === 'url');
    expect(url).toBeDefined();
    expect(url.pattern.test('https://example.com')).toBe(true);
    expect(url.pattern.test('http://test.org/path')).toBe(true);
  });

  it('includes email filter', () => {
    const email = DEFAULT_FILTERS.find(f => f.name === 'email');
    expect(email).toBeDefined();
    // Reset lastIndex for global regex
    email.pattern.lastIndex = 0;
    expect(email.pattern.test('user@example.com')).toBe(true);
  });

  it('includes inline_code filter', () => {
    const inlineCode = DEFAULT_FILTERS.find(f => f.name === 'inline_code');
    expect(inlineCode).toBeDefined();
    inlineCode.pattern.lastIndex = 0;
    expect(inlineCode.pattern.test('use `const x = 1` here')).toBe(true);
  });
});

describe('validateFilter', () => {
  it('accepts valid filter', () => {
    expect(validateFilter({
      name: 'test',
      pattern: /test/g,
      description: 'test filter',
      enabled: true,
    })).toBe(true);
  });

  it('rejects null/undefined', () => {
    expect(validateFilter(null)).toBe(false);
    expect(validateFilter(undefined)).toBe(false);
  });

  it('rejects filter without name', () => {
    expect(validateFilter({ pattern: /test/g })).toBe(false);
  });

  it('rejects filter with non-string name', () => {
    expect(validateFilter({ name: 123, pattern: /test/g })).toBe(false);
  });

  it('rejects filter without pattern', () => {
    expect(validateFilter({ name: 'test' })).toBe(false);
  });

  it('rejects filter with non-RegExp pattern', () => {
    expect(validateFilter({ name: 'test', pattern: 'not a regex' })).toBe(false);
  });

  it('rejects filter without global flag', () => {
    expect(validateFilter({ name: 'test', pattern: /test/ })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(validateFilter('string')).toBe(false);
    expect(validateFilter(42)).toBe(false);
    expect(validateFilter([])).toBe(false);
  });
});

describe('createCustomFilter', () => {
  it('creates a valid filter from regex string', () => {
    const filter = createCustomFilter('my-filter', '\\d+', 'Match numbers');
    expect(filter).not.toBeNull();
    expect(filter.name).toBe('my-filter');
    expect(filter.pattern).toBeInstanceOf(RegExp);
    expect(filter.pattern.global).toBe(true);
    expect(filter.pattern.test('123')).toBe(true);
    expect(filter.description).toBe('Match numbers');
  });

  it('returns null for invalid regex', () => {
    const filter = createCustomFilter('bad', '[invalid', 'Bad regex');
    expect(filter).toBeNull();
  });

  it('returns null for empty name', () => {
    const filter = createCustomFilter('', '\\d+', 'desc');
    expect(filter).toBeNull();
  });
});

describe('getEnabledFilters', () => {
  it('returns only enabled default filters', () => {
    const enabled = getEnabledFilters();
    expect(Array.isArray(enabled)).toBe(true);
    for (const f of enabled) {
      expect(f.enabled).toBe(true);
    }
  });

  it('all returned filters pass validation', () => {
    const enabled = getEnabledFilters();
    for (const f of enabled) {
      expect(validateFilter(f)).toBe(true);
    }
  });
});
