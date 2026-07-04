// Online-OCR API keys must live in safeStorage like provider keys, never in
// the plaintext settings.ocr bucket. Every consumer of the bucket goes
// through these helpers: encrypt-and-strip on save, decrypt-and-merge on load.
// Vault key naming: ocr_<flatField> — the ocr_ prefix is what the offline
// privacy gate in electron/ipc/secure-storage.js matches on.

import createLogger from './logger.js';

const logger = createLogger('OcrKeyVault');

// Flat settings.ocr field names of all secret values (matches _buildConfigs
// in providers/ocr/index.js). azureEndpoint / recognitionLanguage are not
// secrets and stay in the bucket.
export const OCR_SECRET_FIELDS = [
  'ocrspaceKey',
  'googleVisionKey',
  'azureKey',
  'baiduApiKey',
  'baiduSecretKey',
];

const vaultKey = (field) => `ocr_${field}`;

// Returns { sanitized, failed }. sanitized is a copy safe to persist: secret
// fields are stripped after a successful encrypt; cleared (empty) values also
// delete the vault entry so a removed key cannot resurrect on next launch.
// failed lists fields that could not be encrypted — they are still stripped
// (plaintext is never written), the caller must surface the error.
export async function encryptOcrSecrets(ocrSettings = {}) {
  const sanitized = { ...ocrSettings };
  const failed = [];
  const ss = window.electron?.secureStorage;

  for (const field of OCR_SECRET_FIELDS) {
    if (!(field in sanitized)) continue;
    const value = sanitized[field];
    delete sanitized[field];

    if (!value) {
      try { await ss?.delete?.(vaultKey(field)); } catch { /* best effort */ }
      continue;
    }
    if (!ss?.encrypt) {
      failed.push(field);
      continue;
    }
    try {
      const res = await ss.encrypt(vaultKey(field), value);
      if (res === false || res?.success === false) failed.push(field);
    } catch (e) {
      logger.warn(`Encrypt failed for ${field}:`, e.message);
      failed.push(field);
    }
  }

  return { sanitized, failed };
}

// Merges vault secrets into a copy of the bucket. An existing truthy bucket
// value wins — that covers not-yet-migrated legacy plaintext. Decrypt
// returning null (offline gate, DPAPI unavailable, no entry) leaves the
// engine unconfigured, which is the correct failure mode.
export async function decryptOcrSecrets(ocrSettings = {}, context = 'ocr-config') {
  const merged = { ...ocrSettings };
  const ss = window.electron?.secureStorage;
  if (!ss?.decrypt) return merged;

  for (const field of OCR_SECRET_FIELDS) {
    if (merged[field]) continue;
    try {
      const value = await ss.decrypt(vaultKey(field), { context });
      if (value) merged[field] = value;
    } catch (e) {
      logger.debug(`Decrypt failed for ${field}:`, e.message);
    }
  }
  return merged;
}

// One-shot migration of pre-0.3 plaintext keys out of settings.ocr. A field
// is only stripped once its encrypt succeeded — on DPAPI-less machines legacy
// plaintext keeps working (grandfathered), we just refuse to write new ones.
// Idempotent: after a full migration no secret fields remain in the bucket.
export async function migrateLegacyOcrSecrets() {
  const store = window.electron?.store;
  if (!store?.get || !store?.set) return;

  try {
    const bucket = await store.get('settings.ocr');
    if (!bucket || typeof bucket !== 'object') return;
    if (!OCR_SECRET_FIELDS.some((f) => bucket[f])) return;

    const { sanitized, failed } = await encryptOcrSecrets(bucket);
    for (const field of failed) {
      if (bucket[field] !== undefined) sanitized[field] = bucket[field];
    }
    await store.set('settings.ocr', sanitized);
    logger.info(`Migrated OCR keys to secure storage (${failed.length ? `kept ${failed.length} plaintext, encryption unavailable` : 'all encrypted'})`);
  } catch (e) {
    logger.warn('Legacy OCR key migration failed:', e.message);
  }
}
