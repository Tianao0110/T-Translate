// src/config/filters.js
// 免译名单（正则保护）配置
//

import createLogger from '../utils/logger.js';
const logger = createLogger('Filters');
// 这些模式匹配的内容在翻译时会被保护，不会被翻译
// 翻译完成后会自动恢复原内容

/**
 * 默认免译过滤器
 * 每个过滤器包含：
 * - name: 唯一标识符
 * - pattern: 正则表达式（必须带 g 标志）
 * - description: 中文描述
 * - enabled: 是否默认启用
 */
export const DEFAULT_FILTERS = [
  {
    name: 'code_block',
    pattern: /```[\s\S]*?```/g,
    description: '代码块 (```...```)',
    enabled: true,
  },
  {
    name: 'inline_code',
    pattern: /`[^`\n]+`/g,
    description: '行内代码 (`...`)',
    enabled: true,
  },
  {
    name: 'url',
    pattern: /https?:\/\/[^\s<>"'\]）》]+/g,
    description: 'URL 链接',
    enabled: true,
  },
  {
    name: 'email',
    pattern: /[\w.-]+@[\w.-]+\.\w{2,}/g,
    description: '邮箱地址',
    enabled: true,
  },
  {
    name: 'file_path',
    pattern: /(?:\/[\w.-]+)+\/?|[A-Z]:\\[\w\\.-]+/g,
    description: '文件路径',
    enabled: true,
  },
  {
    name: 'placeholder_curly',
    pattern: /\{\{[^}]+\}\}/g,
    description: '占位符 {{xxx}}',
    enabled: true,
  },
  {
    name: 'placeholder_percent',
    pattern: /%\w+%/g,
    description: '占位符 %xxx%',
    enabled: true,
  },
  {
    name: 'html_tag',
    pattern: /<\/?[a-zA-Z][^>]*>/g,
    description: 'HTML 标签',
    enabled: false,  // 默认关闭，可能影响正常文本
  },
  {
    name: 'markdown_link',
    pattern: /\[([^\]]+)\]\([^)]+\)/g,
    description: 'Markdown 链接 [text](url)',
    enabled: false,  // 默认关闭，保留链接文字翻译
  },
  {
    name: 'version_number',
    pattern: /v?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?/g,
    description: '版本号 (v1.2.3)',
    enabled: true,
  },
  {
    name: 'hex_color',
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
    description: '颜色代码 (#fff, #ffffff)',
    enabled: true,
  },
];

/**
 * 用户自定义过滤器的存储 Key
 */
export const USER_FILTERS_KEY = 'translation.customFilters';

/**
 * 获取所有启用的过滤器
 * @param {Array} userFilters - 用户自定义过滤器
 * @returns {Array} 启用的过滤器列表
 */
export function getEnabledFilters(userFilters = []) {
  const defaultEnabled = DEFAULT_FILTERS.filter(f => f.enabled);
  
  // 用户过滤器可以覆盖默认配置
  const userEnabled = userFilters.filter(f => f.enabled);
  
  // 合并：用户配置优先
  const filterMap = new Map();
  defaultEnabled.forEach(f => filterMap.set(f.name, f));
  userEnabled.forEach(f => filterMap.set(f.name, f));
  
  return Array.from(filterMap.values());
}

/**
 * 创建自定义过滤器
 * @param {string} name - 过滤器名称
 * @param {string} patternStr - 正则表达式字符串
 * @param {string} description - 描述
 * @returns {object|null} 过滤器对象或 null（如果正则无效）
 */
export function createCustomFilter(name, patternStr, description = '') {
  try {
    // 验证正则表达式
    const pattern = new RegExp(patternStr, 'g');
    
    return {
      name: `custom_${name}`,
      pattern,
      description: description || `自定义: ${patternStr}`,
      enabled: true,
      isCustom: true,
    };
  } catch (error) {
    logger.error('Invalid regex:', patternStr, error);
    return null;
  }
}

/**
 * 验证过滤器是否有效
 * @param {object} filter - 过滤器对象
 * @returns {boolean}
 */
export function validateFilter(filter) {
  if (!filter || typeof filter !== 'object') return false;
  if (!filter.name || typeof filter.name !== 'string') return false;
  if (!filter.pattern || !(filter.pattern instanceof RegExp)) return false;
  if (!filter.pattern.global) return false;  // 必须有 g 标志
  return true;
}

export default {
  DEFAULT_FILTERS,
  USER_FILTERS_KEY,
  getEnabledFilters,
  createCustomFilter,
  validateFilter,
};
