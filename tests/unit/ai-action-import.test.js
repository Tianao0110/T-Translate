// Imported action configs live in config.json, which a user can hand-edit, so
// every read re-validates. These lock what survives that pass and what does not.

import { describe, it, expect } from 'vitest';
import { validateImportedActions } from '../../src/services/ai-action-store.js';
import { AI_ACTION_SCHEMA_VERSION } from '../../src/config/ai-actions.js';

const valid = (overrides = {}) => ({
  id: 'explain-steps',
  schemaVersion: AI_ACTION_SCHEMA_VERSION,
  labels: { zh: '思路', en: 'Approach' },
  capability: 'text',
  history: 'none',
  outputLanguage: 'target',
  trigger: { surfaces: ['floating'], mode: 'understand' },
  prompts: {
    zh: { system: '用{{outputLanguage}}回答。', user: '内容：{{sourceText}}' },
    en: { system: 'Answer in {{outputLanguage}}.', user: 'Content: {{sourceText}}' },
  },
  ...overrides,
});

describe('validateImportedActions', () => {
  it('keeps a well-formed config', () => {
    const actions = validateImportedActions([valid()]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: 'explain-steps', builtin: false });
  });

  it('drops a config that was edited into an invalid shape', () => {
    expect(validateImportedActions([valid({ prompts: {} })])).toHaveLength(0);
  });

  it('keeps the good ones when the file holds a mix', () => {
    const actions = validateImportedActions([valid(), valid({ id: 'BAD ID' }), valid({ id: 'second' })]);
    expect(actions.map(a => a.id)).toEqual(['explain-steps', 'second']);
  });

  it('strips anything outside the schema, however it got in there', () => {
    const [action] = validateImportedActions([valid({ evalCode: 'rm -rf', builtin: true })]);
    expect(action.evalCode).toBeUndefined();
    expect(action.builtin).toBe(false);
  });

  it('refuses a prompt referring to a variable the runtime does not fill', () => {
    const bad = valid();
    bad.prompts.zh.user = '内容：{{apiKey}}';
    expect(validateImportedActions([bad])).toHaveLength(0);
  });

  it('treats a missing or non-array value as nothing imported', () => {
    expect(validateImportedActions(undefined)).toEqual([]);
    expect(validateImportedActions({ id: 'x' })).toEqual([]);
    expect(validateImportedActions('[]')).toEqual([]);
  });
});
