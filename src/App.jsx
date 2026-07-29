import { useEffect, useState } from 'react';
import TitleBar from './components/TitleBar';
import MainWindow from './components/MainWindow';
import useTranslationStore from './stores/translation-store';
import { initStoreSync } from './stores/sync-to-electron.js';
import { USER_FILTERS_KEY } from './config/filters.js';
import createLogger from './utils/logger.js';
import './styles/App.css';

import { THEMES } from '@config/defaults';

const logger = createLogger('App');

// Still load-bearing: floating-window.js GET_SETTINGS reads the live language
// pair from this global via executeJavaScript when the main window is around.
if (typeof window !== 'undefined') {
  window.__TRANSLATION_STORE__ = useTranslationStore;
}

// One-time wiring of Zustand -> electron-store (subscribes for the lifetime of the app)
initStoreSync(useTranslationStore);

// Retire localStorage keys orphaned by the v0.3.1 stack migration. The L2
// cache is droppable (rebuilt cold in the main process, D-2b); custom filter
// defs move to electron-store where the stack reads them (D-1b). All windows
// share one origin, so running this in the main window covers everything.
(async function retireLegacyLocalStorage() {
  try {
    const rawFilters = localStorage.getItem(USER_FILTERS_KEY);
    if (rawFilters) {
      const defs = JSON.parse(rawFilters);
      const existing = await window.electron?.store?.get?.('settings.translation.customFilters');
      if (Array.isArray(defs) && defs.length > 0 && !(Array.isArray(existing) && existing.length > 0)) {
        await window.electron?.store?.set?.('settings.translation.customFilters', defs);
        logger.info(`Migrated ${defs.length} custom filters to electron-store`);
      }
      localStorage.removeItem(USER_FILTERS_KEY);
    }
    localStorage.removeItem('translation-cache');
  } catch (e) {
    logger.warn('Legacy localStorage retirement failed:', e.message);
  }
})();

function App() {
  const [theme, setTheme] = useState(THEMES.LIGHT);
  const addToHistory = useTranslationStore((state) => state.addToHistory);
  const attachAiResult = useTranslationStore((state) => state.attachAiResult);
  const setOcrEngine = useTranslationStore((state) => state.setOcrEngine);

  useEffect(() => {
    // Theme source-of-truth precedence: settings store > localStorage. We
    // mirror the resolved value back to localStorage so a refresh paints
    // the correct theme before React mounts.
    const initTheme = async () => {
      let savedTheme = 'light';

      try {
        if (window.electron?.theme?.get) {
          const result = await window.electron.theme.get();
          if (result?.success && result.theme) {
            savedTheme = result.theme;
          }
        } else {
          savedTheme = localStorage.getItem('theme') || 'light';
        }
      } catch {
        savedTheme = localStorage.getItem('theme') || 'light';
      }

      localStorage.setItem('theme', savedTheme);
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    };

    initTheme();

    // Seed the OCR engine from electron-store (the single source of truth).
    // It's no longer persisted in the zustand key, so without this the main
    // window would reset to the default engine every launch and diverge from
    // what the floating window reads from settings.ocr.engine.
    (async () => {
      try {
        const engine = await window.electron?.store?.get?.('settings.ocr.engine');
        if (engine) setOcrEngine(engine);
      } catch { /* browser mode: default engine applies */ }
    })();

    let unsubscribeTheme = null;
    if (window.electron?.theme?.onChanged) {
      unsubscribeTheme = window.electron.theme.onChanged((newTheme) => {
        logger.debug('Theme changed via IPC:', newTheme);
        setTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
      });
    }

    // localStorage 'storage' events fire on *other* tabs/windows — used to
    // sync theme when the floating window changes it
    const handleStorageChange = (e) => {
      if (e.key === 'theme') {
        const newTheme = e.newValue || 'light';
        setTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // index.html shows a loading splash until __APP_LOADED__ flips
    const timer = setTimeout(() => {
      if (window) {
        window.__APP_LOADED__ = true;
        window.dispatchEvent(new Event('app-ready'));
      }
    }, 500);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      if (unsubscribeTheme) unsubscribeTheme();
      clearTimeout(timer);
    };
  }, []);

  // Screenshot capture is handled by MainWindow's own onCaptured listener
  // (screenshotData prop -> TranslationPanel) — no second subscription here.

  // Selection translate and floating window route history adds through this listener
  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;

    const handleAddToHistory = (event, item) => {
      logger.debug('Received add-to-history from:', item?.from || item?.source);
      if (item && addToHistory) {
        addToHistory({
          id: item.id || `${item.from || 'unknown'}-${Date.now()}`,
          sourceText: item.sourceText || item.source || '',
          translatedText: item.translatedText || item.result || '',
          sourceLanguage: item.sourceLanguage || 'auto',
          targetLanguage: item.targetLanguage || 'en',
          timestamp: item.timestamp || Date.now(),
          source: item.from || item.source || 'unknown',
        });
      }
    };

    // AI results from those windows ride on an existing entry rather than
    // making one; the store owns the matching and the secure-mode gate.
    const handleAttachAiResult = (event, payload) => {
      if (payload) attachAiResult(payload);
    };

    window.electron.ipcRenderer.on('add-to-history', handleAddToHistory);
    window.electron.ipcRenderer.on('attach-ai-result', handleAttachAiResult);

    return () => {
      window.electron.ipcRenderer.removeListener('add-to-history', handleAddToHistory);
      window.electron.ipcRenderer.removeListener('attach-ai-result', handleAttachAiResult);
    };
  }, [addToHistory, attachAiResult]);

  // Render-phase errors are ErrorBoundary's job (src/main.jsx wraps <App/>);
  // the old try/catch here broke hook ordering rules and, on a mount throw,
  // rendered a fallback without TitleBar — no drag region in a frameless window.
  return (
    <div className={`app ${theme} no-titlebar`}>
      <TitleBar />
      <MainWindow />
    </div>
  );
}

export default App;
