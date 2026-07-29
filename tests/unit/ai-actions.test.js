// AI action framework: text measurement, trigger gating, privacy gating,
// prompt building, and the import validator for third-party action configs.

import { describe, it, expect } from 'vitest';
import {
  measureText,
  meetsLengthGate,
  checkActionAvailability,
  isAttachableResult,
  renderTemplate,
  buildActionMessages,
  resolveActionLabel,
  resolveActionPath,
} from '../../src/services/ai-action-runner.js';
import {
  BUILTIN_AI_ACTIONS,
  getAiAction,
  getUnderstandAction,
  normalizeActionConfig,
  AI_ACTION_SCHEMA_VERSION,
  LONG_FORM_GATE,
} from '../../src/config/ai-actions.js';

const CAN_CHAT = { text: true, vision: false };

const longCjk = '这是一段足够长的中文内容用来验证长段判定。'.repeat(10); // 200+ chars
const longLatin = Array.from({ length: 130 }, (_, i) => `word${i}`).join(' ');

// Minimal valid imported config; tests override one field at a time.
const importable = () => ({
  id: 'explain-steps',
  schemaVersion: AI_ACTION_SCHEMA_VERSION,
  labels: { zh: '思路', en: 'Approach' },
  capability: 'text',
  history: 'none',
  outputLanguage: 'target',
  trigger: { surfaces: ['floating'] },
  prompts: {
    zh: { system: '用{{outputLanguage}}回答。', user: '内容：{{sourceText}}' },
    en: { system: 'Answer in {{outputLanguage}}.', user: 'Content: {{sourceText}}' },
  },
});

describe('measureText', () => {
  it('counts CJK characters and Latin words on separate scales', () => {
    expect(measureText('你好世界')).toEqual({ cjk: 4, latin: 0 });
    expect(measureText('hello brave new world')).toEqual({ cjk: 0, latin: 4 });
  });

  it('counts kana and hangul as CJK', () => {
    expect(measureText('こんにちは').cjk).toBe(5);
    expect(measureText('안녕하세요').cjk).toBe(5);
  });

  it('ignores punctuation-only tokens on the Latin side', () => {
    expect(measureText('-- ... !!! ok')).toEqual({ cjk: 0, latin: 1 });
  });

  it('measures each side of mixed text independently', () => {
    const m = measureText('这段文字 mixes 中文 and English');
    expect(m.cjk).toBe(6);
    expect(m.latin).toBe(3);
  });

  it('survives empty and non-string input', () => {
    expect(measureText('')).toEqual({ cjk: 0, latin: 0 });
    expect(measureText(null)).toEqual({ cjk: 0, latin: 0 });
  });
});

describe('meetsLengthGate', () => {
  it('passes anything when the action has no gate', () => {
    expect(meetsLengthGate('hi', null)).toBe(true);
  });

  it('lets either scale clear on its own', () => {
    expect(meetsLengthGate(longCjk, LONG_FORM_GATE)).toBe(true);
    expect(meetsLengthGate(longLatin, LONG_FORM_GATE)).toBe(true);
  });

  it('rejects text short on both scales', () => {
    expect(meetsLengthGate('短句子', LONG_FORM_GATE)).toBe(false);
    expect(meetsLengthGate('a short caption', LONG_FORM_GATE)).toBe(false);
  });
});

