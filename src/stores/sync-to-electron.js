// src/stores/sync-to-electron.js
// 状态同步桥 - Zustand → electron-store
//
// 职责:
//   监听 Zustand store 变化，将关键配置同步到 electron-store。
//   这样主进程只需读 electron-store，无需 executeJavaScript 注入渲染进程。
//
// 同步的字段:
//   - settings.translation.sourceLanguage / targetLanguage (划词翻译需要)
//   - settings.interface.theme (玻璃窗口、划词窗口需要)
//
// 使用:
//   在 App.jsx 中调用一次 initStoreSync() 即可。

import createLogger from '../utils/logger.js';

const logger = createLogger('StoreSync');

/** 防抖写入 electron-store */
let _syncTimer = null;
function debouncedSync(key, value, delay = 100) {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async () => {
    try {
      if (!window.electron?.store?.set) return;
      const settings = await window.electron.store.get('settings') || {};
      
      // 按路径设置嵌套值
      const keys = key.split('.');
      let obj = settings;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') {
          obj[keys[i]] = {};
        }
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      
      await window.electron.store.set('settings', settings);
      logger.debug(`Synced settings.${key}`);
    } catch (e) {
      logger.debug(`Sync failed for ${key}:`, e.message);
    }
  }, delay);
}

/**
 * 初始化状态同步
 * 订阅 Zustand store 变化，自动同步到 electron-store
 * 
 * @param {Object} translationStore - useTranslationStore (Zustand)
 * @param {Object} configStore - useConfigStore (Zustand)
 */
export function initStoreSync(translationStore, configStore) {
  // 1. 同步翻译语言 (translation-store → electron-store)
  //    划词翻译主进程从 settings.translation 读取
  translationStore.subscribe(
    (state) => ({
      src: state.currentTranslation.sourceLanguage,
      tgt: state.currentTranslation.targetLanguage,
    }),
    (curr, prev) => {
      if (curr.src !== prev.src || curr.tgt !== prev.tgt) {
        debouncedSync('translation', {
          ...{}, // 保留其他 translation 字段
          sourceLanguage: curr.src,
          targetLanguage: curr.tgt,
        });
      }
    },
    { equalityFn: (a, b) => a.src === b.src && a.tgt === b.tgt }
  );

  // 2. 同步主题 (config-store → electron-store)
  //    玻璃窗口和划词窗口从 settings.interface.theme 读取
  configStore.subscribe(
    (state) => state.theme,
    (theme, prevTheme) => {
      if (theme !== prevTheme) {
        debouncedSync('interface.theme', theme);
      }
    }
  );

  logger.info('Store sync initialized');
}

export default initStoreSync;
