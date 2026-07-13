// display-mode: scattered-vs-unified heuristic, word-pile detection,
// pane-granularity choice, and the settings-driven tri-state override.

import { describe, it, expect } from 'vitest';
import {
  shouldUseScatteredMode,
  resolveDisplayMode,
  isWordPile,
  isSparseCoverage,
  pickScatterBlocks,
} from '../../src/services/display-mode.js';

const block = (x, y, width, height, text = 'text') => ({ text, bbox: { x, y, width, height } });

// Wide left-aligned lines with tight spacing (article paragraph shape)
const paragraphBlocks = [
  block(10, 10, 400, 20, '这是一段清楚的段落文字第一行内容示例'),
  block(10, 34, 390, 20, '第二行继续保持左对齐与稳定行距的文字'),
  block(10, 58, 405, 20, '第三行也是同样宽度的正文内容文字示例'),
  block(10, 82, 200, 20, '最后一行较短。'),
];

// Same-frame labels flung across the canvas (UI shape)
const scatteredBlocks = [
  block(10, 10, 80, 18, 'File'),
  block(400, 12, 60, 18, 'Edit'),
  block(30, 300, 90, 18, 'Options'),
];

// Tight aligned column of standalone words (vocab-list shape) — the old
// column test judged this unified; users want one bubble per word
const vocabBlocks = [
  block(20, 10, 70, 20, 'apple'),
  block(20, 36, 90, 20, 'banana'),
  block(20, 62, 60, 20, 'plum'),
  block(20, 88, 80, 20, 'cherry'),
  block(20, 114, 75, 20, 'grape'),
];