describe('checkActionAvailability', () => {
  const summarize = getAiAction('summarize');

  it('offers a long unified passage', () => {
    expect(checkActionAvailability(summarize, {
      surface: 'floating', displayMode: 'unified', text: longCjk, capabilities: CAN_CHAT,
    })).toEqual({ available: true, reason: null });
  });

  it('hides the action when no provider can chat', () => {
    expect(checkActionAvailability(summarize, {
      surface: 'floating', displayMode: 'unified', text: longCjk,
      capabilities: { text: false, vision: false },
    }).reason).toBe('capability');
  });

  it('hides summarize in scattered mode — nothing to summarize there', () => {
    expect(checkActionAvailability(summarize, {
      surface: 'floating', displayMode: 'scattered', text: longCjk, capabilities: CAN_CHAT,
    }).reason).toBe('displayMode');
  });

  it('hides the action on a surface it does not declare', () => {
    const floatingOnly = { ...summarize, trigger: { ...summarize.trigger, surfaces: ['floating'] } };
    expect(checkActionAvailability(floatingOnly, {
      surface: 'selection', displayMode: 'unified', text: longCjk, capabilities: CAN_CHAT,
    }).reason).toBe('surface');
  });

  it('hides the action on short content', () => {
    expect(checkActionAvailability(summarize, {
      surface: 'floating', displayMode: 'unified', text: '一句话', capabilities: CAN_CHAT,
    }).reason).toBe('tooShort');
  });

  it('reports unknown for a missing action', () => {
    expect(checkActionAvailability(null, {}).reason).toBe('unknown');
  });
});

describe('understanding-mode gating', () => {
  const explain = getAiAction('explain');
  const summarize = getAiAction('summarize');
  const base = { surface: 'floating', displayMode: 'unified', capabilities: CAN_CHAT };

  it('hides understanding actions until the toggle is on', () => {
    expect(checkActionAvailability(explain, { ...base, text: longCjk, understandMode: false }).reason)
      .toBe('understandMode');
    expect(checkActionAvailability(explain, { ...base, text: longCjk, understandMode: true }).available)
      .toBe(true);
  });

  it('swaps rather than stacks — with the toggle on there is no translation to summarize', () => {
    expect(checkActionAvailability(summarize, { ...base, text: longCjk, understandMode: false }).available).toBe(true);
    expect(checkActionAvailability(summarize, { ...base, text: longCjk, understandMode: true }).reason)
      .toBe('understandMode');
  });

  it('leaves the surfaces that have no toggle on the reading side', () => {
    expect(checkActionAvailability(summarize, { ...base, surface: 'selection', text: longCjk }).available)
      .toBe(true);
  });

  it('explains short content too — turning the mode on IS the trigger', () => {
    expect(checkActionAvailability(explain, { ...base, text: '两行密集的公式', understandMode: true }).available)
      .toBe(true);
  });

  it('stays off the other surfaces — the toggle is the floating window’s', () => {
    expect(checkActionAvailability(explain, {
      ...base, surface: 'selection', text: longCjk, understandMode: true,
    }).reason).toBe('surface');
  });

  it('carries an imported action’s side of the split through the validator', () => {
    const raw = { ...importable(), trigger: { surfaces: ['floating'], mode: 'understand' } };
    expect(normalizeActionConfig(raw).action.trigger.mode).toBe('understand');
    // Unstated or bogus falls back to 'any' instead of silently picking a side
    expect(normalizeActionConfig(importable()).action.trigger.mode).toBe('any');
    const bogus = { ...importable(), trigger: { surfaces: ['floating'], mode: 'telepathy' } };
    expect(normalizeActionConfig(bogus).action.trigger.mode).toBe('any');
  });

  it('lets an imported understanding action take the mode over from the built-in', () => {
    const imported = normalizeActionConfig({
      ...importable(),
      trigger: { surfaces: ['floating'], mode: 'understand' },
    }).action;

    expect(getUnderstandAction().id).toBe('explain');
    expect(getUnderstandAction([imported]).id).toBe('explain-steps');
  });
});

