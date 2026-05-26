// Bridges Zustand store changes to electron-store so main-process windows
// (selection translator, glass window) can read settings via the same
// electron-store API without round-tripping JavaScript into a renderer.
//
// Synced fields:
//   - settings.translation.sourceLanguage / targetLanguage (selection flow)
//   - settings.interface.theme (glass + selection windows)
//
// Wire it up once from App.jsx via initStoreSync().

import createLogger from '../utils/logger.js';

const logger = createLogger('StoreSync');

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

export function initStoreSync(translationStore, configStore) {
  translationStore.subscribe(
    (state) => ({
      src: state.currentTranslation.sourceLanguage,
      tgt: state.currentTranslation.targetLanguage,
    }),
    (curr, prev) => {
      if (curr.src !== prev.src || curr.tgt !== prev.tgt) {
        // Write each language field separately so we don't clobber
        // sibling fields like translation.providers.
        debouncedSync('translation.sourceLanguage', curr.src);
        debouncedSync('translation.targetLanguage', curr.tgt);
      }
    },
    { equalityFn: (a, b) => a.src === b.src && a.tgt === b.tgt }
  );

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
