// src/i18n.js
// i18n 初始化 - 语言包已拆分到 i18n/locales/ 目录
//
// 语言包文件:
//   src/i18n/locales/zh.js  - 中文 (~420 行)
//   src/i18n/locales/en.js  - English (~420 行)
//
// 添加新语言: 参考 docs/I18N_GUIDE.md

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './i18n/locales/zh.js';
import en from './i18n/locales/en.js';

// ========== 语言检测逻辑 ==========
// 优先级：localStorage > 系统语言检测 > 默认英语
function detectLanguage() {
  // 1. 检查是否有保存的语言设置
  const savedLanguage = localStorage.getItem('app-language');
  if (savedLanguage) {
    return savedLanguage;
  }
  
  // 2. 检测系统语言（浏览器/Electron 环境）
  const systemLanguages = navigator.languages || [navigator.language];
  for (const lang of systemLanguages) {
    // 检测是否为中文（zh, zh-CN, zh-TW, zh-HK 等）
    if (lang.toLowerCase().startsWith('zh')) {
      return 'zh';
    }
  }
  
  // 3. 默认使用英语
  return 'en';
}

const detectedLanguage = detectLanguage();

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en }
    },
    lng: detectedLanguage,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

// 语言切换时保存到 localStorage
// 注：托盘菜单通过监听 store 变化自动同步，无需 IPC 调用
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('app-language', lng);
});

export default i18n;
