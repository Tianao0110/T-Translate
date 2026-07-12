// display-mode: scattered-vs-unified heuristic + tri-state manual override.

import { describe, it, expect } from 'vitest';
import { shouldUseScatteredMode, resolveDisplayMode } from '../../src/services/display-mode.js';

const block = (x, y, width, height, text = 'text') => ({ text, bbox: { x, y, width, height } });

// A tight left-aligned column of lines (paragraph shape)
const columnBlocks = [
  block(10, 10, 200, 20),
  block(10, 34, 190, 20),
  block(12, 58, 205, 20),
];

// Same-frame labels flung across the canvas (UI shape)
const scatteredBlocks = [
  block(10, 10, 80, 18),
  block(400, 12, 60, 18),
  block(30, 300, 90, 18),
];

describe('shouldUseScatteredMode', () => {
  it('returns false for empty or single-block input', () => {
    expect(shouldUseScatteredMode([])).toBe(false);
    expect(shouldUseScatteredMode(null)).toBe(false);
    expect(shouldUseScatteredMode([block(0, 0, 100, 20)])).toBe(false);
  });

  it('returns false without usable coordinates', () => {
    const noCoords = [{ text: 'a' }, { text: 'b', bbox: { x: 0, y: 0, width: 0, height: 0 } }];
    expect(shouldUseScatteredMode(noCoords)).toBe(false);
  });

  it('treats a vertically aligned column as unified', () => {
    expect(shouldUseScatteredMode(columnBlocks)).toBe(false);
  });

  it('treats horizontally/vertically dispersed blocks as scattered', () => {
    expect(shouldUseScatteredMode(scatteredBlocks)).toBe(true);
  });

  it('breaks the column on a vertical gap larger than 2x line height', () => {
    const gapped = [
      block(10, 10, 200, 20),
      block(10, 34, 200, 20),
      block(10, 200, 200, 20),
    ];
    expect(shouldUseScatteredMode(gapped)).toBe(true);
  });
});

describe('resolveDisplayMode', () => {
  it('auto delegates to the heuristic', () => {
    expect(resolveDisplayMode('auto', columnBlocks)).toEqual({ useScattered: false, fellBack: false });
    expect(resolveDisplayMode('auto', scatteredBlocks)).toEqual({ useScattered: true, fellBack: false });
  });

  it('forced unified never scatters, even for scattered-looking blocks', () => {
    expect(resolveDisplayMode('unified', scatteredBlocks)).toEqual({ useScattered: false, fellBack: false });
  });

  it('forced scattered overrides the heuristic for column blocks', () => {
    expect(resolveDisplayMode('scattered', columnBlocks)).toEqual({ useScattered: true, fellBack: false });
  });

  it('forced scattered works for a single positioned block (heuristic would refuse)', () => {
    expect(resolveDisplayMode('scattered', [block(5, 5, 120, 20)])).toEqual({ useScattered: true, fellBack: false });
  });

  it('forced scattered falls back to unified when no block has coordinates', () => {
    const noCoords = [{ text: 'hello' }, { text: 'world' }];
    expect(resolveDisplayMode('scattered', noCoords)).toEqual({ useScattered: false, fellBack: true });
  });

  it('forced scattered falls back when positioned blocks carry no text', () => {
    const emptyText = [block(5, 5, 100, 20, '  '), block(5, 40, 100, 20, '')];
    expect(resolveDisplayMode('scattered', emptyText)).toEqual({ useScattered: false, fellBack: true });
  });

  it('unknown/missing pref behaves like auto', () => {
    expect(resolveDisplayMode(undefined, scatteredBlocks)).toEqual({ useScattered: true, fellBack: false });
  });
});
