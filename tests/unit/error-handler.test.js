// tests/unit/error-handler.test.js
// 错误处理工具测试
//
// 覆盖: detectErrorType, formatError, getShortErrorMessage, isRetryable

import { describe, it, expect } from 'vitest';
import {
  ERROR_TYPES,
  detectErrorType,
  formatError,
  getShortErrorMessage,
  isRetryable,
  requiresUserAction,
} from '../../src/utils/error-handler.js';

describe('detectErrorType', () => {
  it('detects network errors', () => {
    expect(detectErrorType('Failed to fetch')).toBe(ERROR_TYPES.NETWORK);
    expect(detectErrorType('ECONNREFUSED')).toBe(ERROR_TYPES.NETWORK);
    expect(detectErrorType('ECONNRESET')).toBe(ERROR_TYPES.NETWORK);
    expect(detectErrorType(new Error('Network Error'))).toBe(ERROR_TYPES.NETWORK);
  });

  it('detects API key errors', () => {
    expect(detectErrorType('Invalid API key')).toBe(ERROR_TYPES.API_KEY);
    expect(detectErrorType('Unauthorized')).toBe(ERROR_TYPES.API_KEY);
    expect(detectErrorType('401')).toBe(ERROR_TYPES.API_KEY);
    expect(detectErrorType('未配置 API Key')).toBe(ERROR_TYPES.API_KEY);
  });

  it('detects timeout errors', () => {
    expect(detectErrorType('Request timeout')).toBe(ERROR_TYPES.TIMEOUT);
    expect(detectErrorType('请求超时')).toBe(ERROR_TYPES.TIMEOUT);
    expect(detectErrorType('timed out waiting for response')).toBe(ERROR_TYPES.TIMEOUT);
  });

  it('detects quota errors', () => {
    expect(detectErrorType('Rate limit exceeded')).toBe(ERROR_TYPES.API_QUOTA);
    expect(detectErrorType('Too many requests')).toBe(ERROR_TYPES.API_QUOTA);
    expect(detectErrorType('429')).toBe(ERROR_TYPES.API_QUOTA);
  });

  it('returns UNKNOWN for unrecognized errors', () => {
    expect(detectErrorType('something weird happened')).toBe(ERROR_TYPES.UNKNOWN);
    expect(detectErrorType('')).toBe(ERROR_TYPES.UNKNOWN);
  });

  it('handles null/undefined gracefully', () => {
    expect(detectErrorType(null)).toBe(ERROR_TYPES.UNKNOWN);
    expect(detectErrorType(undefined)).toBe(ERROR_TYPES.UNKNOWN);
  });
});

describe('formatError', () => {
  it('returns structured error with type and message', () => {
    const result = formatError('ECONNREFUSED');
    expect(result).toHaveProperty('type', ERROR_TYPES.NETWORK);
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('detail', 'ECONNREFUSED');
    expect(result).toHaveProperty('suggestions');
  });

  it('includes provider info when specified', () => {
    const result = formatError('Unauthorized', { provider: 'openai' });
    expect(result.provider).toBe('openai');
    expect(result.type).toBe(ERROR_TYPES.API_KEY);
  });

  it('adds OCR prefix for OCR context', () => {
    const result = formatError('ECONNREFUSED', { context: 'ocr' });
    expect(result.title).toMatch(/OCR/);
  });

  it('handles Error objects', () => {
    const err = new Error('Failed to fetch');
    const result = formatError(err);
    expect(result.type).toBe(ERROR_TYPES.NETWORK);
    expect(result.detail).toBe('Failed to fetch');
  });
});

describe('getShortErrorMessage', () => {
  it('returns a non-empty string', () => {
    const msg = getShortErrorMessage('ECONNREFUSED');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('includes provider-specific message when available', () => {
    const msg = getShortErrorMessage('Unauthorized', { provider: 'openai' });
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('isRetryable', () => {
  it('network errors are retryable', () => {
    expect(isRetryable(ERROR_TYPES.NETWORK)).toBe(true);
  });

  it('timeout errors are retryable', () => {
    expect(isRetryable(ERROR_TYPES.TIMEOUT)).toBe(true);
  });

  it('quota errors are retryable', () => {
    expect(isRetryable(ERROR_TYPES.API_QUOTA)).toBe(true);
  });

  it('API key errors are NOT retryable', () => {
    expect(isRetryable(ERROR_TYPES.API_KEY)).toBe(false);
  });

  it('config errors are NOT retryable', () => {
    expect(isRetryable(ERROR_TYPES.CONFIG)).toBe(false);
  });
});

describe('requiresUserAction', () => {
  it('API key errors require user action', () => {
    expect(requiresUserAction(ERROR_TYPES.API_KEY)).toBe(true);
  });

  it('config errors require user action', () => {
    expect(requiresUserAction(ERROR_TYPES.CONFIG)).toBe(true);
  });

  it('network errors do NOT require user action', () => {
    expect(requiresUserAction(ERROR_TYPES.NETWORK)).toBe(false);
  });
});
