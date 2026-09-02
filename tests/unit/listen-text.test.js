import { describe, it, expect } from 'vitest';
import { normalizeDraftCase } from '../../src/utils/listen-text.js';

describe('normalizeDraftCase', () => {
  it('lowers an all-caps draft and capitalizes sentence starts', () => {
    expect(normalizeDraftCase('LEVEL MEETING')).toBe('Level meeting');
    expect(normalizeDraftCase('SUDDENLY THEY ARE ON A BEACH. I LOST MY TIME')).toBe('Suddenly they are on a beach. I lost my time');
  });

  it('leaves mixed-case and non-Latin text untouched', () => {
    expect(normalizeDraftCase('Level meeting')).toBe('Level meeting');
    expect(normalizeDraftCase('喝醉后的梦里')).toBe('喝醉后的梦里');
    expect(normalizeDraftCase('OK 我往前')).toBe('OK 我往前'); // two letters, all caps, but that is an acronym-sized token
  });

  it('passes empty input through', () => {
    expect(normalizeDraftCase('')).toBe('');
    expect(normalizeDraftCase(undefined)).toBeUndefined();
  });
});
