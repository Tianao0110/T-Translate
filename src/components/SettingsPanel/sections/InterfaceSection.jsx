// Interface settings: startup, language, theme, keyboard shortcuts.

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Leaf, RefreshCw, Globe, Power, Keyboard, Camera, AppWindow, Layers, Pencil, ScanLine, Bell } from 'lucide-react';
import { defaultConfig } from '../constants.js';
import { Seg, Switch } from './shared';

const LANGUAGES = [
  { code: 'zh', name: '简体中文', nativeName: '简体中文' },
  { code: 'en', name: 'English', nativeName: 'English' }
];

const InterfaceSection = ({
  settings,
  updateSetting,
  setSettings,
  notify,
  editingShortcut,
  setEditingShortcut
}) => {
  const { t, i18n } = useTranslation();

  const [autoLaunch, setAutoLaunch] = useState(false);
  const [autoLaunchLoading, setAutoLaunchLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.electron?.app?.getAutoLaunch?.();
        if (result?.success) {
          setAutoLaunch(result.enabled);
        }
      } catch {}
      setAutoLaunchLoading(false);
    })();
  }, []);

  const toggleAutoLaunch = async (enabled) => {
    try {
      const result = await window.electron?.app?.setAutoLaunch?.(enabled);
      if (result?.success) {
        setAutoLaunch(enabled);
        notify(
          enabled ? t('settings.startup.autoLaunchEnabled') : t('settings.startup.autoLaunchDisabled'),
          'success'
        );
      } else {
        notify(result?.error || t('settings.startup.autoLaunchFailed'), 'error');
      }
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  // These three controls persist immediately via their own store/IPC writes,
  // so the React-state update is silent — otherwise the panel would show
  // "unsaved changes" (and block on beforeunload) for a change already saved.
  const toggleAutoSelection = (enabled) => {
    updateSetting('startup', 'autoEnableSelection', enabled, true);
    window.electron?.store?.set?.('settings.startup.autoEnableSelection', enabled);
  };

  const toggleSystemNotifications = (enabled) => {
    updateSetting('interface', 'systemNotifications', enabled, true);
    window.electron?.store?.set?.('settings.interface.systemNotifications', enabled);
  };

  // Write language using the dot-path API so we don't round-trip the whole settings object
  const switchLanguage = async (langCode) => {
    i18n.changeLanguage(langCode);
    updateSetting('interface', 'language', langCode, true);
    try {
      await window.electron?.store?.set('settings.interface.language', langCode);
    } catch (e) {
      console.warn('Failed to save language to store:', e);
    }
    notify(t('settings.general.langSwitched', langCode === 'zh' ? '界面语言已切换' : 'Language changed'), 'success');
  };

  // Theme propagation:
  //   1. local React state
  //   2. <html data-theme> for CSS variables
  //   3. localStorage so a refresh/screenshot window picks it up
  //   4. theme IPC broadcast so child windows re-theme without a full settings reload
  const switchTheme = async (theme) => {
    updateSetting('interface', 'theme', theme, true);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    try {
      if (window.electron?.theme?.set) {
        await window.electron.theme.set(theme);
      } else {
        // Fallback path for older preload bundles without theme.set
        await window.electron?.store?.set?.('settings.interface.theme', theme);
        await window.electron?.floatingWindow?.notifySettingsChanged?.();
      }
    } catch (e) {
      console.warn('Failed to save theme:', e);
    }
  };

  // Only global (OS-level) shortcuts are configurable — the in-app keys were
  // decorative (nothing read settings.shortcuts for them). global: true routes
  // through Electron's globalShortcut and needs pause/resume during editing so
  // the user's chord doesn't trigger the action.
  const shortcutConfig = {
    screenshot: { label: t('shortcuts.screenshot'), global: true, icon: Camera },
    toggleWindow: { label: t('shortcuts.toggleWindow'), global: true, icon: AppWindow },
    floatingWindow: { label: t('shortcuts.floatingWindow'), global: true, icon: Layers },
    selectionTranslate: { label: t('shortcuts.selectionTranslate'), global: true, icon: Pencil },
    floatingCapture: { label: t('shortcuts.floatingCapture'), global: true, icon: ScanLine },
  };

  const startEditing = async (action, config) => {
    if (config.global && window.electron?.shortcuts?.pause) {
      await window.electron.shortcuts.pause(action);
    }
    setEditingShortcut(action);
  };

  const cancelEditing = async (action, config) => {
    setEditingShortcut(null);
    if (config.global && window.electron?.shortcuts?.resume) {
      await window.electron.shortcuts.resume(action);
    }
  };

  const finishEditing = async (action, config, newShortcut) => {
    setEditingShortcut(null);

    if (config.global && window.electron?.shortcuts?.update) {
      // Register with the OS first. The handler persists to store on success,
      // so we only mirror into React state (silently — already saved) if it
      // took; a rejected chord must not linger in state and get written later.
      const result = await window.electron.shortcuts.update(action, newShortcut);
      if (result?.success) {
        updateSetting('shortcuts', action, newShortcut, true);
        notify(t('shortcuts.updated', { label: config.label, shortcut: newShortcut }), 'success');
      } else {
        notify(t('shortcuts.updateFailed', { error: result?.error || 'Unknown error' }), 'error');
        await window.electron.shortcuts.resume(action);
      }
    }
  };

  const resetShortcuts = () => {
    // Each update() call re-registers and persists to store, so this reset
    // takes effect immediately without going through the panel's save.
    setSettings(prev => ({ ...prev, shortcuts: { ...defaultConfig.shortcuts } }));
    if (window.electron?.shortcuts?.update) {
      Object.keys(defaultConfig.shortcuts).forEach(action => {
        window.electron.shortcuts.update(action, defaultConfig.shortcuts[action]);
      });
    }
    notify(t('shortcuts.reset'), 'success');
  };

  const themeOptions = [
    { value: 'light', icon: <Sun size={14} />, label: t('settings.general.themes.default') },
    { value: 'dark', icon: <Moon size={14} />, label: t('settings.general.themes.dark') },
    { value: 'fresh', icon: <Leaf size={14} />, label: t('settings.general.themes.fresh') },
  ];

  return (
    <div className="setting-content">
      <h3>{t('settings.general.title')}</h3>

      <div className="setting-group">
        <label className="setting-label">
          <Power size={16} />
          {t('settings.startup.title')}
        </label>
        <Switch
          checked={autoLaunch}
          disabled={autoLaunchLoading}
          onChange={toggleAutoLaunch}
          label={t('settings.startup.autoLaunch')}
        />
        {autoLaunch && (
          <Switch
            checked={settings.startup?.autoEnableSelection ?? false}
            onChange={toggleAutoSelection}
            label={t('settings.startup.autoSelection')}
          />
        )}
      </div>

      <div className="setting-group">
        <label className="setting-label">
          <Bell size={16} />
          {t('settings.notifications.title')}
        </label>
        <Switch
          checked={settings.interface?.systemNotifications ?? true}
          onChange={toggleSystemNotifications}
          label={t('settings.notifications.system')}
        />
      </div>

      <div className="setting-group">
        <label className="setting-label">
          <Globe size={16} />
          {t('settings.general.language')}
        </label>
        <Seg
          value={i18n.language}
          onChange={switchLanguage}
          options={LANGUAGES.map((lang) => ({ value: lang.code, label: lang.nativeName }))}
        />
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('settings.general.theme')}</label>
        <Seg
          value={settings.interface?.theme || 'light'}
          onChange={switchTheme}
          options={themeOptions}
        />
      </div>

      <div className="setting-group wide">
        <label className="setting-label">
          <Keyboard size={16} />
          {t('settings.shortcuts.title')}
        </label>

        <div className="shortcut-editor">
          {Object.entries({ ...defaultConfig.shortcuts, ...settings.shortcuts }).map(([action, shortcut]) => {
            const config = shortcutConfig[action];
            if (!config) return null;

            return (
              <div key={action} className={`shortcut-row ${config.global ? 'global' : ''}`}>
                <span className="shortcut-action">
                  {/* No per-row global badge: every configurable shortcut is
                      system-wide now, so the hint says it once instead. */}
                  <span className="shortcut-icon">{config.icon && <config.icon size={14} />}</span>
                  {config.label}
                </span>
                {editingShortcut === action ? (
                  <input
                    type="text"
                    className="shortcut-input"
                    value={shortcut}
                    autoFocus
                    onKeyDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();

                      if (e.key === 'Escape') {
                        cancelEditing(action, config);
                        return;
                      }

                      // Wait for the chord's final key before judging it.
                      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                        return;
                      }

                      // Without Ctrl/Alt/Win the binding would hijack the key
                      // system-wide (a bare Backspace here disabled the user's
                      // backspace everywhere). F1-F24 are safe to bind alone;
                      // the main process enforces the same rule on update.
                      const isFKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(e.key);
                      if (!e.ctrlKey && !e.altKey && !e.metaKey && !isFKey) {
                        notify(t('shortcuts.needsModifier'), 'error');
                        return;
                      }

                      const keys = [];
                      if (e.ctrlKey) keys.push('Ctrl');
                      if (e.altKey) keys.push('Alt');
                      if (e.shiftKey) keys.push('Shift');
                      if (e.metaKey) keys.push('Meta');
                      keys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);

                      finishEditing(action, config, keys.join('+'));
                    }}
                    onBlur={() => cancelEditing(action, config)}
                    placeholder={t('shortcuts.pressKey')}
                  />
                ) : (
                  <button
                    className="shortcut-key"
                    onClick={() => startEditing(action, config)}
                  >
                    {shortcut.split('+').map((k, i) => (
                      <kbd key={i}>{k}</kbd>
                    ))}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <button
          className="link-button"
          style={{marginTop: '12px'}}
          onClick={resetShortcuts}
        >
          <RefreshCw size={14} /> {t('shortcuts.resetDefault')}
        </button>
      </div>
    </div>
  );
};

export default InterfaceSection;
