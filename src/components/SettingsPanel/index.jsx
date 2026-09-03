import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Save } from 'lucide-react';
import stackClient from '../../services/stack-client.js';
import { getAllProviderMetadata } from '../../config/provider-icons.js';
import { persistProviderData } from '../ProviderSettings/persist.js';
import { migrateLegacyOcrSecrets, decryptOcrSecrets, encryptOcrSecrets } from '../../utils/ocr-key-vault.js';
import { useConfirm } from '../shared/ConfirmDialog';
import { useShallow } from 'zustand/react/shallow';
import useTranslationStore from '../../stores/translation-store';
import i18n from '../../i18n.js';
import createLogger from '../../utils/logger.js';
import './styles.css';

import {
  NAV_ITEMS,
  DEFAULT_SETTINGS,
  migrateOldSettings
} from './constants.js';

import {
  OcrSection,
  InterfaceSection,
  FloatingWindowSection,
  SelectionSection,
  PrivacySection,
  DocumentSection,
  TTSSection,
  ListenSection,
  AboutSection,
  ProvidersSection,
  TranslationSection,
  AiActionsSection
} from './sections/index.jsx';

const logger = createLogger('Settings');

const SettingsPanel = ({ showNotification, initialSection, onSectionConsumed }) => {
  const { t } = useTranslation();

  const notify = showNotification || ((msg, type) => logger.debug(`[${type}] ${msg}`));
  // One dialog instance at panel level, handed down to sections as a prop —
  // five separate overlays would be pointless.
  const [confirm, confirmDialog] = useConfirm();

  const navLabels = {
    providers: t('settingsNav.providers'),
    translation: t('settingsNav.translation'),
    selection: t('settingsNav.selection'),
    floatingWindow: t('settingsNav.floatingWindow'),
    document: t('settingsNav.document'),
    aiActions: t('settingsNav.aiActions'),
    ocr: t('settingsNav.ocr'),
    tts: t('settingsNav.tts'),
    listen: t('settingsNav.listen'),
    interface: t('settingsNav.interface'),
    privacy: t('settingsNav.privacy'),
    about: t('settingsNav.about'),
  };

  const groupLabels = {
    'translation': t('settingsNav.groupTranslation'),
    'system': t('settingsNav.groupSystem'),
  };

  // useShallow: settings stay mounted behind other tabs — without a selector
  // every streaming flush would re-render this whole panel
  const {
    setOcrEngine,
    useStreamOutput,
    setUseStreamOutput,
    autoTranslate,
    setAutoTranslate,
    autoTranslateDelay,
    setAutoTranslateDelay
  } = useTranslationStore(useShallow((s) => ({
    setOcrEngine: s.setOcrEngine,
    useStreamOutput: s.useStreamOutput,
    setUseStreamOutput: s.setUseStreamOutput,
    autoTranslate: s.autoTranslate,
    setAutoTranslate: s.setAutoTranslate,
    autoTranslateDelay: s.autoTranslateDelay,
    setAutoTranslateDelay: s.setAutoTranslateDelay,
  })));

  const allProvidersMeta = useMemo(() => getAllProviderMetadata(), []);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  // Which buckets have unsaved edits. save() only writes dirty buckets so it
  // never re-persists an untouched bucket from a stale in-memory snapshot —
  // critical for the translation bucket, whose configs are decrypted lazily.
  const dirtyBucketsRef = useRef(new Set());
  const isInitializingRef = useRef(true);

  const [activeSection, setActiveSection] = useState('providers');
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [editingShortcut, setEditingShortcut] = useState(null);
  const [simpleMode, setSimpleMode] = useState(() => {
    const saved = localStorage.getItem('settings-simple-mode');
    return saved === null ? true : saved === 'true';
  });
  // One-time hint that the simple/full catalog toggle exists
  const [showModeHint, setShowModeHint] = useState(() =>
    localStorage.getItem('settings-mode-hint-seen') !== 'true'
  );

  const dismissModeHint = useCallback(() => {
    localStorage.setItem('settings-mode-hint-seen', 'true');
    setShowModeHint(false);
  }, []);

  const hasUnsavedChanges = isDirty;

  // No beforeunload guard: Electron intercepts the window close as a hide and
  // destroys on quit without dispatching beforeunload, so it never protected
  // anything — and returning a string silently *cancelled* the menu Reload.
  // The footer "unsaved changes" indicator is the honest signal instead.

  const handleSectionChange = useCallback((section) => {
    if (section !== activeSection) {
      setActiveSection(section);
      setSearchQuery('');
    }
  }, [activeSection]);

  // External section jump (e.g. floating window "Go to OCR Settings" button)
  useEffect(() => {
    if (initialSection && initialSection !== activeSection) {
      setActiveSection(initialSection);
      setSearchQuery('');
    }
    if (initialSection) {
      onSectionConsumed?.();
    }
  }, [initialSection]);

  const toggleGroup = useCallback((groupId) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  }, []);

  const toggleSimpleMode = useCallback(() => {
    dismissModeHint();
    setSimpleMode(prev => {
      const next = !prev;
      localStorage.setItem('settings-simple-mode', String(next));
      if (next) {
        const basicIds = NAV_ITEMS.filter(i => i.basic).map(i => i.id);
        if (!basicIds.includes(activeSection)) {
          setActiveSection(basicIds[0] || 'providers');
        }
      }
      return next;
    });
  }, [activeSection, dismissModeHint]);

  const { filteredNavItems, groupedNavItems } = useMemo(() => {
    let items = searchQuery.trim()
      ? NAV_ITEMS.filter(item => {
          const query = searchQuery.toLowerCase();
          const translatedLabel = (navLabels[item.id] || item.id).toLowerCase();
          return translatedLabel.includes(query) ||
                 item.keywords.some(k => k.toLowerCase().includes(query));
        })
      : simpleMode
        ? NAV_ITEMS.filter(item => item.basic)
        : NAV_ITEMS;

    const grouped = items.reduce((acc, item) => {
      if (!acc[item.group]) acc[item.group] = [];
      acc[item.group].push(item);
      return acc;
    }, {});

    return { filteredNavItems: items, groupedNavItems: grouped };
  }, [searchQuery, simpleMode, navLabels]);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const handleSelectionStateChange = (enabled) => {
      logger.debug(' Selection state changed from main process:', enabled);
      setSettings(prev => ({
        ...prev,
        selection: { ...prev.selection, enabled }
      }));
    };

    let cleanup = null;
    if (window.electron?.ipc?.on) {
      cleanup = window.electron.ipc.on('selection-state-changed', handleSelectionStateChange);
    }

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const loadSettings = async () => {
    try {
      const runtimeState = await detectRuntimeState();

      let savedSettings = null;
      if (window.electron?.store) {
        // Move any pre-vault plaintext OCR keys into safeStorage first so the
        // bucket we read below is already sanitized.
        await migrateLegacyOcrSecrets();
        savedSettings = await window.electron.store.get('settings');
      } else {
        const stored = localStorage.getItem('settings');
        savedSettings = stored ? JSON.parse(stored) : null;
      }

      // migrateOldSettings already deep-merges with DEFAULT_SETTINGS.
      const migratedSettings = migrateOldSettings(savedSettings);

      let finalSettings;
      if (migratedSettings) {
        finalSettings = {
          ...migratedSettings,
          // Runtime state (platform / OCR availability / selection toggle)
          // always wins over persisted values.
          ocr: {
            ...migratedSettings.ocr,
            ...runtimeState.ocr,
          },
          selection: {
            ...migratedSettings.selection,
            enabled: runtimeState.selectionEnabled,
          },
        };

        if (migratedSettings.ocr?.engine && setOcrEngine) {
          setOcrEngine(migratedSettings.ocr.engine);
        }
      } else {
        finalSettings = {
          ...DEFAULT_SETTINGS,
          ocr: { ...DEFAULT_SETTINGS.ocr, ...runtimeState.ocr },
          selection: { ...DEFAULT_SETTINGS.selection, enabled: runtimeState.selectionEnabled }
        };
      }

      // Fill vaulted OCR keys into UI state so the inputs display them and
      // the next save round-trips through encryptOcrSecrets.
      finalSettings.ocr = await decryptOcrSecrets(finalSettings.ocr, 'settings-load');

      setSettings(finalSettings);
      setSettingsReady(true);
      setIsDirty(false);
      dirtyBucketsRef.current = new Set();

      // Delay clearing the initializing flag — child components (notably
      // ProviderSettings) need ~100ms plus async decrypt before they're
      // settled, and we don't want their init writes to mark us dirty.
      setTimeout(() => {
        isInitializingRef.current = false;
      }, 500);
    } catch (error) {
      logger.error('Failed to load settings:', error);
    }
  };

  const detectRuntimeState = async () => {
    const state = {
      ocr: { isWindows: false, rapidInstalled: false },
      selectionEnabled: false
    };

    try {
      if (window.electron?.app?.getPlatform) {
        const platform = await window.electron.app.getPlatform();
        state.ocr.isWindows = platform === 'win32';
      } else if (window.nodeAPI?.process?.platform) {
        state.ocr.isWindows = window.nodeAPI.process.platform === 'win32';
      } else if (typeof navigator !== 'undefined') {
        state.ocr.isWindows = navigator.platform?.toLowerCase().includes('win') ||
                              navigator.userAgent?.toLowerCase().includes('windows');
      }
    } catch (e) {
      logger.debug('Platform detection failed:', e);
    }

    try {
      if (window.electron?.ocr?.checkInstalled) {
        const installedStatus = await window.electron.ocr.checkInstalled();
        state.ocr.rapidInstalled = installedStatus?.['rapid-ocr'] || false;
      }
    } catch (e) {
      logger.debug('OCR install check failed:', e);
    }

    try {
      if (window.electron?.selection?.getEnabled) {
        const enabled = await window.electron.selection.getEnabled();
        state.selectionEnabled = enabled === true;
        logger.debug(' Selection translate state from main process:', state.selectionEnabled);
      } else {
        logger.debug(' selection.getEnabled not available');
      }
    } catch (e) {
      logger.error(' Selection state check failed:', e);
    }

    return state;
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      const dirty = dirtyBucketsRef.current;

      // Dot-path writes per-section so concurrent updaters touching
      // sibling fields don't clobber each other (read-modify-write race).
      if (window.electron?.store) {
        const store = window.electron.store;

        // Provider data is persisted from the parent's mirror (ProviderSettings
        // mirrors decrypted configs up on init), so a save from ANY tab keeps
        // provider edits instead of the old activeSection-routed path that
        // dropped them. Only when actually edited — an untouched translation
        // bucket would otherwise strip keys it never received.
        if (dirty.has('translation')) {
          const { ok } = await persistProviderData({
            providers: settings.translation?.providers || [],
            providerConfigs: settings.translation?.providerConfigs || {},
            allProvidersMeta,
          });
          if (!ok) {
            // Keep the panel dirty so the user can retry after fixing encryption.
            notify(t('providerSettings.encryptFailed'), 'error');
            return;
          }
        }

        // settings.translation providers/configs are written above; language
        // keys are owned by the sync-to-electron store mirror. Writing a
        // load-time snapshot of the whole bucket here would clobber both.

        if (settings.document) {
          await store.set('settings.document', settings.document);
        }

        if (settings.floatingWindow) {
          await store.set('settings.floatingWindow', settings.floatingWindow);
          // Saving the default opacity means the user is setting it explicitly,
          // so drop the window-local override that would otherwise permanently
          // shadow it (GET_SETTINGS prefers floatingWindowLocal.opacity).
          if (dirty.has('floatingWindow')) {
            await store.delete('floatingWindowLocal.opacity');
          }
        }

        if (settings.aiActions) {
          await store.set('settings.aiActions', settings.aiActions);
        }

        if (settings.selection) {
          await store.set('settings.selection', settings.selection);
        }

        if (settings.shortcuts) {
          await store.set('settings.shortcuts', settings.shortcuts);
        }

        if (settings.ocr) {
          // Strip runtime-only fields before persisting.
          const { isWindows: _w, paddleInstalled: _p, rapidInstalled: _r, ...ocrToSave } = settings.ocr;
          // API keys go to safeStorage, never into the plaintext bucket. On
          // encrypt failure the key is dropped from disk (not saved) — say so.
          const { sanitized, failed } = await encryptOcrSecrets(ocrToSave);
          await store.set('settings.ocr', sanitized);
          if (failed.length > 0) {
            notify(t('settings.ocrKeysEncryptFailed'), 'error');
          }
        }

        if (settings.tts) {
          await store.set('settings.tts', settings.tts);
        }

        if (settings.screenshot) {
          await store.set('settings.screenshot', settings.screenshot);
        }

        const currentTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light';
        await store.set('settings.interface', {
          ...settings.interface,
          theme: currentTheme,
        });

        if (settings.privacy) {
          await store.set('settings.privacy', settings.privacy);
        }
      } else {
        localStorage.setItem('settings', JSON.stringify(settings));
      }

      if (setOcrEngine && settings.ocr?.engine) {
        setOcrEngine(settings.ocr.engine);
      }

      if (settings.ocr) {
        try {
          // OCR engine configs live in the main-process stack — one reload
          // re-reads the saved bucket + vault there. (Translation-bucket saves
          // already reload via persistProviderData; a second reload here when
          // both buckets are dirty is idempotent and cheap.)
          await stackClient.reload();
          logger.debug(' OCR configs reloaded (main-process stack)');
        } catch (e) {
          logger.warn(' stack reload failed:', e);
        }
      }

      if (window.electron?.floatingWindow?.notifySettingsChanged) {
        await window.electron.floatingWindow.notifySettingsChanged();
      }

      notify(t('settings.saved'), 'success');

      setIsDirty(false);
      dirtyBucketsRef.current = new Set();
    } catch (error) {
      logger.error('Failed to save settings:', error);
      notify(t('settings.saveFailed'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const resetSettings = async (section = null) => {
    const ok = await confirm(section ? t('settings.resetSectionConfirm', { section }) : t('settings.resetAllConfirm'));
    if (!ok) return;

    if (section) {
      if (DEFAULT_SETTINGS[section]) {
        setSettings(prev => ({
          ...prev,
          [section]: { ...DEFAULT_SETTINGS[section] }
        }));
        notify(t('settings.sectionReset', { section }), 'success');
      } else {
        notify(t('settings.sectionNotFound', { section }), 'error');
      }
    } else {
      // Full reset must clear every side-band store, not just electron-store —
      // theme, language, sidebar prefs, zustand preferences and OS auto-launch
      // all live outside the 'settings' key and would otherwise survive.
      localStorage.removeItem('settings');
      localStorage.removeItem('theme');
      localStorage.removeItem('app-language');
      localStorage.removeItem('settings-simple-mode');
      localStorage.removeItem('settings-mode-hint-seen');
      if (window.electron?.store) {
        window.electron.store.delete('settings');
        // Onboarding flags are side-band state too: a reset that left them set
        // would hand the user a "factory fresh" app that never greets them.
        window.electron.store.delete('onboarding');
      }

      // zustand-persisted preference fields (share a store with history/
      // favorites, so reset by field, don't wipe the key).
      useTranslationStore.getState().resetPreferences?.();

      // Reset the live theme + language the user is looking at right now.
      document.documentElement.setAttribute('data-theme', 'light');
      try {
        await window.electron?.theme?.set?.('light');
        await i18n.changeLanguage('zh');
      } catch { /* best effort */ }

      // Auto-launch is a settings control too (D13).
      try { await window.electron?.app?.setAutoLaunch?.(false); } catch { /* ignore */ }

      // API keys are deliberately kept (confirm dialog says so) — clearing them
      // would force the user to re-obtain keys; "clear all data" on the privacy
      // page is the escape hatch for a full wipe.

      // Rebuild from a fresh load so runtime-derived state (OCR availability,
      // selection toggle) is re-detected instead of a bare defaults snapshot
      // that leaves the OCR panel and selection toggle showing stale values.
      await loadSettings();
      notify(t('settings.allReset'), 'success');
    }
  };

  // silent=true skips the dirty flag (used when child components emit
  // their own initial sync writes).
  const updateSetting = useCallback((section, key, value, silent = false) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
    if (!silent && !isInitializingRef.current) {
      dirtyBucketsRef.current.add(section);
      setIsDirty(true);
    }
  }, []);

  const renderSettingContent = () => {
    switch (activeSection) {
      case 'providers':
        return (
          <ProvidersSection
            settings={settings}
            settingsReady={settingsReady}
            updateSetting={updateSetting}
            notify={notify}
          />
        );

        case 'document':
          return (
            <DocumentSection
              settings={settings}
              updateSetting={updateSetting}
            />
          );
        case 'privacy':
          return (
            <PrivacySection
              settings={settings}
              updateSetting={updateSetting}
              notify={notify}
              confirm={confirm}
              reloadSettings={loadSettings}
            />
          );
      case 'ocr':
        return (
          <OcrSection
            settings={settings}
            updateSetting={updateSetting}
            notify={notify}
            confirm={confirm}
            collapsedGroups={collapsedGroups}
            toggleGroup={toggleGroup}
            showApiKeys={showApiKeys}
            setShowApiKeys={setShowApiKeys}
            setOcrEngine={setOcrEngine}
          />
        );
      case 'tts':
        return (
          <TTSSection
            settings={settings}
            updateSetting={updateSetting}
            notify={notify}
            confirm={confirm}
          />
        );
      case 'listen':
        return (
          <ListenSection
            notify={notify}
            confirm={confirm}
          />
        );
      case 'interface':
        return (
          <InterfaceSection
            settings={settings}
            updateSetting={updateSetting}
            setSettings={setSettings}
            notify={notify}
            editingShortcut={editingShortcut}
            setEditingShortcut={setEditingShortcut}
          />
        );
      case 'about':
        return (
          <AboutSection notify={notify} resetSettings={resetSettings} />
        );

      case 'translation':
        return (
          <TranslationSection
            settings={settings}
            updateSetting={updateSetting}
            notify={notify}
            confirm={confirm}
            useStreamOutput={useStreamOutput}
            setUseStreamOutput={setUseStreamOutput}
            autoTranslate={autoTranslate}
            setAutoTranslate={setAutoTranslate}
            autoTranslateDelay={autoTranslateDelay}
            setAutoTranslateDelay={setAutoTranslateDelay}
          />
        );
      case 'floatingWindow':
        return (
          <FloatingWindowSection
            settings={settings}
            updateSetting={updateSetting}
            handleSectionChange={handleSectionChange}
          />
        );
      case 'selection':
        return (
          <SelectionSection
            settings={settings}
            updateSetting={updateSetting}
            notify={notify}
          />
        );
      case 'aiActions':
        return (
          <AiActionsSection
            settings={settings}
            updateSetting={updateSetting}
            notify={notify}
            confirm={confirm}
          />
        );
      default: return null;
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-sidebar">
        <div className="settings-search">
          <input
            type="text"
            placeholder={t('settingsNav.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>


        <div className="settings-nav">
          {Object.entries(groupedNavItems).map(([group, items], groupIndex) => {
            if (items.length === 0) return null;
            return (
            <React.Fragment key={group}>
              {groupIndex > 0 && <div className="nav-divider" />}
              <div className="nav-group-title">{groupLabels[group] || group}</div>
              {items.map(item => {
                const Icon = item.icon;
                const isSearchMatch = searchQuery.trim() && (
                  (navLabels[item.id] || item.id).toLowerCase().includes(searchQuery.toLowerCase()) ||
                  item.keywords.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
                );
                return (
                  <button
                    key={item.id}
                    className={`nav-item ${activeSection === item.id ? 'active' : ''} ${isSearchMatch ? 'search-match' : ''}`}
                    onClick={() => handleSectionChange(item.id)}
                  >
                    <Icon size={16}/>
                    <span>{navLabels[item.id] || item.id}</span>
                  </button>
                );
              })}
            </React.Fragment>
            );
          })}

          {filteredNavItems.length === 0 && (
            <div className="nav-empty">
              <p>{t('settingsNav.noMatch')}</p>
            </div>
          )}
        </div>
        <div className="settings-actions">
            {showModeHint && simpleMode && (
              <div className="mode-hint" role="note">
                {t('settingsNav.modeHint')}
                <button className="mode-hint-dismiss" onClick={dismissModeHint}>
                  {t('settingsNav.modeHintGotIt')}
                </button>
              </div>
            )}
            <span className="mode-text-link" onClick={toggleSimpleMode}>
              {simpleMode ? t('settingsNav.simpleMode') : t('settingsNav.fullMode')}
            </span>
        </div>
      </div>

      <div className="settings-content-wrapper">
        <div key={activeSection} className="setting-content-animated">
          {renderSettingContent()}
        </div>
        {hasUnsavedChanges && (
          <div className="settings-footer">
            <div className="unsaved-indicator">
              {t('settingsNav.unsavedChanges')}
            </div>
            <button className="save-button" onClick={saveSettings} disabled={isSaving}>
                {isSaving ? <RefreshCw className="animate-spin" size={16}/> : <Save size={16}/>}
                {isSaving ? ` ${t('settingsNav.saving')}` : ` ${t('settingsNav.saveChanges')}`}
            </button>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
};

export default SettingsPanel;
