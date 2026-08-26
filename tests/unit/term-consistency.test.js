// The glossary is applied as each translation happens, so a finished document
// only drifts two ways: it was translated before a term existed, or the model
// rendered a term as something else. Only the first is fixable without asking
// a model where the term went — these tests pin that boundary, because the
// tempting mistake is to "fix" the second by guessing.

import { describe, it, expect } from 'vitest';
import { scanDocumentTerms } from '../../src/utils/term-consistency.js';
import { applyGlossary } from '../../src/stack/glossary.js';

const seg = (id, original, translated) => ({ id, original, translated });
const TENSOR = { source: 'tensor', target: '张量' };

describe('scanDocumentTerms', () => {
  it('fixes a term the model left in the source language', () => {
    const segments = [seg(0, 'A tensor flows through the graph.', '一个 tensor 流过计算图。')];

    const { fixable, review } = scanDocumentTerms(segments, [TENSOR]);

    expect(fixable).toHaveLength(1);
    expect(fixable[0]).toMatchObject({ segmentId: 0, after: '一个 张量 流过计算图。' });
    expect(fixable[0].replacements).toEqual([{ from: 'tensor', to: '张量' }]);
    expect(review).toHaveLength(0);
  });

  it('leaves a paragraph alone when the canonical rendering is already there', () => {
    const segments = [seg(0, 'A tensor flows.', '一个张量流过。')];

    const { fixable, review } = scanDocumentTerms(segments, [TENSOR]);

    expect(fixable).toHaveLength(0);
    expect(review).toHaveLength(0);
  });

  it('reports — never rewrites — a term rendered as some other word', () => {
    // "张力" is wrong, but nothing in the string says it was meant to be the
    // term. Guessing a span here is how you corrupt a translation.
    const segments = [seg(0, 'A tensor flows.', '一个张力流过。')];

    const { fixable, review } = scanDocumentTerms(segments, [TENSOR]);

    expect(fixable).toHaveLength(0);
    expect(review).toEqual([{ source: 'tensor', canonical: '张量', segmentIds: [0] }]);
  });

  it('ignores paragraphs the term never appears in', () => {
    const segments = [seg(0, 'Nothing relevant here.', '这里没有相关内容。')];

    const { fixable, review, checked } = scanDocumentTerms(segments, [TENSOR]);

    expect(checked).toBe(0);
    expect(fixable).toHaveLength(0);
    expect(review).toHaveLength(0);
  });

  it('does not flag a rendering that contains the canonical one', () => {
    // "张量积" contains "张量" — it reads as honoured, and it may genuinely be a
    // different term (tensor product). Catching this needs alignment, not a
    // substring rule. Pinned so nobody "fixes" it into a false positive.
    const segments = [seg(0, 'The tensor product is defined.', '张量积的定义如下。')];

    const { review } = scanDocumentTerms(segments, [TENSOR]);

    expect(review).toHaveLength(0);
  });

  it('judges the review list against the text after replacement', () => {
    // The term was left in English and gets replaced — it must not then be
    // reported as missing.
    const segments = [seg(0, 'A tensor flows.', '一个 tensor 流过。')];

    const { fixable, review } = scanDocumentTerms(segments, [TENSOR]);

    expect(fixable).toHaveLength(1);
    expect(review).toHaveLength(0);
  });

  it('walks a whole document and keeps the per-paragraph verdicts apart', () => {
    const segments = [
      seg(0, 'A tensor flows.', '一个张量流过。'),          // fine
      seg(1, 'Another tensor here.', '这里还有一个 tensor。'), // fixable
      seg(2, 'The tensor is large.', '这个张力很大。'),        // review
      seg(3, 'Unrelated sentence.', '无关的句子。'),           // untouched
    ];

    const { fixable, review, checked } = scanDocumentTerms(segments, [TENSOR]);

    expect(checked).toBe(3);
    expect(fixable.map((f) => f.segmentId)).toEqual([1]);
    expect(review).toEqual([{ source: 'tensor', canonical: '张量', segmentIds: [2] }]);
  });

  // A term that drifted in a long document drifted in many paragraphs. One row
  // per occurrence buries the thing the reader needs — which term — under
  // repetitions of it.
  it('reports one row per term, carrying every paragraph it drifted in', () => {
    const segments = [
      seg(0, 'A tensor flows.', '一个张力流过。'),
      seg(1, 'The tensor grows.', '这个张力变大。'),
      seg(2, 'A gradient descends.', '一个坡度下降。'),
    ];
    const terms = [TENSOR, { source: 'gradient', target: '梯度' }];

    const { review } = scanDocumentTerms(segments, terms);

    expect(review).toHaveLength(2);
    expect(review.find((r) => r.source === 'tensor').segmentIds).toEqual([0, 1]);
    expect(review.find((r) => r.source === 'gradient').segmentIds).toEqual([2]);
  });

  it('keeps two terms apart even when they share a canonical rendering', () => {
    const segments = [seg(0, 'tensor and tensors everywhere', '张力遍地')];
    const terms = [TENSOR, { source: 'tensors', target: '张量' }];

    const { review } = scanDocumentTerms(segments, terms);

    expect(review.map((r) => r.source).sort()).toEqual(['tensor', 'tensors']);
  });

  it('skips paragraphs that were never translated', () => {
    const segments = [seg(0, 'A tensor flows.', ''), seg(1, 'A tensor flows.', null)];

    const { fixable, review, checked } = scanDocumentTerms(segments, [TENSOR]);

    expect(checked).toBe(0);
    expect(fixable).toHaveLength(0);
    expect(review).toHaveLength(0);
  });

  it('survives an empty or absent glossary', () => {
    const segments = [seg(0, 'A tensor flows.', '一个张力流过。')];

    expect(scanDocumentTerms(segments, [])).toEqual({ fixable: [], review: [], checked: 0 });
    expect(scanDocumentTerms(segments, null)).toEqual({ fixable: [], review: [], checked: 0 });
    expect(scanDocumentTerms(null, [TENSOR])).toEqual({ fixable: [], review: [], checked: 0 });
  });

  it('drops single-character terms, which would match everything', () => {
    const segments = [seg(0, 'a b c', 'x y z')];

    expect(scanDocumentTerms(segments, [{ source: 'a', target: '甲' }]).review).toHaveLength(0);
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
