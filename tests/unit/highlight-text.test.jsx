// HighlightText is shared by History, Favorites and the document segment list.
// The document added a second kind of mark (glossary terms it substituted), so
// what needs pinning is that the two kinds coexist without either breaking the
// other, and that the pre-existing search behaviour is untouched.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HighlightText from '../../src/components/shared/HighlightText.jsx';

const marks = (container, cls) =>
  [...container.querySelectorAll(`mark.${cls}`)].map((m) => m.textContent);

describe('HighlightText', () => {
  describe('search — the behaviour History and Favorites already relied on', () => {
    it('marks every occurrence, not just the first', () => {
      const { container } = render(<HighlightText text="a tensor and a tensor" search="tensor" />);
      expect(marks(container, 'search-highlight')).toEqual(['tensor', 'tensor']);
    });

    it('matches case-insensitively but renders the original casing', () => {
      const { container } = render(<HighlightText text="Tensor and TENSOR" search="tensor" />);
      expect(marks(container, 'search-highlight')).toEqual(['Tensor', 'TENSOR']);
    });

    it('returns the text untouched with no search and no terms', () => {
      const { container } = render(<HighlightText text="plain text" />);
      expect(container.textContent).toBe('plain text');
      expect(container.querySelector('mark')).toBeNull();
    });

    it('treats a regex-hostile query as literal text', () => {
      const { container } = render(<HighlightText text="I write C++ daily" search="C++" />);
      expect(marks(container, 'search-highlight')).toEqual(['C++']);
    });

    it('survives a non-string, which is how one bad history row used to take the panel down', () => {
      const { container } = render(<HighlightText text={{ nope: 1 }} search="x" />);
      expect(container.textContent).toContain('object');
    });
  });

  describe('glossary terms', () => {
    it('marks substituted terms with their own class', () => {
      const { container } = render(<HighlightText text="一个张量流过计算图" terms={['张量']} />);
      expect(marks(container, 'term-highlight')).toEqual(['张量']);
      expect(marks(container, 'search-highlight')).toEqual([]);
    });

    it('marks several terms in one passage', () => {
      const { container } = render(
        <HighlightText text="张量与梯度下降" terms={['张量', '梯度下降']} />
      );
      expect(marks(container, 'term-highlight')).toEqual(['张量', '梯度下降']);
    });

    it('keeps search and term marks apart in the same text', () => {
      const { container } = render(
        <HighlightText text="张量在这一段里流动" search="流动" terms={['张量']} />
      );
      expect(marks(container, 'term-highlight')).toEqual(['张量']);
      expect(marks(container, 'search-highlight')).toEqual(['流动']);
    });

    it('lets the longer term win when one contains another', () => {
      // Sorting matters: "张量" first would split "张量积" and render both wrong.
      const { container } = render(
        <HighlightText text="张量积的定义" terms={['张量', '张量积']} />
      );
      expect(marks(container, 'term-highlight')).toEqual(['张量积']);
      expect(container.textContent).toBe('张量积的定义');
    });

    it('ignores empty entries rather than matching everything', () => {
      const { container } = render(<HighlightText text="some text" terms={['', null]} />);
      expect(container.querySelector('mark')).toBeNull();
      expect(container.textContent).toBe('some text');
    });

    it('never drops or duplicates text while marking', () => {
      const text = '张量与梯度下降在这一段里同时出现，张量出现了两次';
      const { container } = render(
        <HighlightText text={text} search="出现" terms={['张量', '梯度下降']} />
      );
      expect(container.textContent).toBe(text);
    });
  });
});
