// src/stores/index.js
// Store 模块入口

export { default as useConfigStore, useConfigStore as configStore } from './config.js';
export { default as useSessionStore, useSessionStore as sessionStore, STATUS } from './session.js';

// 保留原有的 translation-store 以兼容旧代码
export { default as useTranslationStore } from './translation-store.js';
