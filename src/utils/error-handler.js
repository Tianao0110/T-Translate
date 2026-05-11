// Translates raw errors into user-friendly messages with suggestions.
// Two layers: pattern-matched type (network/api_key/quota/etc.) plus
// provider-specific overrides for higher-fidelity hints.

import i18n from '../i18n.js';

const _t = (key, fallback) => {
  try { const r = i18n.t(key); return r === key ? fallback : r; } catch { return fallback; }
};

export const ERROR_TYPES = {
  NETWORK: 'network',
  API_KEY: 'api_key',
  API_QUOTA: 'api_quota',
  API_ERROR: 'api_error',
  TIMEOUT: 'timeout',
  CONFIG: 'config',
  PROVIDER: 'provider',
  OCR: 'ocr',
  UNKNOWN: 'unknown',
};

const ERROR_PATTERNS = [
  {
    type: ERROR_TYPES.NETWORK,
    patterns: [
      /failed to fetch/i,
      /network\s*error/i,
      /net::err/i,
      /econnrefused/i,
      /enotfound/i,
      /econnreset/i,
      /unable to connect/i,
      /无法连接/,
      /网络/,
    ],
  },
  {
    type: ERROR_TYPES.API_KEY,
    patterns: [
      /invalid.*api.*key/i,
      /unauthorized/i,
      /authentication/i,
      /401/,
      /api.*key.*invalid/i,
      /incorrect.*api.*key/i,
      /请配置.*key/i,
      /未配置/,
    ],
  },
  {
    type: ERROR_TYPES.API_QUOTA,
    patterns: [
      /quota/i,
      /rate.*limit/i,
      /too many requests/i,
      /429/,
      /exceeded/i,
      /limit.*reached/i,
    ],
  },
  {
    type: ERROR_TYPES.TIMEOUT,
    patterns: [
      /timeout/i,
      /timed?\s*out/i,
      /超时/,
      /请求超时/,
    ],
  },
  {
    type: ERROR_TYPES.CONFIG,
    patterns: [
      /endpoint/i,
      /url.*invalid/i,
      /配置/,
      /设置/,
    ],
  },
];

// Lazy-evaluated so the running i18n locale is picked up at format time
function getFriendlyMessages() {
  return {
    [ERROR_TYPES.NETWORK]: {
      title: _t('errors.network.title', '网络连接失败'),
      message: _t('errors.network.message', '无法连接到翻译服务'),
      suggestions: [
        _t('errors.network.s1', '检查网络连接是否正常'),
        _t('errors.network.s2', '如果使用本地 LLM，请确保 LM Studio 正在运行'),
        _t('errors.network.s3', '检查防火墙设置是否阻止了连接'),
      ],
      action: null,
    },
    [ERROR_TYPES.API_KEY]: {
      title: _t('errors.apiKey.title', 'API 密钥无效'),
      message: _t('errors.apiKey.message', 'API 密钥未配置或已失效'),
      suggestions: [
        _t('errors.apiKey.s1', '检查 API Key 是否正确输入'),
        _t('errors.apiKey.s2', '确认 API Key 没有过期'),
        _t('errors.apiKey.s3', '前往设置页面重新配置'),
      ],
      action: { type: 'openSettings', label: _t('errors.openSettings', '打开设置') },
    },
    [ERROR_TYPES.API_QUOTA]: {
      title: _t('errors.quota.title', '请求次数超限'),
      message: _t('errors.quota.message', 'API 调用次数已达上限'),
      suggestions: [
        _t('errors.quota.s1', '稍后再试'),
        _t('errors.quota.s2', '切换到其他翻译源'),
        _t('errors.quota.s3', '检查 API 账户配额'),
      ],
      action: { type: 'switchProvider', label: _t('errors.switchProvider', '切换翻译源') },
    },
    [ERROR_TYPES.TIMEOUT]: {
      title: _t('errors.timeout.title', '请求超时'),
      message: _t('errors.timeout.message', '翻译服务响应时间过长'),
      suggestions: [
        _t('errors.timeout.s1', '网络可能较慢，请稍后重试'),
        _t('errors.timeout.s2', '如果使用本地 LLM，模型可能正在加载'),
        _t('errors.timeout.s3', '尝试翻译较短的文本'),
      ],
      action: { type: 'retry', label: _t('errors.retry', '重试') },
    },
    [ERROR_TYPES.CONFIG]: {
      title: _t('errors.config.title', '配置错误'),
      message: _t('errors.config.message', '翻译源配置不正确'),
      suggestions: [
        _t('errors.config.s1', '检查 API 地址是否正确'),
        _t('errors.config.s2', '确认翻译源已正确配置'),
      ],
      action: { type: 'openSettings', label: _t('errors.openSettings', '打开设置') },
    },
    [ERROR_TYPES.PROVIDER]: {
      title: _t('errors.provider.title', '翻译源不可用'),
      message: _t('errors.provider.message', '当前翻译源暂时无法使用'),
      suggestions: [
        _t('errors.provider.s1', '尝试切换到其他翻译源'),
        _t('errors.provider.s2', '检查翻译源配置'),
      ],
      action: { type: 'switchProvider', label: _t('errors.switchProvider', '切换翻译源') },
    },
    [ERROR_TYPES.OCR]: {
      title: _t('errors.ocr.title', 'OCR 识别失败'),
      message: _t('errors.ocr.message', '文字识别出现问题'),
      suggestions: [
        _t('errors.ocr.s1', '确保图片清晰且包含文字'),
        _t('errors.ocr.s2', '尝试调整截图区域'),
        _t('errors.ocr.s3', '切换其他 OCR 引擎'),
      ],
      action: null,
    },
    [ERROR_TYPES.UNKNOWN]: {
      title: _t('errors.unknown.title', '操作失败'),
      message: _t('errors.unknown.message', '发生未知错误'),
      suggestions: [
        _t('errors.unknown.s1', '请稍后重试'),
        _t('errors.unknown.s2', '如果问题持续，请检查设置'),
      ],
      action: { type: 'retry', label: _t('errors.retry', '重试') },
    },
  };
}

