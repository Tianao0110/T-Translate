// The companion server only answers requests whose Host names this machine
// (and its own port when one is given): a DNS-rebinding page cannot.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { hostAllowed } = require('../../../electron/companion/protocol.js');

describe('hostAllowed', () => {
  it('accepts loopback names with or without the bound port', () => {
    expect(hostAllowed('127.0.0.1', 38423)).toBe(true);
    expect(hostAllowed('127.0.0.1:38423', 38423)).toBe(true);
    expect(hostAllowed('localhost:38423', 38423)).toBe(true);
    expect(hostAllowed(' localhost ', 38423)).toBe(true);
  });

  it('refuses another port, other names and missing headers', () => {
    expect(hostAllowed('127.0.0.1:38424', 38423)).toBe(false);
    expect(hostAllowed('evil.example:38423', 38423)).toBe(false);
    expect(hostAllowed('127.0.0.1.evil.example', 38423)).toBe(false);
    expect(hostAllowed('[::1]:38423', 38423)).toBe(false);
    expect(hostAllowed(undefined, 38423)).toBe(false);
    expect(hostAllowed('', 38423)).toBe(false);
  });

  it('ignores the port check while the server has no port yet', () => {
    expect(hostAllowed('127.0.0.1:5', null)).toBe(true);
  });
});
