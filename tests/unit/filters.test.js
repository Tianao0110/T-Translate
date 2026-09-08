// The protected-content filters: what they must catch and what they must
// leave alone. Placeholders survive translation only when the model copies
// them, so over-matching (a decimal as a "version") costs real text.

import { describe, it, expect } from 'vitest';
import { getEnabledFilters } from '../../src/config/filters.js';

const filter = (name) => getEnabledFilters().find((f) => f.name === name);
const matches = (name, text) => {
  const f = filter(name);
  const re = new RegExp(f.pattern.source, f.pattern.flags);
  return text.match(re) || [];
};

describe('version_number filter', () => {
  it('catches prefixed and three-segment versions', () => {
    expect(matches('version_number', 'Update to v1.2.3 or 2.10.0-beta.1, v2.5 works too')).toEqual(['v1.2.3', '2.10.0-beta.1', 'v2.5']);
    expect(matches('version_number', 'Electron 42.0.1 ships Node 22.3.0')).toEqual(['42.0.1', '22.3.0']);
  });

  it('leaves plain decimals and two-segment numbers alone', () => {
    expect(matches('version_number', 'The model loads in 0.3 seconds and costs 12.50 dollars, 99.9% of the time')).toEqual([]);
    expect(matches('version_number', 'Python 3.12 and Windows 11 22H2')).toEqual([]);
  });
});

describe('the other default filters still fire', () => {
  it('url, email and hex colour', () => {
    expect(matches('url', 'see https://example.com/docs now')).toEqual(['https://example.com/docs']);
    expect(matches('email', 'mail me@example.com')).toEqual(['me@example.com']);
    expect(matches('hex_color', 'use #fff or #1a2b3c')).toEqual(['#fff', '#1a2b3c']);
  });
});
