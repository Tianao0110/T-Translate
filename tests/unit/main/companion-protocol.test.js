// @vitest-environment node
// Companion Protocol v1 pure helpers: client header, origin allow-list,
// bearer token, media-time mapping, feed budget, NDJSON framing.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const crypto = require('crypto');
const P = require('../../../electron/companion/protocol.js');

const CHROME = `chrome-extension://${'abcdefghijklmnop'.repeat(2)}`;
const FIREFOX = 'moz-extension://123e4567-e89b-12d3-a456-426614174000';

afterEach(() => vi.restoreAllMocks());

describe('constants', () => {
  it('pins the protocol numbers', () => {
    expect(P.PROTOCOL_VERSION).toBe(1);
    expect(P.HOST).toBe('127.0.0.1');
    expect([P.PORT_BASE, P.PORT_SPAN]).toEqual([38423, 10]);
    expect(P.CLIENT_HEADER).toBe('x-tt-client');
    expect(P.MAX_FEED_BYTES).toBe(1024 * 1024);
    expect(P.MAX_JSON_BYTES).toBe(64 * 1024);
    expect([P.MAX_FEED_PER_SEC, P.MAX_TRANSLATE_ITEMS, P.MAX_TRANSLATE_CHARS, P.MAX_AHEAD_S]).toEqual([20, 50, 2000, 60]);
    expect([P.HEARTBEAT_MS, P.PAIRING_WINDOW_MS]).toEqual([15000, 60000]);
  });
});

describe('parseClient', () => {
  it('accepts t-caption with a semver, prerelease optional', () => {
    expect(P.parseClient('t-caption/1.2.3')).toEqual({ name: 't-caption', version: '1.2.3' });
    expect(P.parseClient('t-caption/0.10.0-beta.2')).toEqual({ name: 't-caption', version: '0.10.0-beta.2' });
  });

  it('refuses anything else', () => {
    for (const v of [undefined, null, '', 't-caption', 't-caption/1.2', 'T-Caption/1.2.3', 'other/1.2.3', ' t-caption/1.2.3', 't-caption/1.2.3 ', 't-caption/1.2.3, t-caption/1.2.3', 't-caption/1.2.3-', 't-caption/1.2.3+build', ['t-caption/1.2.3']]) {
      expect(P.parseClient(v)).toBeNull();
    }
  });
});

describe('originAllowed', () => {
  it('lets non-browser clients and extensions through', () => {
    expect(P.originAllowed(undefined)).toBe(true);
    expect(P.originAllowed('')).toBe(true);
    expect(P.originAllowed(CHROME)).toBe(true);
    expect(P.originAllowed(FIREFOX)).toBe(true);
  });

  it('refuses web pages, the null origin and look-alikes', () => {
    for (const o of [
      'null',
      null,
      'https://www.youtube.com',
      'http://127.0.0.1:38423',
      'http://localhost',
      'file://',
      `chrome-extension://${'q'.repeat(32)}`,
      `chrome-extension://${'a'.repeat(31)}`,
      `chrome-extension://${'A'.repeat(32)}`,
      `${CHROME}/`,
      `${CHROME}.evil.com`,
      'moz-extension://not-a-uuid',
      `${FIREFOX}/x`,
    ]) {
      expect(P.originAllowed(o)).toBe(false);
    }
  });

  it('only real extension origins count for CORS', () => {
    expect(P.isExtensionOrigin(CHROME)).toBe(true);
    expect(P.isExtensionOrigin(FIREFOX)).toBe(true);
    expect(P.isExtensionOrigin(undefined)).toBe(false);
    expect(P.isExtensionOrigin('')).toBe(false);
    expect(P.isExtensionOrigin('https://example.com')).toBe(false);
  });
});

describe('tokens', () => {
  it('newToken is 32 random bytes in hex', () => {
    const a = P.newToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(P.newToken()).not.toBe(a);
  });

  it('tokenMatches wants exactly "Bearer <token>"', () => {
    const t = P.newToken();
    expect(P.tokenMatches(`Bearer ${t}`, t)).toBe(true);
    const flipped = t.slice(0, -1) + (t.endsWith('0') ? '1' : '0');
    for (const h of [undefined, '', t, `bearer ${t}`, `Bearer  ${t}`, `Bearer ${t.slice(1)}`, `Bearer ${t}x`, `Bearer ${flipped}`, `Basic ${t}`]) {
      expect(P.tokenMatches(h, t)).toBe(false);
    }
    expect(P.tokenMatches('Bearer ', '')).toBe(false);
    expect(P.tokenMatches(`Bearer ${t}`, undefined)).toBe(false);
  });

  it('compares equal lengths in constant time and skips unequal ones', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    const t = P.newToken();
    P.tokenMatches(`Bearer ${t}`, t);
    expect(spy).toHaveBeenCalledTimes(1);
    P.tokenMatches(`Bearer ${t}00`, t);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('mediaTimeOf', () => {
  it('offsets session seconds by the media start, three decimals', () => {
    expect(P.mediaTimeOf({ segStartS: 1.23456, segDurS: 2.5 }, 100)).toEqual({ start: 101.235, end: 103.735 });
    expect(P.mediaTimeOf({ segStartS: 0, segDurS: 0.0004 }, 0)).toEqual({ start: 0, end: 0 });
    expect(P.mediaTimeOf({ segStartS: 3, segDurS: 1 }, 0.1)).toEqual({ start: 3.1, end: 4.1 });
  });
});

describe('createFeedBudget', () => {
  it('lets fed audio run at most maxAheadS past the last final', () => {
    const b = P.createFeedBudget({ maxAheadS: 60 });
    expect(b.canAccept(16000 * 60)).toBe(true);
    b.fed(16000 * 60);
    expect(b.aheadS()).toBe(60);
    expect(b.canAccept(1)).toBe(false);
    b.finalAt(10);
    expect(b.aheadS()).toBe(50);
    expect(b.canAccept(16000 * 10)).toBe(true);
    expect(b.canAccept(16000 * 10 + 16)).toBe(false);
  });

  it('never moves the final mark backwards', () => {
    const b = P.createFeedBudget({ maxAheadS: 5 });
    b.fed(16000 * 8);
    b.finalAt(6);
    b.finalAt(2);
    expect(b.aheadS()).toBe(2);
    expect(b.fedS()).toBe(8);
  });

  it('defaults to MAX_AHEAD_S', () => {
    const b = P.createFeedBudget();
    expect(b.canAccept(16000 * P.MAX_AHEAD_S)).toBe(true);
    expect(b.canAccept(16000 * P.MAX_AHEAD_S + 1)).toBe(false);
  });
});

describe('ndjson', () => {
  it('is one JSON line with escaped newlines inside', () => {
    const line = P.ndjson({ type: 'segment', text: 'a\nb' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({ type: 'segment', text: 'a\nb' });
  });
});
