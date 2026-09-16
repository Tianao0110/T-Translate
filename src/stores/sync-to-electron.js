// Bridges Zustand store changes to electron-store for the other windows.
// Single sync point for settings.translation.sourceLanguage / targetLanguage.
// The store must be created with subscribeWithSelector. Wired once from
// App.jsx via initStoreSync().

import createLogger from '../core/logger.js';

const logger = createLogger('StoreSync');

const _syncTimers = {};
const _pendingWrites = {};
function debouncedSync(dotPath, value, delay = 100) {
  _pendingWrites[dotPath] = value;
  clearTimeout(_syncTimers[dotPath]);
  _syncTimers[dotPath] = setTimeout(() => flushSync(dotPath), delay);
}

async function flushSync(dotPath) {
  clearTimeout(_syncTimers[dotPath]);
  if (!(dotPath in _pendingWrites)) return;
  const value = _pendingWrites[dotPath];
  delete _pendingWrites[dotPath];
  try {
    if (!window.electron?.store?.set) return;
    await window.electron.store.set(`settings.${dotPath}`, value);
    logger.debug(`Synced settings.${dotPath}`);
    // Notify the floating window (separate debounce to merge bursts).
    debouncedNotifyFloatingWindow();
  } catch (e) {
    logger.debug(`Sync failed for ${dotPath}:`, e.message);
  }
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
  // Startup reconcile: push the current values once.
  const initial = translationStore.getState().currentTranslation;
  debouncedSync('translation.sourceLanguage', initial.sourceLanguage);
  debouncedSync('translation.targetLanguage', initial.targetLanguage);

  translationStore.subscribe(
    (state) => ({
      src: state.currentTranslation.sourceLanguage,
      tgt: state.currentTranslation.targetLanguage,
    }),
    (curr, prev) => {
      if (curr.src !== prev.src || curr.tgt !== prev.tgt) {
        // Each language field separately (sibling fields stay untouched).
        debouncedSync('translation.sourceLanguage', curr.src);
        debouncedSync('translation.targetLanguage', curr.tgt);
      }
    },
    { equalityFn: (a, b) => a.src === b.src && a.tgt === b.tgt }
  );

  // Flush pending debounced writes before the page goes away.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      Object.keys(_pendingWrites).forEach(flushSync);
    });
  }

  logger.info('Store sync initialized');
}

export default initStoreSync;
