import { describe, it, expect } from 'vitest';
import { isAllowedGlobalShortcut } from '../../electron/shared/shortcut-rules.js';

describe('isAllowedGlobalShortcut', () => {
  it('rejects bare typing keys (the Backspace hijack incident)', () => {
    for (const key of ['Backspace', 'Delete', 'Enter', 'Space', 'Tab', 'A', 'ArrowLeft', 'Home']) {
      expect(isAllowedGlobalShortcut(key), key).toBe(false);
    }
  });

  it('rejects Shift-only chords (Shift+letter still types characters)', () => {
    expect(isAllowedGlobalShortcut('Shift+A')).toBe(false);
    expect(isAllowedGlobalShortcut('Shift+Backspace')).toBe(false);
  });

  it('rejects modifier-only and malformed input', () => {
    expect(isAllowedGlobalShortcut('Ctrl')).toBe(false);
    expect(isAllowedGlobalShortcut('Ctrl+Shift')).toBe(false);
    expect(isAllowedGlobalShortcut('')).toBe(false);
    expect(isAllowedGlobalShortcut(null)).toBe(false);
    expect(isAllowedGlobalShortcut(undefined)).toBe(false);
    expect(isAllowedGlobalShortcut(42)).toBe(false);
    expect(isAllowedGlobalShortcut('Ctrl+A+B')).toBe(false);
  });

  it('accepts every default binding in both renderer and Electron formats', () => {
    for (const chord of [
      'Alt+Q', 'Ctrl+Shift+W', 'Ctrl+Alt+G', 'Ctrl+Shift+T', 'Ctrl+Alt+Space',
      'CommandOrControl+Shift+W', 'CommandOrControl+Alt+Space',
    ]) {
      expect(isAllowedGlobalShortcut(chord), chord).toBe(true);
    }
  });

  it('allows F1-F24 alone or with Shift, but not fake F-keys', () => {
    expect(isAllowedGlobalShortcut('F5')).toBe(true);
    expect(isAllowedGlobalShortcut('F24')).toBe(true);
    expect(isAllowedGlobalShortcut('Shift+F5')).toBe(true);
    expect(isAllowedGlobalShortcut('F25')).toBe(false);
    expect(isAllowedGlobalShortcut('F0')).toBe(false);
  });
});
