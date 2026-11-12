// The document digest fits its notes into the chat model's context: one
// request when they fit, condensed groups then a merge when they do not.

import { describe, it, expect, vi } from 'vitest';
import {
  estimateTokens, groupNotes, sectionStartIds, digestNotes, isContextError,
  LOCAL_BUDGET, ONLINE_BUDGET,
} from '../../../src/document/digest-batches.js';

const note = (n, sectionStart = false) => ({ text: '字'.repeat(n), sectionStart });

// Answers every request with a short summary and records what it was sent.
function recorder(reply = (stage, i) => `${stage}-${i}`) {
  const calls = [];
  const run = vi.fn(async (stage, sourceText) => {
    calls.push({ stage, sourceText });
    return { success: true, content: reply(stage, calls.length) };
  });
  return { run, calls };
}

describe('estimateTokens', () => {
  it('counts a CJK character as one token and other characters by three', () => {
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('abcdef ghi')).toBe(3);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('groupNotes', () => {
  it('keeps every group within the budget and the notes in order', () => {
    const items = Array.from({ length: 10 }, () => note(96));
    const groups = groupNotes(items, 300);
    expect(groups.map((g) => g.length)).toEqual([3, 3, 3, 1]);
    expect(groups.flat()).toEqual(items);
  });

  it('cuts at a section start once the group is well filled', () => {
    const items = [note(196), note(96, true), note(96)];
    expect(groupNotes(items, 1000).map((g) => g.length)).toEqual([3]);
    expect(groupNotes(items, 330).map((g) => g.length)).toEqual([1, 2]);
  });

  it('gives an oversized note a group of its own', () => {
    expect(groupNotes([note(50), note(500), note(50)], 200).map((g) => g.length)).toEqual([1, 1, 1]);
  });
});

describe('sectionStartIds', () => {
  it('collects segment ids through nested outline levels', () => {
    const outline = [
      { segmentId: 0, children: [{ segmentId: 3 }, { segmentId: 7, children: [{ segmentId: 9 }] }] },
      { segmentId: 12 },
    ];
    expect([...sectionStartIds(outline)].sort((a, b) => a - b)).toEqual([0, 3, 7, 9, 12]);
    expect(sectionStartIds(null).size).toBe(0);
  });
});

describe('digestNotes', () => {
  it('sends notes that fit as one numbered request', async () => {
    const { run, calls } = recorder();
    const r = await digestNotes([{ text: 'a' }, { text: 'b' }], { budget: LOCAL_BUDGET, run });
    expect(r.success).toBe(true);
    expect(calls).toEqual([{ stage: 'whole', sourceText: '1. a\n\n2. b' }]);
  });

  it('condenses groups in order, then merges the parts', async () => {
    const items = Array.from({ length: 30 }, () => note(196));
    const { run, calls } = recorder();
    const r = await digestNotes(items, { budget: LOCAL_BUDGET, run });
    expect(r).toEqual({ success: true, content: `merge-${calls.length}` });
    const parts = calls.filter((c) => c.stage === 'part');
    expect(parts.length).toBe(3);
    for (const p of parts) expect(estimateTokens(p.sourceText)).toBeLessThanOrEqual(LOCAL_BUDGET);
    expect(calls.at(-1)).toEqual({ stage: 'merge', sourceText: '1. part-1\n\n2. part-2\n\n3. part-3' });
  });

  it('runs another round when the parts still do not fit', async () => {
    const items = Array.from({ length: 30 }, () => note(196));
    const { run, calls } = recorder((stage) => (stage === 'part' ? '字'.repeat(1000) : 'done'));
    const r = await digestNotes(items, { budget: LOCAL_BUDGET, run });
    expect(r.content).toBe('done');
    expect(calls.filter((c) => c.stage === 'part').length).toBe(5);
    expect(calls.at(-1).stage).toBe('merge');
  });

  it('falls back to the local budget when an online model reports a context limit', async () => {
    const items = Array.from({ length: 30 }, () => note(196));
    const calls = [];
    const run = async (stage) => {
      calls.push(stage);
      if (stage === 'whole') return { success: false, error: "This model's maximum context length is 4096 tokens" };
      return { success: true, content: 'ok' };
    };
    const r = await digestNotes(items, { budget: ONLINE_BUDGET, run });
    expect(r.success).toBe(true);
    expect(calls).toEqual(['whole', 'part', 'part', 'part', 'merge']);
  });

  it('halves the local budget when the estimate fell short', async () => {
    const items = Array.from({ length: 10 }, () => note(196));
    const sizes = [];
    const run = async (stage, sourceText) => {
      sizes.push(estimateTokens(sourceText));
      if (estimateTokens(sourceText) > 1300) return { success: false, error: 'prompt needs 5000 tokens, context 4096' };
      return { success: true, content: 'ok' };
    };
    const r = await digestNotes(items, { budget: LOCAL_BUDGET, run });
    expect(r.success).toBe(true);
    expect(Math.max(...sizes.slice(1))).toBeLessThanOrEqual(1200);
  });

  it('returns other failures as they are', async () => {
    const run = vi.fn(async () => ({ success: false, error: 'Invalid API key' }));
    const items = Array.from({ length: 30 }, () => note(196));
    const r = await digestNotes(items, { budget: LOCAL_BUDGET, run });
    expect(r.error).toBe('Invalid API key');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('recognises the usual context-limit errors', () => {
    expect(isContextError('prompt needs 16698 tokens, context 4096')).toBe(true);
    expect(isContextError('prompt is too long: 210000 tokens > 200000 maximum')).toBe(true);
    expect(isContextError('The input token count exceeds the maximum number of tokens allowed')).toBe(true);
    expect(isContextError('You exceeded your current quota')).toBe(false);
  });
});
