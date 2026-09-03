import { describe, it, expect } from 'vitest';
import { isOcrEngineAllowed, isProviderAllowed, getPrivacyModeConfig } from '../../src/stack/privacy-modes.js';
import { OCR_ENGINES, PROVIDER_IDS, PRIVACY_MODES } from '../../src/config/constants.js';

describe('privacy modes: engine allowlists', () => {
  it('standard allows everything', () => {
    for (const id of Object.values(OCR_ENGINES)) expect(isOcrEngineAllowed(id, PRIVACY_MODES.STANDARD)).toBe(true);
    for (const id of Object.values(PROVIDER_IDS)) expect(isProviderAllowed(id, PRIVACY_MODES.STANDARD)).toBe(true);
  });

  it('secure drops only Windows OCR (it writes the capture to a temp file)', () => {
    expect(isOcrEngineAllowed(OCR_ENGINES.WINDOWS_OCR, PRIVACY_MODES.SECURE)).toBe(false);
    for (const id of Object.values(OCR_ENGINES)) {
      if (id === OCR_ENGINES.WINDOWS_OCR) continue;
      expect(isOcrEngineAllowed(id, PRIVACY_MODES.SECURE)).toBe(true);
    }
    expect(getPrivacyModeConfig(PRIVACY_MODES.SECURE).allowedProviders).toBeNull();
  });

  it('offline keeps only local providers and local OCR engines', () => {
    expect(isProviderAllowed(PROVIDER_IDS.LOCAL_LLM, PRIVACY_MODES.OFFLINE)).toBe(true);
    expect(isProviderAllowed(PROVIDER_IDS.DEEPL, PRIVACY_MODES.OFFLINE)).toBe(false);
    expect(isOcrEngineAllowed(OCR_ENGINES.RAPID_OCR, PRIVACY_MODES.OFFLINE)).toBe(true);
    expect(isOcrEngineAllowed(OCR_ENGINES.OCRSPACE, PRIVACY_MODES.OFFLINE)).toBe(false);
  });

  it('secure writes nothing: history, cache, stats, export all off', () => {
    const f = getPrivacyModeConfig(PRIVACY_MODES.SECURE).features;
    expect(f.saveHistory).toBe(false);
    expect(f.useCache).toBe(false);
    expect(f.analytics).toBe(false);
    expect(f.exportData).toBe(false);
  });
});
