// The scan reports exactly one thing: a glossary term the model left in the
// source language. A term rendered as some other word is deliberately NOT
// reported — it cannot be fixed mechanically, and this app is for reading
// comprehension, not terminology proofreading. These tests pin that scope so
// the second category does not creep back in as "helpful" noise.

import { describe, it, expect } from 'vitest';
import { scanDocumentTerms, renderWithReplacements } from '../../src/utils/term-consistency.js';
import { applyGlossary } from '../../src/stack/glossary.js';

const seg = (id, original, translated) => ({ id, original, translated });
const TENSOR = { source: 'tensor', target: '张量' };
const GPU = { source: 'GPU', target: '图形处理器' };

describe('scanDocumentTerms', () => {
  it('finds a term the model left in the source language', () => {
    const segments = [seg(0, 'A tensor flows through the graph.', '一个 tensor 流过计算图。')];

    const { fixable } = scanDocumentTerms(segments, [TENSOR]);

    expect(fixable).toHaveLength(1);
    expect(fixable[0]).toMatchObject({ segmentId: 0, before: '一个 tensor 流过计算图。' });
    expect(fixable[0].replacements).toEqual([{ from: 'tensor', to: '张量' }]);
  });

  it('leaves a paragraph alone when the term was translated', () => {
    const segments = [seg(0, 'A tensor flows.', '一个张量流过。')];

    expect(scanDocumentTerms(segments, [TENSOR]).fixable).toHaveLength(0);
  });

  it('says nothing about a term rendered as some other word', () => {
    // Product decision, not a gap: nothing in the string says which span was
    // meant to be the term, and a "go look at this yourself" list is
    // proofreading work this app does not do.
    const segments = [seg(0, 'A tensor flows.', '一个张力流过。')];

    expect(scanDocumentTerms(segments, [TENSOR]).fixable).toHaveLength(0);
  });

  it('will not substitute a term that was never in this paragraph', () => {
    // "GPU" survives into the translation of a paragraph whose source never
    // used it — rewriting it would invent a term the source lacked.
    const segments = [seg(0, 'A model runs somewhere.', '模型跑在某台 GPU 上。')];

    expect(scanDocumentTerms(segments, [GPU]).fixable).toHaveLength(0);
  });

  it('collects several terms from one paragraph', () => {
    const segments = [seg(0, 'The tensor lives on the GPU.', 'tensor 放在 GPU 上。')];

    const { fixable } = scanDocumentTerms(segments, [TENSOR, GPU]);

    expect(fixable).toHaveLength(1);
    expect(fixable[0].replacements.map((r) => r.from).sort()).toEqual(['GPU', 'tensor']);
  });

  it('counts the paragraphs it actually examined', () => {
    const segments = [
      seg(0, 'A tensor flows.', '一个 tensor 流过。'),
      seg(1, 'The tensor is large.', '这个张量很大。'),
      seg(2, 'Unrelated sentence.', '无关的句子。'),
    ];

    const { fixable, checked } = scanDocumentTerms(segments, [TENSOR]);

    expect(checked).toBe(2);
    expect(fixable.map((f) => f.segmentId)).toEqual([0]);
  });

  it('skips paragraphs that were never translated', () => {
    const segments = [seg(0, 'A tensor flows.', ''), seg(1, 'A tensor flows.', null)];

    expect(scanDocumentTerms(segments, [TENSOR])).toEqual({ fixable: [], checked: 0 });
  });

  it('survives an empty or absent glossary', () => {
    const segments = [seg(0, 'A tensor flows.', '一个 tensor 流过。')];

    expect(scanDocumentTerms(segments, [])).toEqual({ fixable: [], checked: 0 });
    expect(scanDocumentTerms(segments, null)).toEqual({ fixable: [], checked: 0 });
    expect(scanDocumentTerms(null, [TENSOR])).toEqual({ fixable: [], checked: 0 });
  });

  it('drops single-character terms, which would match everything', () => {
    const segments = [seg(0, 'a b c', 'a b c')];

    expect(scanDocumentTerms(segments, [{ source: 'a', target: '甲' }]).fixable).toHaveLength(0);
  });
});

describe('renderWithReplacements', () => {
  const before = 'tensor 放在 GPU 上，另一个 tensor 也是。';
  const replacements = [{ from: 'tensor', to: '张量' }, { from: 'GPU', to: '图形处理器' }];

  it('applies every replacement when all are active', () => {
    expect(renderWithReplacements(before, replacements, () => true))
      .toBe('张量 放在 图形处理器 上，另一个 张量 也是。');
  });

  // The whole reason it rebuilds from `before`: undoing one term must not
  // disturb the others, and must not leave a half-substituted paragraph.
  it('undoing one term keeps the others exactly as they were', () => {
    expect(renderWithReplacements(before, replacements, (from) => from !== 'GPU'))
      .toBe('张量 放在 GPU 上，另一个 张量 也是。');
  });

  it('undoing every term returns the untouched original', () => {
    expect(renderWithReplacements(before, replacements, () => false)).toBe(before);
  });

  it('re-activating a term restores it — the source text is never lost', () => {
    expect(renderWithReplacements(before, replacements, () => false)).toBe(before);
    expect(renderWithReplacements(before, replacements, () => true))
      .toBe('张量 放在 图形处理器 上，另一个 张量 也是。');
  });
});

describe('applyGlossary', () => {
  it('replaces the longer term first so a prefix cannot pre-empt it', () => {
    const terms = [{ source: 'API', target: '接口' }, { source: 'API Key', target: '接口密钥' }];

    const { text } = applyGlossary('Set the API Key before calling the API.', terms);

    expect(text).toBe('Set the 接口密钥 before calling the 接口.');
  });

  it('matches case-insensitively', () => {
    expect(applyGlossary('a Tensor and a TENSOR', [TENSOR]).text).toBe('a 张量 and a 张量');
  });

  it('treats regex metacharacters in a term as literal text', () => {
    const terms = [{ source: 'C++', target: 'C加加' }];
    expect(applyGlossary('I write C++ daily', terms).text).toBe('I write C加加 daily');
  });

  it('reports nothing when no term is present', () => {
    expect(applyGlossary('plain text', [TENSOR])).toEqual({ text: 'plain text', replacements: [] });
  });
});
