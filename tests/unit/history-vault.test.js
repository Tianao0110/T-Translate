// Encrypted history vault: DPAPI-at-rest for the translation-store persist
// blob. DI fs/safeStorage so the vault runs outside Electron.

import { describe, it, expect } from 'vitest';
import { createHistoryVault } from '../../electron/utils/history-vault.js';

const PATH_SHIM = { basename: (p) => p.split(/[\\/]/).pop() };

function makeFakeFs() {
  const files = new Map();
  const enoent = () => {
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    return err;
  };
  return {
    files,
    writeFileSync(p, data) {
      files.set(p, Buffer.from(data));
    },
    readFileSync(p) {
      if (!files.has(p)) throw enoent();
      return files.get(p);
    },
    renameSync(from, to) {
      if (!files.has(from)) throw enoent();
      files.set(to, files.get(from));
      files.delete(from);
    },
    unlinkSync(p) {
      if (!files.has(p)) throw enoent();
      files.delete(p);
    },
    statSync(p) {
      if (!files.has(p)) throw enoent();
      return { isFile: () => true, size: files.get(p).length };
    },
  };
}

function makeFakeSafeStorage(available = true) {
  // base64 stands in for real ciphertext so plaintext bytes never appear on
  // "disk" — the not-plaintext assertion below depends on that.
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('ENC:' + Buffer.from(s, 'utf8').toString('base64')),
    decryptString: (buf) => {
      const s = buf.toString();
      if (!s.startsWith('ENC:')) throw new Error('bad ciphertext');
      return Buffer.from(s.slice(4), 'base64').toString('utf8');
    },
  };
}

const quiet = { error: () => {}, warn: () => {}, info: () => {} };

function makeVault({ available = true, fs = makeFakeFs() } = {}) {
  const vault = createHistoryVault({
    filePath: 'data/translation-data.enc',
    fs,
    path: PATH_SHIM,
    safeStorage: makeFakeSafeStorage(available),
    logger: quiet,
  });
  return { vault, fs };
}

describe('history-vault', () => {
  it('reports available with no file before first save', () => {
    const { vault } = makeVault();
    expect(vault.status()).toEqual({ available: true, exists: false, fileSize: 0 });
  });

  it('round-trips a JSON string through encrypt/decrypt', () => {
    const { vault } = makeVault();
    const blob = JSON.stringify({ state: { history: [{ id: '1', sourceText: '你好' }] }, version: 0 });
    expect(vault.save(blob)).toEqual({ success: true });
    expect(vault.load()).toBe(blob);
    const st = vault.status();
    expect(st.exists).toBe(true);
    expect(st.fileSize).toBeGreaterThan(0);
  });

  it('stores ciphertext, not plaintext', () => {
    const { vault, fs } = makeVault();
    vault.save('{"secret":"史记"}');
    const onDisk = fs.files.get('data/translation-data.enc').toString();
    expect(onDisk).not.toContain('史记');
    expect(onDisk.startsWith('ENC:')).toBe(true);
  });

  it('leaves no temp file behind after save', () => {
    const { vault, fs } = makeVault();
    vault.save('{"a":1}');
    expect([...fs.files.keys()]).toEqual(['data/translation-data.enc']);
  });

  it('refuses to save when encryption is unavailable', () => {
    const { vault } = makeVault({ available: false });
    expect(vault.save('{"a":1}')).toEqual({ success: false, reason: 'unavailable' });
    expect(vault.load()).toBeNull();
    expect(vault.status().available).toBe(false);
  });

  it('refuses empty or non-string payloads', () => {
    const { vault } = makeVault();
    expect(vault.save('').success).toBe(false);
    expect(vault.save(null).success).toBe(false);
    expect(vault.save(42).success).toBe(false);
  });

  it('quarantines an undecryptable file and returns null', () => {
    const fs = makeFakeFs();
    fs.files.set('data/translation-data.enc', Buffer.from('garbage-not-ciphertext'));
    const { vault } = makeVault({ fs });
    expect(vault.load()).toBeNull();
    const names = [...fs.files.keys()];
    expect(names.some((n) => n.startsWith('data/translation-data.enc.corrupt-'))).toBe(true);
    expect(fs.files.has('data/translation-data.enc')).toBe(false);
  });

  it('load returns null when no file exists', () => {
    const { vault } = makeVault();
    expect(vault.load()).toBeNull();
  });

  it('clear removes the file and treats absence as success', () => {
    const { vault, fs } = makeVault();
    vault.save('{"a":1}');
    expect(vault.clear()).toEqual({ success: true });
    expect(fs.files.size).toBe(0);
    expect(vault.clear()).toEqual({ success: true });
  });
});
