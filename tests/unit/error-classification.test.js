import { describe, it, expect } from 'vitest';
import { detectErrorType, ERROR_TYPES } from '../../src/utils/error-handler.js';

// Provider-layer strings were migrated to i18n (both languages). detectErrorType
// must keep classifying them from EITHER locale, or the English UI loses the
// error-to-guidance mapping. These lock the ERROR_PATTERNS keywords in place.
describe('detectErrorType — bilingual provider messages', () => {
  const cases = [
    // [input, expectedType]
    ['未配置 API Key', ERROR_TYPES.API_KEY],
    ['API Key not configured', ERROR_TYPES.API_KEY],
    ['App ID or secret key not configured', ERROR_TYPES.API_KEY],
    ['API Key 无效', ERROR_TYPES.API_KEY],
    ['Invalid API Key', ERROR_TYPES.API_KEY],
    ['API Key invalid or expired', ERROR_TYPES.API_KEY],

    ['连接失败', ERROR_TYPES.NETWORK],
    ['Connection failed', ERROR_TYPES.NETWORK],
    ['无法连接，请检查网络或尝试其他服务器', ERROR_TYPES.NETWORK],
    ['Cannot connect — check your network or try another server', ERROR_TYPES.NETWORK],

    ['请求超时', ERROR_TYPES.TIMEOUT],
    ['Request timeout', ERROR_TYPES.TIMEOUT],

    ['配额已用完', ERROR_TYPES.API_QUOTA],
    ['Quota exhausted', ERROR_TYPES.API_QUOTA],

    ['没有可用的翻译源', ERROR_TYPES.PROVIDER],
    ['所有翻译源均失败', ERROR_TYPES.PROVIDER],
    ['All translation providers failed', ERROR_TYPES.PROVIDER],
  ];

  for (const [input, expected] of cases) {
    it(`classifies "${input}" as ${expected}`, () => {
      expect(detectErrorType(input)).toBe(expected);
    });
  }
});
