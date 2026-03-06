// src/components/SettingsPanel/sections/InterfaceSection.jsx
// 界面设置区块组件 - 从 SettingsPanel 拆分

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Leaf, RefreshCw, Globe } from 'lucide-react';
import { defaultConfig } from '../constants.js';

// 可用语言列表
const LANGUAGES = [
  { code: 'zh', name: '简体中文', nativeName: '简体中文' },
  { code: 'en', name: 'English', nativeName: 'English' }
];

/**
 * 界面设置区块
 */
const InterfaceSection = ({
  settings,
  updateSetting,
  setSettings,
  notify,
  editingShortcut,
  setEditingShortcut,
  saveSettings  // 新增：保存设置函数
}) => {
  const { t, i18n } = useTranslation();
  
  // 切换界面语言
  const switchLanguage = async (langCode) => {
    i18n.changeLanguage(langCode);
    // 更新本地状态
    updateSetting('interface', 'language', langCode);
    // 立即写入 store（点路径，不读取整个 settings）
    try {
      await window.electron?.store?.set('settings.interface.language', langCode);
    } catch (e) {
      console.warn('Failed to save language to store:', e);
    }
    notify(t('settings.general.langSwitched', langCode === 'zh' ? '界面语言已切换' : 'Language changed'), 'success');
  };
  
  // 切换主题并立即保存（确保子窗口同步）
  const switchTheme = async (theme) => {
    // 1. 更新本地状态
    updateSetting('interface', 'theme', theme);
    
    // 2. 更新 DOM
    document.documentElement.setAttribute('data-theme', theme);
    
    // 3. 同步到 localStorage（确保页面刷新/截图后主题不丢失）
    localStorage.setItem('theme', theme);
    
    // 4. 使用统一的 theme IPC 广播到所有窗口
    try {
      if (window.electron?.theme?.set) {
        await window.electron.theme.set(theme);
      } else {
        // 降级：点路径直接写入
        await window.electron?.store?.set?.('settings.interface.theme', theme);
        
        // 通知玻璃窗口刷新主题
        await window.electron?.glass?.notifySettingsChanged?.();
      }
    } catch (e) {
      console.warn('Failed to save theme:', e);
    }
  };
  // 快捷键配置
  const shortcutConfig = {
    translate: { label: t('shortcuts.translate'), global: false, icon: '⏎' },
    swapLanguages: { label: t('shortcuts.swapLanguages'), global: false, icon: '🔄' },
    clear: { label: t('shortcuts.clear'), global: false, icon: '🗑️' },
    paste: { label: t('shortcuts.paste'), global: false, icon: '📋' },
    copy: { label: t('shortcuts.copy'), global: false, icon: '📄' },
    screenshot: { label: t('shortcuts.screenshot'), global: true, icon: '📷' },
    toggleWindow: { label: t('shortcuts.toggleWindow'), global: true, icon: '🪟' },
    glassWindow: { label: t('shortcuts.glassWindow'), global: true, icon: '🔮' },
    selectionTranslate: { label: t('shortcuts.selectionTranslate'), global: true, icon: '✏️' },
  };

  // 开始编辑快捷键
  const startEditing = async (action, config) => {
    if (config.global && window.electron?.shortcuts?.pause) {
      await window.electron.shortcuts.pause(action);
    }
    setEditingShortcut(action);
  };

  // 取消编辑
  const cancelEditing = async (action, config) => {
    setEditingShortcut(null);
    if (config.global && window.electron?.shortcuts?.resume) {
      await window.electron.shortcuts.resume(action);
    }
  };

  // 完成编辑
  const finishEditing = async (action, config, newShortcut) => {
    updateSetting('shortcuts', action, newShortcut);
    setEditingShortcut(null);
    
    if (config.global && window.electron?.shortcuts?.update) {
      const result = await window.electron.shortcuts.update(action, newShortcut);
      if (result?.success) {
        notify(t('shortcuts.updated', { label: config.label, shortcut: newShortcut }), 'success');
      } else {
        notify(t('shortcuts.updateFailed', { error: result?.error || 'Unknown error' }), 'error');
        await window.electron.shortcuts.resume(action);
      }
    }
  };

  // 重置所有快捷键
  const resetShortcuts = () => {
    updateSetting('shortcuts', null, defaultConfig.shortcuts);
    setSettings(prev => ({ ...prev, shortcuts: defaultConfig.shortcuts }));
    if (window.electron?.shortcuts?.update) {
      ['screenshot', 'toggleWindow', 'glassWindow', 'selectionTranslate'].forEach(action => {
        window.electron.shortcuts.update(action, defaultConfig.shortcuts[action]);
      });
    }
    notify(t('shortcuts.reset'), 'success');
  };

  return (
    <div className="setting-content">
      <h3>{t('settings.general.title')}</h3>
      <p className="setting-description">{t('settings.general.themeDesc')}</p>
      
      {/* 界面语言 */}
      <div className="setting-group">
        <label className="setting-label">
          <Globe size={16} style={{marginRight: '6px', verticalAlign: 'middle'}} />
          {t('settings.general.language')}
        </label>
        <div className="language-selector">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              className={`language-option ${i18n.language === lang.code ? 'active' : ''}`}
              onClick={() => switchLanguage(lang.code)}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
        <p className="setting-hint">{t('settings.general.languageDesc')}</p>
      </div>
      
      {/* 主题 */}
      <div className="setting-group">
        <label className="setting-label">{t('settings.general.theme')}</label>
        <div className="theme-selector">
          <button 
            className={`theme-option ${settings.interface.theme === 'light' ? 'active' : ''}`} 
            onClick={() => switchTheme('light')}
          >
            <Sun size={16}/>{t('settings.general.themes.default')}
          </button>
          <button 
            className={`theme-option ${settings.interface.theme === 'dark' ? 'active' : ''}`} 
            onClick={() => switchTheme('dark')}
          >
            <Moon size={16}/>{t('settings.general.themes.dark')}
          </button>
          <button 
            className={`theme-option fresh ${settings.interface.theme === 'fresh' ? 'active' : ''}`} 
            onClick={() => switchTheme('fresh')}
          >
            <Leaf size={16}/>{t('settings.general.themes.fresh')}
          </button>
        </div>
        <p className="setting-hint">{t('settings.general.themeDesc')}</p>
      </div>

      {/* 快捷键设置 */}
      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <label className="setting-label">⌨️ {t('settings.shortcuts.title')}</label>
        <p className="setting-hint" style={{marginBottom: '12px'}}>
          {t('shortcuts.hint')}
        </p>
        
        <div className="shortcut-editor">
          {Object.entries({ ...defaultConfig.shortcuts, ...settings.shortcuts }).map(([action, shortcut]) => {
            const config = shortcutConfig[action];
            if (!config) return null;
            
            return (
              <div key={action} className={`shortcut-row ${config.global ? 'global' : ''}`}>
                <span className="shortcut-action">
                  <span className="shortcut-icon">{config.icon}</span>
                  {config.global && <span className="global-badge">🌐</span>}
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
                      
                      const keys = [];
                      if (e.ctrlKey) keys.push('Ctrl');
                      if (e.altKey) keys.push('Alt');
                      if (e.shiftKey) keys.push('Shift');
                      if (e.metaKey) keys.push('Meta');
                      
                      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
                      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                        keys.push(key);
                      }
                      
                      if (keys.length > 0 && !['Control', 'Alt', 'Shift', 'Meta'].includes(keys[keys.length - 1])) {
                        finishEditing(action, config, keys.join('+'));
                      }
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
