// tests/unit/useTermCheck.test.js
// 术语一致性检测 Hook 测试
//
// 覆盖: checkTermConsistency, dismissTermSuggestion

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  default: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

import useTermCheck from '../../src/components/TranslationPanel/hooks/useTermCheck.js';

// 模拟术语库收藏
const mockFavorites = [
  {
    id: 'term-1',
    sourceText: 'machine learning',
    translatedText: '机器学习',
    folderId: 'glossary',
  },
  {
    id: 'term-2',
    sourceText: 'neural network',
    translatedText: '神经网络',
    folderId: 'glossary',
  },
  {
    id: 'not-glossary',
    sourceText: 'hello',
    translatedText: '你好',
    folderId: null, // 不在术语库中
  },
];

describe('useTermCheck', () => {
  const mockSetTranslatedText = vi.fn();
  const mockNotify = vi.fn();
  const mockT = (key) => key; // 直接返回 key

  function setup(favorites = mockFavorites) {
    return renderHook(() =>
      useTermCheck(favorites, mockSetTranslatedText, mockNotify, mockT)
    );
  }

  it('detects term inconsistency when glossary term is not used', () => {
    const { result } = setup();

    act(() => {
      result.current.checkTermConsistency(
        'Machine learning is a subset of AI', // 原文包含 machine learning
        'ML 是人工智能的一个子集'              // 译文没有使用 "机器学习"
      );
    });

    expect(result.current.termSuggestions).toHaveLength(1);
    expect(result.current.termSuggestions[0].originalTerm).toBe('machine learning');
    expect(result.current.termSuggestions[0].savedTranslation).toBe('机器学习');
  });

  it('does not suggest when glossary term is already used', () => {
    const { result } = setup();

    act(() => {
      result.current.checkTermConsistency(
        'Machine learning is powerful',
        '机器学习非常强大' // 已使用正确术语
      );
    });

    expect(result.current.termSuggestions).toHaveLength(0);
  });

  it('ignores non-glossary favorites', () => {
    const { result } = setup();

    act(() => {
      result.current.checkTermConsistency(
        'Hello world',  // 包含 "hello" 但它不在 glossary 文件夹
        '世界您好'
      );
    });

    expect(result.current.termSuggestions).toHaveLength(0);
  });

  it('detects multiple term inconsistencies', () => {
    const { result } = setup();

    act(() => {
      result.current.checkTermConsistency(
        'Machine learning uses neural network techniques',
        'ML 使用了 NN 技术' // 两个术语都未正确翻译
      );
    });

    expect(result.current.termSuggestions).toHaveLength(2);
  });

  it('dismisses suggestion', () => {
    const { result } = setup();

    act(() => {
      result.current.checkTermConsistency(
        'Machine learning is great',
        'ML 很棒'
      );
    });
    expect(result.current.termSuggestions).toHaveLength(1);

    act(() => {
      result.current.dismissTermSuggestion(result.current.termSuggestions[0]);
    });
    expect(result.current.termSuggestions).toHaveLength(0);
  });

  it('handles empty favorites gracefully', () => {
    const { result } = setup([]);

    act(() => {
      result.current.checkTermConsistency('some text', 'some translation');
    });

    expect(result.current.termSuggestions).toHaveLength(0);
  });

  it('handles empty text gracefully', () => {
    const { result } = setup();

    act(() => {
      result.current.checkTermConsistency('', '');
    });

    expect(result.current.termSuggestions).toHaveLength(0);
  });
});
