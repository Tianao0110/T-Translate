// src/utils/error-handler.js
// 用户友好的错误处理工具
// 将技术性错误转换为易理解的消息，并提供解决建议

/**
 * 错误类型枚举
 */
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

/**
 * 错误模式匹配规则
 * 用于识别错误类型
 */
const ERROR_PATTERNS = [
  // 网络错误
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
  // API Key 错误
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
  // API 配额错误
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
  // 超时错误
  {
    type: ERROR_TYPES.TIMEOUT,
    patterns: [
      /timeout/i,
      /timed?\s*out/i,
      /超时/,
      /请求超时/,
    ],
  },
  // 配置错误
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

/**
 * 用户友好的错误消息映射
 */
const FRIENDLY_MESSAGES = {
  [ERROR_TYPES.NETWORK]: {
    title: '网络连接失败',
    message: '无法连接到翻译服务',
    suggestions: [
      '检查网络连接是否正常',
      '如果使用本地 LLM，请确保 LM Studio 正在运行',
      '检查防火墙设置是否阻止了连接',
    ],
    action: null,
  },
  [ERROR_TYPES.API_KEY]: {
    title: 'API 密钥无效',
    message: 'API 密钥未配置或已失效',
    suggestions: [
      '检查 API Key 是否正确输入',
      '确认 API Key 没有过期',
      '前往设置页面重新配置',
    ],
    action: { type: 'openSettings', label: '打开设置' },
  },
  [ERROR_TYPES.API_QUOTA]: {
    title: '请求次数超限',
    message: 'API 调用次数已达上限',
    suggestions: [
      '稍后再试',
      '切换到其他翻译源',
      '检查 API 账户配额',
    ],
    action: { type: 'switchProvider', label: '切换翻译源' },
  },
  [ERROR_TYPES.TIMEOUT]: {
    title: '请求超时',
    message: '翻译服务响应时间过长',
    suggestions: [
      '网络可能较慢，请稍后重试',
      '如果使用本地 LLM，模型可能正在加载',
      '尝试翻译较短的文本',
    ],
    action: { type: 'retry', label: '重试' },
  },
  [ERROR_TYPES.CONFIG]: {
    title: '配置错误',
    message: '翻译源配置不正确',
    suggestions: [
      '检查 API 地址是否正确',
      '确认翻译源已正确配置',
    ],
    action: { type: 'openSettings', label: '打开设置' },
  },
  [ERROR_TYPES.PROVIDER]: {
    title: '翻译源不可用',
    message: '当前翻译源暂时无法使用',
    suggestions: [
      '尝试切换到其他翻译源',
      '检查翻译源配置',
    ],
    action: { type: 'switchProvider', label: '切换翻译源' },
  },
  [ERROR_TYPES.OCR]: {
    title: 'OCR 识别失败',
    message: '文字识别出现问题',
    suggestions: [
      '确保图片清晰且包含文字',
      '尝试调整截图区域',
      '切换其他 OCR 引擎',
    ],
    action: null,
  },
  [ERROR_TYPES.UNKNOWN]: {
    title: '操作失败',
    message: '发生未知错误',
    suggestions: [
      '请稍后重试',
      '如果问题持续，请检查设置',
    ],
    action: { type: 'retry', label: '重试' },
  },
};

/**
 * Provider 特定的错误消息
 */
const PROVIDER_MESSAGES = {
  'local-llm': {
    network: 'LM Studio 未运行或无法连接。请确保 LM Studio 已启动并加载了模型。',
    config: '请检查 LM Studio 地址配置（默认 http://localhost:1234）',
  },
  'openai': {
    api_key: 'OpenAI API Key 无效。请在设置中检查您的 API Key。',
    quota: 'OpenAI API 配额已用尽。请检查您的账户余额。',
  },
  'deepl': {
    api_key: 'DeepL API Key 无效。请确认使用的是 API Key 而非账户密码。',
    quota: 'DeepL 免费版配额已用尽。考虑升级或切换翻译源。',
  },
  'gemini': {
    api_key: 'Gemini API Key 无效。请前往 Google AI Studio 获取有效的 Key。',
  },
  'deepseek': {
    api_key: 'DeepSeek API Key 无效。请检查配置。',
  },
  'google-translate': {
    network: 'Google 翻译服务暂时无法访问。可能需要网络代理。',
  },
};

/**
 * 检测错误类型
 * @param {string|Error} error - 错误消息或错误对象
 * @returns {string} 错误类型
 */
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

/**
 * 获取用户友好的错误信息
 * @param {string|Error} error - 原始错误
 * @param {object} options - 选项
 * @param {string} options.provider - 翻译源 ID
 * @param {string} options.context - 上下文（如 'translation', 'ocr'）
 * @returns {object} 格式化的错误信息
 */
export function formatError(error, options = {}) {
  const { provider, context } = options;
  const errorMessage = typeof error === 'string' ? error : (error?.message || String(error));
  const errorType = detectErrorType(errorMessage);
  
  // 获取基础消息
  const baseInfo = FRIENDLY_MESSAGES[errorType] || FRIENDLY_MESSAGES[ERROR_TYPES.UNKNOWN];
  
  // 尝试获取 Provider 特定消息
  let specificMessage = null;
  if (provider && PROVIDER_MESSAGES[provider]) {
    const providerMsgs = PROVIDER_MESSAGES[provider];
    specificMessage = providerMsgs[errorType];
  }
  
  // 构建最终结果
  const result = {
    type: errorType,
    title: baseInfo.title,
    message: specificMessage || baseInfo.message,
    detail: errorMessage, // 保留原始错误供调试
    suggestions: baseInfo.suggestions,
    action: baseInfo.action,
    provider: provider || null,
  };
  
  // OCR 上下文特殊处理
  if (context === 'ocr' && errorType !== ERROR_TYPES.OCR) {
    result.title = 'OCR ' + result.title;
  }
  
  return result;
}

/**
 * 生成简短的错误提示文本
 * 用于 notify 等简短提示场景
 * @param {string|Error} error - 原始错误
 * @param {object} options - 选项
 * @returns {string} 简短的错误提示
 */
export function getShortErrorMessage(error, options = {}) {
  const formatted = formatError(error, options);
  
  // 如果有 provider 特定消息，使用它
  if (formatted.message !== FRIENDLY_MESSAGES[formatted.type]?.message) {
    return formatted.message;
  }
  
  // 否则返回 title + 简短说明
  return `${formatted.title}：${formatted.message}`;
}

/**
 * 检查是否是可重试的错误
 * @param {string} errorType - 错误类型
 * @returns {boolean}
 */
export function isRetryable(errorType) {
  return [
    ERROR_TYPES.NETWORK,
    ERROR_TYPES.TIMEOUT,
    ERROR_TYPES.API_QUOTA,
  ].includes(errorType);
}

/**
 * 检查是否需要用户操作的错误
 * @param {string} errorType - 错误类型
 * @returns {boolean}
 */
export function requiresUserAction(errorType) {
  return [
    ERROR_TYPES.API_KEY,
    ERROR_TYPES.CONFIG,
  ].includes(errorType);
}

/**
 * 获取建议的下一步操作
 * @param {object} formattedError - formatError 的返回值
 * @returns {object|null} { type, label } 或 null
 */
export function getSuggestedAction(formattedError) {
  if (!formattedError) return null;
  
  // 如果错误本身有建议的操作
  if (formattedError.action) {
    return formattedError.action;
  }
  
  // 根据错误类型返回默认操作
  if (requiresUserAction(formattedError.type)) {
    return { type: 'openSettings', label: '检查设置' };
  }
  
  if (isRetryable(formattedError.type)) {
    return { type: 'retry', label: '重试' };
  }
  
  return null;
}

// 默认导出
export default {
  ERROR_TYPES,
  detectErrorType,
  formatError,
  getShortErrorMessage,
  isRetryable,
  requiresUserAction,
  getSuggestedAction,
};
