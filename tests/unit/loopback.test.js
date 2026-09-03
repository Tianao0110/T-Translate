import { describe, it, expect } from 'vitest';
import { isLoopbackUrl } from '../../src/stack/loopback.js';

describe('isLoopbackUrl', () => {
  it('accepts the addresses that resolve to this machine', () => {
    expect(isLoopbackUrl('http://localhost:1234/v1')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:8880/v1')).toBe(true);
    expect(isLoopbackUrl('http://ollama.localhost:11434')).toBe(true);
    expect(isLoopbackUrl('HTTP://LOCALHOST:1234')).toBe(true);
  });

  it('rejects everything else, including look-alikes and LAN addresses', () => {
    expect(isLoopbackUrl('http://localhost.evil.com/v1')).toBe(false);
    expect(isLoopbackUrl('http://192.168.1.20:11434/v1')).toBe(false);
    expect(isLoopbackUrl('http://10.0.0.5:1234')).toBe(false);
    expect(isLoopbackUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLoopbackUrl('http://127.0.0.1.example.com')).toBe(false);
  });

  it('treats garbage as not local', () => {
    expect(isLoopbackUrl('not a url')).toBe(false);
    expect(isLoopbackUrl('')).toBe(false);
    expect(isLoopbackUrl(undefined)).toBe(false);
  });
});
