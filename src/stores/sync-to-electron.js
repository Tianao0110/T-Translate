// Bridges Zustand store changes to the main process for the other windows:
// settings.translation.sourceLanguage / targetLanguage through electron-store,
// the glossary through stack:set-glossary.
// The store must be created with subscribeWithSelector. Wired once from
// App.jsx via initStoreSync().

import createLogger from '../core/logger.js';
import { glossaryItemsOf } from './translation-store.js';

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

// The glossary goes to the main-process stack (memory only), which applies it
// to the windows that do not own the favorites: selection, floating, captions.
let _glossaryTimer = null;
function pushGlossary(favorites, delay = 300) {
  clearTimeout(_glossaryTimer);
  _glossaryTimer = setTimeout(async () => {
    try {
      if (!window.electron?.stack?.setGlossary) return;
      const items = glossaryItemsOf(favorites);
      await window.electron.stack.setGlossary(items);
      logger.debug(`Glossary pushed: ${items.length} terms`);
    } catch (e) {
      logger.debug('Glossary push failed:', e.message);
    }
  }, delay);
}

export function initStoreSync(translationStore) {
  // Startup reconcile: push the current values once.
  const initial = translationStore.getState().currentTranslation;
  debouncedSync('translation.sourceLanguage', initial.sourceLanguage);
  debouncedSync('translation.targetLanguage', initial.targetLanguage);

  // Favorites hydrate from the vault after this runs; the subscription
  // carries that first real value too.
  pushGlossary(translationStore.getState().favorites);
  translationStore.subscribe(
    (state) => state.favorites,
    (favorites) => pushGlossary(favorites)
  );

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
