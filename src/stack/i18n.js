// Stack-side i18n: a standalone i18next instance over the same locale tables
// the renderer uses (check:i18n governs both ends). Errors stay plain
// localized strings; language is resolved per call via ctx.getLanguage().
// Design notes: docs/design/stack.md §1.

import i18next from 'i18next';
import zh from '../i18n/locales/zh.js';
import en from '../i18n/locales/en.js';
import { getLanguage } from './runtime.js';

const instance = i18next.createInstance();
instance.init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: 'zh',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  initImmediate: false, // synchronous init — the stack must be usable right after import
});

// Same contract as providers/base.js _t: missing key -> Chinese fallback.
export const _t = (key, fallback, params) => {
  try {
    const r = instance.t(key, { ...(params || {}), lng: getLanguage() });
    return r === key ? fallback : r;
  } catch {
    return fallback;
  }
};
