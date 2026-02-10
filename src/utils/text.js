// src/utils/text.js
// 文本处理工具函数

/**
 * 检测文本语言
 * @param {string} text - 要检测的文本
 * @returns {string} 语言代码 ('zh'|'en'|'ja'|'ko'|'auto')
 */
export function detectLanguage(text) {
  if (!text) return 'auto';
  
  // 中文字符
  if (/[\u4e00-\u9fa5]/.test(text)) return 'zh';
  // 日文假名
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  // 韩文
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  // 默认英文
  return 'en';
}

/**
 * 清理 OCR/翻译输出文本
 * @param {string} text - 原始文本
 * @returns {string} 清理后的文本
 */
export function cleanText(text) {
  if (!text) return '';
  
  return text
    .replace(/\r\n/g, '\n')           // 统一换行符
    .replace(/[ \t]+/g, ' ')          // 合并多个空格
    .replace(/\n{3,}/g, '\n\n')       // 最多两个连续换行
    .trim();
}

/**
 * 清理翻译输出（移除前缀、引号等）
 * @param {string} text - 翻译结果
 * @param {string} source - 原文（用于比较）
 * @returns {string} 清理后的翻译
 */
export function cleanTranslationOutput(text, source = '') {
  if (!text) return '';
  
  let cleaned = text
    // 移除常见前缀
    .replace(/^(翻译[：:]\s*|Translation[：:]\s*|译文[：:]\s*)/i, '')
    // 移除引号
    .replace(/^["'「」『』""''【】]|["'「」『』""''【】]$/g, '')
    // 移除括号注释
    .replace(/\s*（[^）]*）/g, '')
    .replace(/\s*\([^)]*\)/g, '')
    .trim();
  
  // 如果翻译结果和原文相同，返回空
  if (cleaned === source) return '';
  
  return cleaned;
}

/**
 * 检查文本是否值得翻译
 * @param {string} text - 要检查的文本
 * @returns {boolean}
 */
export function shouldTranslateText(text) {
  if (!text || text.length < 2) return false;
  
  const clean = text.trim();
  
  // 纯数字/标点/符号
  if (/^[\d\s\p{P}\p{S}]+$/u.test(clean)) return false;
  
  // 太短的英文（可能是噪声）
  if (clean.length < 3 && /^[a-z]+$/i.test(clean)) return false;
  
  // 包含"译"字开头的（可能是已翻译的标记）
  if (/^译[：:]/.test(clean)) return false;
  
  return true;
}

/**
 * 简单文本相似度（Jaccard 系数）
 * @param {string} text1 
 * @param {string} text2 
 * @returns {number} 0-100 的相似度
 */
export function textSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  if (text1 === text2) return 100;
  
  const set1 = new Set(text1.toLowerCase().split(''));
  const set2 = new Set(text2.toLowerCase().split(''));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return Math.round((intersection.size / union.size) * 100);
}

/**
 * 获取语言显示名称
 * @param {string} code - 语言代码
 * @returns {string} 语言名称
 */
export function getLanguageName(code) {
  const names = {
    'auto': '自动',
    'zh': '中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'es': 'Español',
    'fr': 'Français',
    'de': 'Deutsch',
    'ru': 'Русский',
  };
  return names[code] || code;
}

export default {
  detectLanguage,
  cleanText,
  cleanTranslationOutput,
  shouldTranslateText,
  textSimilarity,
  getLanguageName,
};
