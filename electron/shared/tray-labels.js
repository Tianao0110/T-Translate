// Tray-menu translation table for the main process.
// react-i18next is renderer-only; the main process needs its own minimal table.

const trayLabels = {
  zh: {
    screenshot: '截图翻译',
    glassWindow: '悬浮窗口',
    selectionTranslate: '划词翻译',
    settings: '设置',
    quit: '退出'
  },
  en: {
    screenshot: 'Screenshot Translate',
    glassWindow: 'Floating Window',
    selectionTranslate: 'Selection Translate',
    settings: 'Settings',
    quit: 'Quit'
  }
};

let currentLang = 'zh';

function setLanguage(lang) {
  if (trayLabels[lang]) {
    currentLang = lang;
    return true;
  }
  return false;
}

function getLanguage() {
  return currentLang;
}

// Lookup with fallback to zh, then to the key itself.
function t(key) {
  return trayLabels[currentLang]?.[key] || trayLabels.zh[key] || key;
}

function getLabels() {
  return trayLabels[currentLang] || trayLabels.zh;
}

module.exports = {
  trayLabels,
  setLanguage,
  getLanguage,
  t,
  getLabels
};