// Two bubble-like clusters of wide lines separated by a large gap (manga/
// dialog shape) — lines within a cluster are adjacent, clusters are far apart
const bubbleBlocks = [
  block(20, 10, 180, 20, 'それはちがうと思うよ'),
  block(20, 32, 170, 20, '昨日のことだけどね'),
  block(240, 200, 175, 20, '本当にそうなのか？'),
  block(240, 222, 160, 20, 'わからないけど。'),
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

  it('treats a clear paragraph as unified', () => {
    expect(shouldUseScatteredMode(paragraphBlocks)).toBe(false);
  });

  it('tolerates a single indented first line (median alignment, not pairwise)', () => {
    const indented = [
      block(50, 10, 360, 20, '首行缩进的段落第一行文字内容示例文字'),
      ...paragraphBlocks.slice(1),
    ];
    expect(shouldUseScatteredMode(indented)).toBe(false);
  });

  it('treats a centered stanza as unified (center alignment counts as a column)', () => {
    const centered = [
      block(100, 10, 200, 20, '居中的第一句诗行'),
      block(60, 34, 280, 20, '第二句比第一句要长一些'),
      block(120, 58, 160, 20, '第三句短一点'),
    ];
    expect(shouldUseScatteredMode(centered)).toBe(false);
  });

  it('treats dispersed blocks as scattered', () => {
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

  it('treats an aligned word pile as scattered (vocab lists want per-word bubbles)', () => {
    expect(shouldUseScatteredMode(vocabBlocks)).toBe(true);
  });

  it('bubble clusters scatter via the vertical gap, not the pile rule', () => {
    expect(isWordPile(bubbleBlocks)).toBe(false);
    expect(shouldUseScatteredMode(bubbleBlocks)).toBe(true);
  });

  it('a lone centered bubble in a large frame scatters via sparse coverage (manga)', () => {
    const singleBubble = [
      block(800, 300, 220, 24, 'A SKILL THAT'),
      block(790, 330, 240, 24, 'RAPIDLY REPAIRS'),
      block(810, 360, 180, 24, 'INJURIES?'),
    ];
    // Perfect centered column — without the frame it reads as unified…
    expect(shouldUseScatteredMode(singleBubble, null)).toBe(false);
    // …but covering <1% of a manga page it must overlay in place.
    expect(shouldUseScatteredMode(singleBubble, { width: 2000, height: 1200 })).toBe(true);
  });

  it('a paragraph filling its capture frame stays unified despite the frame', () => {
    expect(shouldUseScatteredMode(paragraphBlocks, { width: 430, height: 110 })).toBe(false);
  });
});

describe('isSparseCoverage', () => {
  it('is false without a frame or without blocks', () => {
    expect(isSparseCoverage(paragraphBlocks, null)).toBe(false);
    expect(isSparseCoverage([], { width: 100, height: 100 })).toBe(false);
  });

  it('separates islands-over-imagery from frame-filling text', () => {
    expect(isSparseCoverage([block(800, 300, 200, 24)], { width: 2000, height: 1200 })).toBe(true);
    expect(isSparseCoverage(paragraphBlocks, { width: 430, height: 110 })).toBe(false);
  });
});

describe('isWordPile', () => {
  it('requires at least 4 blocks', () => {
    expect(isWordPile(vocabBlocks.slice(0, 3))).toBe(false);
  });

  it('rejects wide paragraph lines', () => {
    expect(isWordPile(paragraphBlocks)).toBe(false);
  });

  it('accepts word-sized boxes', () => {
    expect(isWordPile(vocabBlocks)).toBe(true);
  });
});

describe('pickScatterBlocks', () => {
  const mergedIntoOne = [block(20, 10, 90, 124, 'apple banana plum cherry grape')];
  const mergedBubbles = [
    block(20, 10, 180, 42, 'それはちがうと思うよ 昨日のことだけどね'),
    block(240, 200, 175, 42, '本当にそうなのか？ わからないけど。'),
  ];

  it('keeps raw blocks for word piles (per-word positioning is the point)', () => {
    expect(pickScatterBlocks(vocabBlocks, mergedIntoOne)).toBe(vocabBlocks);
  });

  it('accepts audited bubble merges (constituents aligned, similar width, tight)', () => {
    expect(pickScatterBlocks(bubbleBlocks, mergedBubbles)).toEqual(mergedBubbles);
  });

  it('splits a merge that glued a list row to its neighbor badge/index back to raw lines', () => {
    // "list row + badge + next row" glued into one box — widths differ wildly
    const rowA = block(10, 10, 300, 20, '巴威已进入安徽');
    const badge = block(320, 12, 40, 18, '热2');
    const rowB = block(10, 38, 380, 20, '遭遇强降雨有关险情如何避险自救');
    const glued = [block(10, 10, 420, 48, '巴威已进入安徽 热2 遭遇强降雨有关险情如何避险自救')];
    expect(pickScatterBlocks([rowA, badge, rowB], glued)).toEqual([rowA, badge, rowB]);
  });

  it('never drops raw lines no merged box claimed', () => {
    const orphan = block(500, 500, 120, 20, 'orphan');
    const merged = [block(20, 10, 180, 42, 'それはちがうと思うよ 昨日のことだけどね')];
    const out = pickScatterBlocks([bubbleBlocks[0], bubbleBlocks[1], orphan], merged);
    expect(out).toContain(orphan);
    expect(out).toContainEqual(merged[0]);
  });

  it('falls back to raw blocks when merged input is empty or unpositioned', () => {
    expect(pickScatterBlocks(scatteredBlocks, [])).toBe(scatteredBlocks);
    expect(pickScatterBlocks(scatteredBlocks, [{ text: 'x' }])).toBe(scatteredBlocks);
  });
});

describe('resolveDisplayMode', () => {
  it('auto delegates to the heuristic and carries pane blocks', () => {
    expect(resolveDisplayMode('auto', paragraphBlocks, [])).toEqual({
      useScattered: false, fellBack: false, blocks: null,
    });
    const r = resolveDisplayMode('auto', scatteredBlocks, []);
    expect(r.useScattered).toBe(true);
    expect(r.fellBack).toBe(false);
    expect(r.blocks).toBe(scatteredBlocks);
  });

  it('forced unified never scatters, even for scattered-looking blocks', () => {
    expect(resolveDisplayMode('unified', scatteredBlocks, []).useScattered).toBe(false);
  });

  it('forced scattered overrides the heuristic for paragraph blocks', () => {
    const r = resolveDisplayMode('scattered', paragraphBlocks, []);
    expect(r.useScattered).toBe(true);
    expect(r.blocks).toBe(paragraphBlocks);
  });

  it('forced scattered works for a single positioned block (heuristic would refuse)', () => {
    expect(resolveDisplayMode('scattered', [block(5, 5, 120, 20)], []).useScattered).toBe(true);
  });

  it('forced scattered falls back to unified when no block has coordinates', () => {
    const noCoords = [{ text: 'hello' }, { text: 'world' }];
    expect(resolveDisplayMode('scattered', noCoords, [])).toEqual({
      useScattered: false, fellBack: true, blocks: null,
    });
  });

  it('forced scattered falls back when positioned blocks carry no text', () => {
    const emptyText = [block(5, 5, 100, 20, '  '), block(5, 40, 100, 20, '')];
    expect(resolveDisplayMode('scattered', emptyText, [])).toEqual({
      useScattered: false, fellBack: true, blocks: null,
    });
  });

  it('unknown/missing pref behaves like auto', () => {
    expect(resolveDisplayMode(undefined, scatteredBlocks, []).useScattered).toBe(true);
  });
});
