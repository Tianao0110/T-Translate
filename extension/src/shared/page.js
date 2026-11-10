// Shared bits of the extension's own pages: message lookup and filling
// [data-i18n] elements from _locales.

export const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

export function localize(root = document) {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}
