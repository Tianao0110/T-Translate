// Stack-side i18n: a standalone i18next instance over the SAME locale tables
// the renderer uses (single source, check:i18n still governs both ends).
//
// Implementation pivot vs design doc §2.3 (error codes over IPC): bundling the
// shared tables keeps every provider/service error a plain string with
// unchanged wording in both languages — ~40 _t call sites port with only the
// import changed, and text-matching consumers (error-handler ERROR_PATTERNS,
// OCR vision-unsupported sniffing) keep working verbatim. Language is resolved
// per call via ctx.getLanguage(), so a switch needs no sync chain.

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
