// Renderer navigation + window.open policy. These two gates are what keeps a
// renderer-side foothold from turning into "the OS runs this" or "an attacker
// page inherits our preload (and its secureStorage.decrypt bridge)".

import { describe, it, expect } from 'vitest';
import { isInternalUrl, mayOpenExternally } from '../../electron/utils/url-policy.js';

describe('isInternalUrl — what may be navigated to', () => {
  it('allows our own packaged pages', () => {
    expect(isInternalUrl('file:///C:/Program%20Files/T-Translate/index.html')).toBe(true);
  });

  it('allows the dev server only in dev', () => {
    expect(isInternalUrl('http://localhost:5199/', true)).toBe(true);
    expect(isInternalUrl('http://127.0.0.1:5199/', true)).toBe(true);
    expect(isInternalUrl('http://localhost:5199/', false)).toBe(false);
  });

  it('blocks external pages — they would inherit the preload bridge', () => {
    expect(isInternalUrl('https://evil.test/steal')).toBe(false);
    expect(isInternalUrl('http://evil.test/', true)).toBe(false);
  });

  it('is not fooled by a hostname that merely contains localhost', () => {
    expect(isInternalUrl('http://localhost.evil.test/', true)).toBe(false);
    expect(isInternalUrl('http://notlocalhost/', true)).toBe(false);
  });

  it('rejects garbage without throwing', () => {
    expect(isInternalUrl('not a url')).toBe(false);
    expect(isInternalUrl('')).toBe(false);
    expect(isInternalUrl(null)).toBe(false);
    expect(isInternalUrl(undefined)).toBe(false);
    expect(isInternalUrl(42)).toBe(false);
  });
});

describe('mayOpenExternally — what may reach shell.openExternal', () => {
  it('allows plain web links', () => {
    expect(mayOpenExternally('https://github.com/Tianao0110/T-Translate')).toBe(true);
    expect(mayOpenExternally('http://example.test/page')).toBe(true);
  });

  // Each of these is a "make the OS run something" vector if it ever reaches
  // shell.openExternal — the reason this allow-list exists.
  it.each([
    ['file:///C:/Windows/System32/calc.exe'],
    ['file://attacker-share/payload.exe'],
    ['ms-msdt:/id PCWDiagnostic'],
    ['search-ms:query=x'],
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['shell:startup'],
  ])('blocks %s', (url) => {
    expect(mayOpenExternally(url)).toBe(false);
  });

  it('rejects garbage and bare Windows paths without throwing', () => {
    expect(mayOpenExternally('')).toBe(false);
    expect(mayOpenExternally(null)).toBe(false);
    expect(mayOpenExternally('C:\\Windows\\System32\\calc.exe')).toBe(false);
  });
});