function getProviderMessages() {
  return {
    'local-llm': {
      network: _t('errors.p.localLlm.network', 'LM Studio 未运行或无法连接。请确保 LM Studio 已启动并加载了模型。'),
      config: _t('errors.p.localLlm.config', '请检查 LM Studio 地址配置（默认 http://localhost:1234）'),
    },
    'openai': {
      api_key: _t('errors.p.openai.apiKey', 'OpenAI API Key 无效。请在设置中检查您的 API Key。'),
      quota: _t('errors.p.openai.quota', 'OpenAI API 配额已用尽。请检查您的账户余额。'),
    },
    'deepl': {
      api_key: _t('errors.p.deepl.apiKey', 'DeepL API Key 无效。请确认使用的是 API Key 而非账户密码。'),
      quota: _t('errors.p.deepl.quota', 'DeepL 免费版配额已用尽。考虑升级或切换翻译源。'),
    },
    'gemini': {
      api_key: _t('errors.p.gemini.apiKey', 'Gemini API Key 无效。请前往 Google AI Studio 获取有效的 Key。'),
    },
    'deepseek': {
      api_key: _t('errors.p.deepseek.apiKey', 'DeepSeek API Key 无效。请检查配置。'),
    },
    'google-translate': {
      network: _t('errors.p.google.network', 'Google 翻译服务暂时无法访问。可能需要网络代理。'),
    },
  };
}

export function detectErrorType(error) {
  const message = typeof error === 'string' ? error : (error?.message || String(error));

  for (const rule of ERROR_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        return rule.type;
      }
    }
  }

  return ERROR_TYPES.UNKNOWN;
}

export function formatError(error, options = {}) {
  const { provider, context } = options;
  const errorMessage = typeof error === 'string' ? error : (error?.message || String(error));
  const errorType = detectErrorType(errorMessage);

  const FRIENDLY_MESSAGES = getFriendlyMessages();
  const PROVIDER_MESSAGES = getProviderMessages();

  const baseInfo = FRIENDLY_MESSAGES[errorType] || FRIENDLY_MESSAGES[ERROR_TYPES.UNKNOWN];

  let specificMessage = null;
  if (provider && PROVIDER_MESSAGES[provider]) {
    const providerMsgs = PROVIDER_MESSAGES[provider];
    specificMessage = providerMsgs[errorType];
  }

  const result = {
    type: errorType,
    title: baseInfo.title,
    message: specificMessage || baseInfo.message,
    detail: errorMessage, // raw error preserved for debugging
    suggestions: baseInfo.suggestions,
    action: baseInfo.action,
    provider: provider || null,
  };

  // For OCR-context errors that weren't classified as OCR, prefix the title
  // so the user knows which subsystem failed
  if (context === 'ocr' && errorType !== ERROR_TYPES.OCR) {
    result.title = 'OCR ' + result.title;
  }

  return result;
}

// Compact form for toasts / inline error labels
export function getShortErrorMessage(error, options = {}) {
  const formatted = formatError(error, options);
  const FRIENDLY_MESSAGES = getFriendlyMessages();

  // Prefer the provider-specific message if one matched
  if (formatted.message !== FRIENDLY_MESSAGES[formatted.type]?.message) {
    return formatted.message;
  }

  return `${formatted.title}：${formatted.message}`;
}

export function isRetryable(errorType) {
  return [
    ERROR_TYPES.NETWORK,
    ERROR_TYPES.TIMEOUT,
    ERROR_TYPES.API_QUOTA,
  ].includes(errorType);
}

export function requiresUserAction(errorType) {
  return [
    ERROR_TYPES.API_KEY,
    ERROR_TYPES.CONFIG,
  ].includes(errorType);
}

export function getSuggestedAction(formattedError) {
  if (!formattedError) return null;

  if (formattedError.action) {
    return formattedError.action;
  }

  if (requiresUserAction(formattedError.type)) {
    return { type: 'openSettings', label: _t('errors.checkSettings', '检查设置') };
  }

  if (isRetryable(formattedError.type)) {
    return { type: 'retry', label: _t('errors.retry', '重试') };
  }

  return null;
}

export default {
  ERROR_TYPES,
  detectErrorType,
  formatError,
  getShortErrorMessage,
  isRetryable,
  requiresUserAction,
  getSuggestedAction,
};