describe('resolveActionPath', () => {
  const summarize = getAiAction('summarize');
  const BOTH = { text: true, vision: true };

  it('prefers the capture when a vision model can read it', () => {
    expect(resolveActionPath(summarize, { capabilities: BOTH, hasImage: true })).toBe('vision');
  });

  it('uses text when there is no capture to look at', () => {
    expect(resolveActionPath(summarize, { capabilities: BOTH, hasImage: false })).toBe('text');
  });

  it('uses text when no vision model is configured', () => {
    expect(resolveActionPath(summarize, { capabilities: CAN_CHAT, hasImage: true })).toBe('text');
  });

  it('runs on vision alone — a vision-only setup still gets the action', () => {
    const visionOnly = { text: false, vision: true };
    expect(resolveActionPath(summarize, { capabilities: visionOnly, hasImage: true })).toBe('vision');
    expect(checkActionAvailability(summarize, {
      surface: 'floating', displayMode: 'unified', text: longCjk,
      capabilities: visionOnly, hasImage: true,
    }).available).toBe(true);
  });

  it('has no path when neither side is configured', () => {
    expect(resolveActionPath(summarize, {
      capabilities: { text: false, vision: false }, hasImage: true,
    })).toBeNull();
  });

  it('ignores vision for an action that carries no image prompt', () => {
    const textOnly = { ...summarize, visionPrompts: null };
    expect(resolveActionPath(textOnly, { capabilities: BOTH, hasImage: true })).toBe('text');
  });
});

describe('isAttachableResult', () => {
  it('attaches the built-in summary to its translation', () => {
    expect(isAttachableResult(getAiAction('summarize'))).toBe(true);
  });

  it('keeps module-owned actions out of the main history', () => {
    expect(isAttachableResult(normalizeActionConfig(importable()).action)).toBe(false);
  });

  it('says no for a missing action', () => {
    expect(isAttachableResult(null)).toBe(false);
  });
});

describe('renderTemplate', () => {
  it('substitutes known variables', () => {
    expect(renderTemplate('讲讲 {{sourceText}}', { sourceText: '这段' })).toBe('讲讲 这段');
  });

  it('tolerates padding inside the braces', () => {
    expect(renderTemplate('{{ sourceText }}', { sourceText: 'x' })).toBe('x');
  });

  it('leaves unknown placeholders alone rather than blanking them', () => {
    expect(renderTemplate('{{nope}}', { nope: 'x' })).toBe('{{nope}}');
  });
});

describe('buildActionMessages', () => {
  const summarize = getAiAction('summarize');
  const context = {
    sourceText: 'Some English source paragraph.',
    sourceLanguage: 'en',
    targetLanguage: 'zh',
  };

  it('builds a system + user pair carrying the source text', () => {
    const messages = buildActionMessages(summarize, context, 'zh');
    expect(messages.map(m => m.role)).toEqual(['system', 'user']);
    expect(messages[1].content).toContain(context.sourceText);
  });

  it('names the target language as the output language', () => {
    const messages = buildActionMessages(summarize, context, 'zh');
    expect(messages[0].content).toContain('中文');
    expect(messages[1].content).not.toContain('{{');
  });

  it('picks the prompt matching the UI language', () => {
    expect(buildActionMessages(summarize, context, 'en')[0].content).toMatch(/reading assistant/i);
    expect(buildActionMessages(summarize, context, 'zh')[0].content).toMatch(/阅读助手/);
  });

  it('falls back to the other language when an imported action has only one', () => {
    const oneLang = { ...importable(), prompts: { en: importable().prompts.en } };
    expect(buildActionMessages(oneLang, context, 'zh')[1].content).toContain(context.sourceText);
  });

  it('returns null when the action carries no prompts', () => {
    expect(buildActionMessages({ id: 'x', prompts: {} }, context, 'zh')).toBeNull();
  });

  it('builds the image prompt from visionPrompts, with no source text pasted in', () => {
    const messages = buildActionMessages(summarize, context, 'zh', 'vision');
    expect(messages[1].content).not.toContain(context.sourceText);
    expect(messages[1].content).toContain('截图');
    expect(messages[0].content).toContain('中文'); // still answers in the target language
  });

  it('returns null for the image path when the action has no image prompt', () => {
    const textOnly = { ...summarize, visionPrompts: null };
    expect(buildActionMessages(textOnly, context, 'zh', 'vision')).toBeNull();
  });
});

describe('resolveActionLabel', () => {
  it('reads built-in labels from the i18n key', () => {
    expect(resolveActionLabel(getAiAction('summarize'), 'zh')).toBeTruthy();
  });

  it('reads imported labels from the config itself', () => {
    const action = normalizeActionConfig(importable()).action;
    expect(resolveActionLabel(action, 'zh')).toBe('思路');
    expect(resolveActionLabel(action, 'en')).toBe('Approach');
  });
});

