// tests/unit/text-merger.test.js
// OCR 文本段落合并算法测试
//
// 覆盖: smartMerge, mergedBlocksToText, 边界情况

import { describe, it, expect } from 'vitest';

// text-merger is CommonJS (main process), use require-style import
const { smartMerge, mergedBlocksToText } = await import('../../electron/utils/text-merger.js');

// ========== Helper ==========

function block(text, x, y, width, height, confidence = 0.9) {
  return { text, bbox: { x, y, width, height }, confidence };
}

// ========== Tests ==========

describe('smartMerge', () => {
  describe('edge cases', () => {
    it('returns empty array for null/undefined', () => {
      expect(smartMerge(null)).toEqual([]);
      expect(smartMerge(undefined)).toEqual([]);
      expect(smartMerge([])).toEqual([]);
    });

    it('returns single block unchanged', () => {
      const blocks = [block('Hello', 10, 10, 100, 20)];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Hello');
    });

    it('filters out blocks with empty text', () => {
      const blocks = [
        block('', 10, 10, 100, 20),
        block('   ', 10, 40, 100, 20),
        block('Valid', 10, 70, 100, 20),
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Valid');
    });

    it('filters out blocks with zero height', () => {
      const blocks = [
        block('Zero height', 10, 10, 100, 0),
        block('Valid', 10, 40, 100, 20),
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Valid');
    });

    it('filters out blocks with null bbox', () => {
      const blocks = [
        { text: 'No bbox', bbox: null },
        block('Valid', 10, 10, 100, 20),
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
    });
  });

  describe('same-line merging', () => {
    it('merges blocks on the same line with space', () => {
      const blocks = [
        block('Hello', 10, 10, 50, 20),
        block('World', 70, 10, 50, 20),
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Hello World');
    });

    it('merges multiple words on same line', () => {
      const blocks = [
        block('The', 10, 10, 30, 20),
        block('quick', 45, 10, 40, 20),
        block('fox', 90, 10, 30, 20),
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('The quick fox');
    });
  });

  describe('vertical paragraph merging', () => {
    it('merges consecutive lines into one paragraph', () => {
      const blocks = [
        block('Line one', 10, 10, 200, 20),
        block('Line two', 10, 32, 200, 20),    // gap = 2, well within 1.5 * 20 = 30
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('Line one');
      expect(result[0].text).toContain('Line two');
    });

    it('separates blocks with large vertical gap', () => {
      const blocks = [
        block('Paragraph 1', 10, 10, 200, 20),
        block('Paragraph 2', 10, 100, 200, 20),  // gap = 70, >> 1.5 * 20 = 30
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('Paragraph 1');
      expect(result[1].text).toBe('Paragraph 2');
    });
  });

  describe('X overlap detection', () => {
    it('does not merge vertically close blocks with no X overlap', () => {
      const blocks = [
        block('Left column', 10, 10, 100, 20),
        block('Right column', 300, 32, 100, 20),  // close in Y but far in X
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(2);
    });

    it('merges indented text with sufficient overlap', () => {
      const blocks = [
        block('First line of paragraph', 10, 10, 300, 20),
        block('Second line continues', 30, 32, 280, 20),  // slight indent, still overlaps
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
    });
  });

  describe('sorting', () => {
    it('sorts by Y coordinate before merging', () => {
      // Blocks given in reverse order
      const blocks = [
        block('Line 2', 10, 40, 200, 20),
        block('Line 1', 10, 10, 200, 20),
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toMatch(/Line 1.*Line 2/s);
    });

    it('sorts by X when Y is similar', () => {
      const blocks = [
        block('World', 100, 10, 50, 20),
        block('Hello', 10, 10, 50, 20),
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Hello World');
    });
  });

  describe('bbox expansion', () => {
    it('expands merged bbox to cover all blocks', () => {
      const blocks = [
        block('Top', 10, 10, 100, 20),
        block('Bottom', 10, 32, 150, 20),
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].bbox.x).toBe(10);
      expect(result[0].bbox.y).toBe(10);
      expect(result[0].bbox.width).toBe(150);   // max of widths
      expect(result[0].bbox.height).toBe(42);   // 32 + 20 - 10
    });
  });

  describe('confidence averaging', () => {
    it('averages confidence of merged blocks', () => {
      const blocks = [
        block('High', 10, 10, 100, 20, 1.0),
        block('Low', 10, 32, 100, 20, 0.5),
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBeCloseTo(0.75, 1);
    });
  });

  describe('custom options', () => {
    it('respects lineGapThreshold', () => {
      const blocks = [
        block('Line 1', 10, 10, 200, 20),
        block('Line 2', 10, 45, 200, 20),  // gap = 15, 15/20 = 0.75
      ];

      // With tight threshold (0.5), should separate
      const tight = smartMerge(blocks, { lineGapThreshold: 0.5 });
      expect(tight).toHaveLength(2);

      // With loose threshold (2.0), should merge
      const loose = smartMerge(blocks, { lineGapThreshold: 2.0 });
      expect(loose).toHaveLength(1);
    });
  });

  describe('mergedCount tracking', () => {
    it('tracks how many blocks were merged', () => {
      const blocks = [
        block('A', 10, 10, 100, 20),
        block('B', 10, 32, 100, 20),
        block('C', 10, 54, 100, 20),
      ];
      const result = smartMerge(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].mergedCount).toBe(3);
    });

    it('single block has mergedCount 1', () => {
      const result = smartMerge([block('Solo', 10, 10, 100, 20)]);
      expect(result[0].mergedCount).toBe(1);
    });
  });
});

describe('mergedBlocksToText', () => {
  it('returns empty string for empty/null input', () => {
    expect(mergedBlocksToText([])).toBe('');
    expect(mergedBlocksToText(null)).toBe('');
    expect(mergedBlocksToText(undefined)).toBe('');
  });

  it('joins paragraphs with double newline', () => {
    const blocks = [
      { text: 'Paragraph 1' },
      { text: 'Paragraph 2' },
    ];
    expect(mergedBlocksToText(blocks)).toBe('Paragraph 1\n\nParagraph 2');
  });

  it('handles single paragraph', () => {
    expect(mergedBlocksToText([{ text: 'Only one' }])).toBe('Only one');
  });
});
