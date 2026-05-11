// Language packs live under src/i18n/locales/ (zh.js, en.js).
// To add a language: see docs/I18N_GUIDE.md.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './i18n/locales/zh.js';
import en from './i18n/locales/en.js';

// Priority: localStorage > system language > English.
function detectLanguage() {
  const savedLanguage = localStorage.getItem('app-language');
  if (savedLanguage) {
    return savedLanguage;
  }

  const systemLanguages = navigator.languages || [navigator.language];
  for (const lang of systemLanguages) {
    if (lang.toLowerCase().startsWith('zh')) {
      return 'zh';
    }
  }

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

// Tray menu syncs via store subscription, so no IPC call needed here.
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('app-language', lng);
});

export default i18n;
