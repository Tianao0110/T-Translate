import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Globe, Shield, Zap, Download, Upload, Moon, Sun,
  Info, CheckCircle, Wifi, RefreshCw, AlertCircle,
  Save, Trash2, Eye, EyeOff, Lock, GitBranch,
  Code2, Palette, Layers, MousePointer, Server,
  FileText, Filter
} from 'lucide-react';
import translationService from '../../services/translation.js';
import { ocrManager } from '../../providers/ocr/index.js';
import { useShallow } from 'zustand/react/shallow';
import useTranslationStore from '../../stores/translation-store';
import ProviderSettings from '../ProviderSettings';
import createLogger from '../../utils/logger.js';
import './styles.css';

import {
  defaultConfig,
  PRIVACY_MODES,
  PRIVACY_MODE_IDS,
  getModeFeatures,
  isFeatureEnabled,
  isProviderAllowed,
  SHORTCUT_LABELS,
  GLOBAL_SHORTCUT_KEYS,
  NAV_ITEMS,
  DEFAULT_SETTINGS,
  LANGUAGE_OPTIONS,
  migrateOldSettings
} from './constants.js';

import {
  OcrSection,
  InterfaceSection,
  GlassWindowSection,
  SelectionSection,
  PrivacySection,
  DocumentSection,
  TTSSection,
  AboutSection,
  ProvidersSection,
  TranslationSection
} from './sections/index.jsx';

const logger = createLogger('Settings');