describe('normalizeActionConfig', () => {
  it('accepts a well-formed config and marks it non-builtin', () => {
    const result = normalizeActionConfig(importable());
    expect(result.ok).toBe(true);
    expect(result.action.id).toBe('explain-steps');
    expect(result.action.builtin).toBe(false);
  });

  it('rejects an unknown template variable instead of sending it to the model', () => {
    const raw = importable();
    raw.prompts.zh.user = '内容：{{sorceText}}';
    expect(normalizeActionConfig(raw)).toMatchObject({ ok: false });
    expect(normalizeActionConfig(raw).error).toContain('sorceText');
  });

  it('rejects a bad id', () => {
    expect(normalizeActionConfig({ ...importable(), id: 'Bad Id!' }).ok).toBe(false);
  });

  it('rejects a config from a different schema version', () => {
    expect(normalizeActionConfig({ ...importable(), schemaVersion: 99 }).ok).toBe(false);
  });

  it('requires display labels — imported actions have no i18n keys', () => {
    expect(normalizeActionConfig({ ...importable(), labels: {} }).ok).toBe(false);
  });

  it('requires at least one known surface', () => {
    expect(normalizeActionConfig({ ...importable(), trigger: { surfaces: ['nowhere'] } }).ok).toBe(false);
  });

  it('rejects an unknown history mode rather than defaulting it open', () => {
    expect(normalizeActionConfig({ ...importable(), history: 'everywhere' }).ok).toBe(false);
  });

  it('drops fields outside the schema', () => {
    const { action } = normalizeActionConfig({ ...importable(), evalCode: 'rm -rf', builtin: true });
    expect(action.evalCode).toBeUndefined();
    expect(action.builtin).toBe(false);
  });

  it('accepts an optional image prompt and keeps it', () => {
    const raw = { ...importable(), visionPrompts: { zh: { system: '看图。', user: '用{{outputLanguage}}答。' } } };
    const { ok, action } = normalizeActionConfig(raw);
    expect(ok).toBe(true);
    expect(action.visionPrompts.zh.user).toContain('{{outputLanguage}}');
  });

  it('holds the image prompt to the same rules as the text one', () => {
    const raw = { ...importable(), visionPrompts: { zh: { system: '看图。', user: '{{sorceText}}' } } };
    expect(normalizeActionConfig(raw).error).toContain('visionPrompts');
  });

  it('leaves visionPrompts null when the config omits it', () => {
    expect(normalizeActionConfig(importable()).action.visionPrompts).toBeNull();
  });

  it('rejects junk input', () => {
    expect(normalizeActionConfig(null).ok).toBe(false);
    expect(normalizeActionConfig('nope').ok).toBe(false);
  });
});

describe('built-in catalog', () => {
  it('ships summarize as a long-form, attachable text action', () => {
    const summarize = getAiAction('summarize');
    expect(summarize.capability).toBe('text');
    expect(summarize.history).toBe('attach');
    expect(summarize.trigger.minLength).toEqual(LONG_FORM_GATE);
  });

  it('keeps every built-in id unique', () => {
    const ids = BUILTIN_AI_ACTIONS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships explain on the understanding side, on the floating window only', () => {
    const explain = getAiAction('explain');
    expect(explain.trigger.mode).toBe('understand');
    expect(explain.trigger.surfaces).toEqual(['floating']);
    expect(explain.trigger.minLength).toBeNull();
  });

  it('keeps summarize on the reading side', () => {
    expect(getAiAction('summarize').trigger.mode).toBe('translate');
  });

  // The switch has to stay neutral: it is named for understanding, and the
  // shipped configs must not describe anything narrower.
  it('carries no problem-solving wording in any built-in', () => {
    const text = JSON.stringify(BUILTIN_AI_ACTIONS);
    expect(text).not.toMatch(/解题|答案|homework|solve the problem/i);
  });

  it('returns null for an unknown id', () => {
    expect(getAiAction('does-not-exist')).toBeNull();
  });
});
