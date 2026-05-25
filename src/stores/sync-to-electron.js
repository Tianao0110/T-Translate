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

/** 防抖写入 electron-store（使用点路径直接写入，无竞态） */
const _syncTimers = {};
function debouncedSync(dotPath, value, delay = 100) {
  clearTimeout(_syncTimers[dotPath]);
  _syncTimers[dotPath] = setTimeout(async () => {
    try {
      if (!window.electron?.store?.set) return;
      await window.electron.store.set(`settings.${dotPath}`, value);
      logger.debug(`Synced settings.${dotPath}`);
      // Notify glass so it can reload target lang / theme without restart.
      // Separate debounce to merge bursts (e.g. user toggles src+tgt back-to-back).
      debouncedNotifyGlass();
    } catch (e) {
      logger.debug(`Sync failed for ${dotPath}:`, e.message);
    }
  }, delay);
}

let _glassNotifyTimer = null;
function debouncedNotifyGlass(delay = 50) {
  clearTimeout(_glassNotifyTimer);
  _glassNotifyTimer = setTimeout(async () => {
    try {
      if (!window.electron?.glass?.notifySettingsChanged) return;
      await window.electron.glass.notifySettingsChanged();
      logger.debug('Notified glass of settings change');
    } catch (e) {
      logger.debug('Glass notify failed:', e.message);
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
        // 分别写入语言字段，避免覆盖 translation.providers 等其他字段
        debouncedSync('translation.sourceLanguage', curr.src);
        debouncedSync('translation.targetLanguage', curr.tgt);
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
