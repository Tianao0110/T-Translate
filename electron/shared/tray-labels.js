// electron/shared/tray-labels.js
// 托盘菜单翻译表 - 供主进程使用
// 由于主进程无法直接使用 react-i18next，需要维护独立的翻译表

const trayLabels = {
  zh: {
    screenshot: '截图翻译',
    glassWindow: '悬浮翻译',
    selectionTranslate: '划词翻译',
    settings: '设置',
    quit: '退出'
  },
  en: {
    screenshot: 'Screenshot Translate',
    glassWindow: 'Floating Translate',
    selectionTranslate: 'Selection Translate',
    settings: 'Settings',
    quit: 'Quit'
  }
};

// 当前语言（默认中文）
let currentLang = 'zh';

/**
 * 设置当前语言
 * @param {string} lang - 语言代码 ('zh' | 'en')
 */
function setLanguage(lang) {
  if (trayLabels[lang]) {
    currentLang = lang;
    return true;
  }
  return false;
}

/**
 * 获取当前语言
 * @returns {string}
 */
function getLanguage() {
  return currentLang;
}

/**
 * 获取翻译文本
 * @param {string} key - 翻译键
 * @returns {string}
 */
function t(key) {
  return trayLabels[currentLang]?.[key] || trayLabels.zh[key] || key;
}

/**
 * 获取所有翻译
 * @returns {Object}
 */
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
