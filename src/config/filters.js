// Pre-translate filters: regex patterns whose matches are protected
// (replaced with placeholders) before sending to the translator, then
// restored after. Used to prevent code, URLs, emails etc. from being
// rewritten by the LLM.

// No logger import here: this file is cross-imported by the main-process
// stack bundle, and utils/logger.js carries a Vite-only import.meta.

// Each filter: { name, pattern (RegExp, MUST be /g), description, enabled }.
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
    enabled: false,  // off by default — too greedy for prose
  },
  {
    name: 'markdown_link',
    pattern: /\[([^\]]+)\]\([^)]+\)/g,
    description: 'Markdown 链接 [text](url)',
    enabled: false,  // off by default — usually we want link text translated
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

export const USER_FILTERS_KEY = 'translation.customFilters';

export function getEnabledFilters(userFilters = []) {
  const defaultEnabled = DEFAULT_FILTERS.filter(f => f.enabled);
  const userEnabled = userFilters.filter(f => f.enabled);

  // User filters with the same name override defaults.
  const filterMap = new Map();
  defaultEnabled.forEach(f => filterMap.set(f.name, f));
  userEnabled.forEach(f => filterMap.set(f.name, f));

  return Array.from(filterMap.values());
}

export default {
  DEFAULT_FILTERS,
  USER_FILTERS_KEY,
  getEnabledFilters,
};
