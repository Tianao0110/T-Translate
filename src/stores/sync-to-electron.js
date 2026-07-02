// Bridges Zustand store changes to electron-store so main-process windows
// (selection translator, floating window) can read settings via the same
// electron-store API without round-tripping JavaScript into a renderer.
//
// Single sync point for settings.translation.sourceLanguage / targetLanguage —
// covers setLanguages/swapLanguages/setTargetLanguage/restoreFromHistory alike.
// The store must be created with subscribeWithSelector or the selector-style
// subscribe below silently degrades to a no-op.
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
      // Notify floating window so it can reload target lang / theme without restart.
      // Separate debounce to merge bursts (e.g. user toggles src+tgt back-to-back).
      debouncedNotifyFloatingWindow();
    } catch (e) {
      logger.debug(`Sync failed for ${dotPath}:`, e.message);
    }
  }, delay);
}

let _fwNotifyTimer = null;
function debouncedNotifyFloatingWindow(delay = 50) {
  clearTimeout(_fwNotifyTimer);
  _fwNotifyTimer = setTimeout(async () => {
    try {
      if (!window.electron?.floatingWindow?.notifySettingsChanged) return;
      await window.electron.floatingWindow.notifySettingsChanged();
      logger.debug('Notified floating window of settings change');
    } catch (e) {
      logger.debug('Floating-window notify failed:', e.message);
    }
  }, delay);
}

export function initStoreSync(translationStore) {
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

  logger.info('Store sync initialized');
}

export default initStoreSync;
