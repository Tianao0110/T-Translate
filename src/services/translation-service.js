// src/services/translation-service.js
// 兼容层 - 重定向到 translation.js
//
// 保留此文件是为了向后兼容，避免破坏现有引用
// 新代码请直接使用: import translationService from './translation.js'

import translationService, { TranslationService } from './translation.js';

export default translationService;
export { TranslationService };