const SettingsPanel = ({ showNotification, initialSection, onSectionConsumed }) => {
  const { t } = useTranslation();

  const notify = showNotification || ((msg, type) => logger.debug(`[${type}] ${msg}`));

  const navLabels = {
    providers: t('settingsNav.providers'),
    translation: t('settingsNav.translation'),
    selection: t('settingsNav.selection'),
    glassWindow: t('settingsNav.glassWindow'),
    document: t('settingsNav.document'),
    ocr: t('settingsNav.ocr'),
    tts: t('settingsNav.tts'),
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

  const providerSettingsRef = useRef(null);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const isInitializingRef = useRef(true);

  const [activeSection, setActiveSection] = useState('providers');
  const [connectionStatus, setConnectionStatus] = useState('unknown');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [models, setModels] = useState([]);
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

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleSectionChange = useCallback((section) => {
    if (section !== activeSection) {
      setActiveSection(section);
      setSearchQuery('');
    }
  }, [activeSection]);

  // External section jump (e.g. glass "Go to OCR Settings" button)
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

      setSettings(finalSettings);
      setSettingsReady(true);
      setIsDirty(false);

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
      // ProviderSettings.save() is self-contained — let it run and bail.
      if (activeSection === 'providers' && providerSettingsRef.current?.save) {
        await providerSettingsRef.current.save();
        setIsDirty(false);
        setIsSaving(false);
        return;
      }

      // Dot-path writes per-section so concurrent updaters touching
      // sibling fields don't clobber each other (read-modify-write race).
      if (window.electron?.store) {
        const store = window.electron.store;

        if (settings.connection) {
          await store.set('settings.connection', settings.connection);
        }

        if (settings.translation) {
          // Skip providers/providerConfigs — owned by ProviderSettings.
          const { providers, providerConfigs, ...translationRest } = settings.translation;
          for (const [key, value] of Object.entries(translationRest)) {
            await store.set(`settings.translation.${key}`, value);
          }
        }

        if (settings.document) {
          await store.set('settings.document', settings.document);
        }

        if (settings.glass) {
          await store.set('settings.glass', settings.glass);
        }

        if (settings.selection) {
          await store.set('settings.selection', settings.selection);
        }

        if (settings.shortcuts) {
          await store.set('settings.shortcuts', settings.shortcuts);
        }

        if (settings.ocr) {
          // Strip runtime-only fields before persisting.
          const { isWindows, paddleInstalled, rapidInstalled, ...ocrToSave } = settings.ocr;
          await store.set('settings.ocr', ocrToSave);
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

        await store.set('settings.sourceLanguage', settings.sourceLanguage);
        await store.set('settings.targetLanguage', settings.targetLanguage);
        await store.set('settings.autoTranslate', settings.autoTranslate);
        await store.set('settings.streamOutput', settings.streamOutput);
        await store.set('settings.contextMemory', settings.contextMemory);
        await store.set('settings.termCorrection', settings.termCorrection);
        await store.set('settings.privacyMode', settings.privacyMode);
        await store.set('settings.saveHistory', settings.saveHistory);
        await store.set('settings.maxHistory', settings.maxHistory);
        await store.set('settings.cacheEnabled', settings.cacheEnabled);
        await store.set('settings.maxCache', settings.maxCache);
        await store.set('settings.theme', settings.theme);
        await store.set('settings.fontSize', settings.fontSize);
        await store.set('settings.debugMode', settings.debugMode);
      } else {
        localStorage.setItem('settings', JSON.stringify(settings));
      }

      if (setOcrEngine && settings.ocr?.engine) {
        setOcrEngine(settings.ocr.engine);
      }

      if (settings.ocr) {
        try {
          ocrManager.updateConfigs(settings.ocr);
          logger.debug(' OCR configs updated');
        } catch (e) {
          logger.warn(' ocrManager update failed:', e);
        }
      }

      if (window.electron?.glass?.notifySettingsChanged) {
        await window.electron.glass.notifySettingsChanged();
      }

      // The providers tab fires its own notification, so suppress here.
      if (activeSection !== 'providers') {
        notify(t('settings.saved'), 'success');
      }

      setIsDirty(false);
    } catch (error) {
      logger.error('Failed to save settings:', error);
      notify(t('settings.saveFailed'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    setIsTesting(true);
    setConnectionStatus('testing');

    try {
      const currentEndpoint = settings.connection.endpoint;

      const result = await translationService.testConnection(currentEndpoint);
      if (result.success) {
        setConnectionStatus('connected');
        setModels(result.models || []);
        notify(t('connectionSettings.connectionSuccess', { count: result.models?.length || 0 }), 'success');
      } else {
        setConnectionStatus('disconnected');
        notify(t('connectionSettings.connectionFailed') + ': ' + (result.error || result.message || t('notify.unknownError')), 'error');
      }
    } catch (error) {
      setConnectionStatus('error');
      notify(t('connectionSettings.connectionError') + ': ' + error.message, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const resetSettings = (section = null) => {
    if (!window.confirm(section ? t('settings.resetSectionConfirm', { section }) : t('settings.resetAllConfirm'))) return;

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
      localStorage.removeItem('settings');
      if (window.electron?.store) {
        window.electron.store.delete('settings');
      }
      setSettings({ ...DEFAULT_SETTINGS });
      notify(t('settings.allReset'), 'success');
    }
  };

  const exportSettings = () => {
    const exportData = {
      _version: '1.0',
      _exportedAt: new Date().toISOString(),
      ...settings
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `t-translate-settings_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(t('settings.exported'), 'success');
  };

  const importSettings = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);

        const { _version, _exportedAt, ...settingsData } = imported;

        const requiredSections = ['connection', 'translation', 'ocr', 'interface'];
        const hasRequiredSections = requiredSections.some(s => settingsData[s]);

        if (!hasRequiredSections) {
          notify(t('settings.invalidFormat'), 'error');
          return;
        }

        setSettings(prev => {
          const merged = { ...prev };
          Object.keys(settingsData).forEach(key => {
            if (typeof settingsData[key] === 'object' && settingsData[key] !== null) {
              merged[key] = { ...prev[key], ...settingsData[key] };
            } else {
              merged[key] = settingsData[key];
            }
          });
          return merged;
        });

        notify(t('settings.importedPleasesSave'), 'success');
      } catch (error) {
        logger.error('Import settings error:', error);
        notify(t('settings.invalidFile'), 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = null;
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
      setIsDirty(true);
    }
  }, []);

  const renderSettingContent = () => {
    switch (activeSection) {
      case 'providers':
        return (
          <ProvidersSection
            ref={providerSettingsRef}
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
            />
          );
      case 'ocr':
        return (
          <OcrSection
            settings={settings}
            updateSetting={updateSetting}
            notify={notify}
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
            useStreamOutput={useStreamOutput}
            setUseStreamOutput={setUseStreamOutput}
            autoTranslate={autoTranslate}
            setAutoTranslate={setAutoTranslate}
            autoTranslateDelay={autoTranslateDelay}
            setAutoTranslateDelay={setAutoTranslateDelay}
          />
        );
      case 'glassWindow':
        return (
          <GlassWindowSection
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
    </div>
  );
};

export default SettingsPanel;
