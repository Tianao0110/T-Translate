// src/components/SettingsPanel/sections/InterfaceSection.jsx
// 界面设置区块组件 - 从 SettingsPanel 拆分

import React from 'react';
import { Sun, Moon, Sparkles, RefreshCw } from 'lucide-react';
import { defaultConfig } from '../constants.js';

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
        // 降级：旧方式保存
        const currentSettings = await window.electron?.store?.get?.('settings') || {};
        currentSettings.interface = { ...currentSettings.interface, theme };
        await window.electron?.store?.set?.('settings', currentSettings);
        
        // 通知玻璃窗口刷新主题
        await window.electron?.glass?.notifySettingsChanged?.();
      }
    } catch (e) {
      console.warn('Failed to save theme:', e);
    }
  };
  // 快捷键配置
  const shortcutConfig = {
    translate: { label: '执行翻译', global: false, icon: '⏎' },
    swapLanguages: { label: '切换语言', global: false, icon: '🔄' },
    clear: { label: '清空内容', global: false, icon: '🗑️' },
    paste: { label: '粘贴文本', global: false, icon: '📋' },
    copy: { label: '复制结果', global: false, icon: '📄' },
    screenshot: { label: '截图翻译', global: true, icon: '📷' },
    toggleWindow: { label: '显示/隐藏窗口', global: true, icon: '🪟' },
    glassWindow: { label: '玻璃窗口', global: true, icon: '🔮' },
    selectionTranslate: { label: '划词翻译开关', global: true, icon: '✏️' },
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
        notify(`全局快捷键已更新: ${config.label} → ${newShortcut}`, 'success');
      } else {
        notify(`快捷键更新失败: ${result?.error || '未知错误'}`, 'error');
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
    notify('快捷键已重置为默认值', 'success');
  };

  return (
    <div className="setting-content">
      <h3>界面设置</h3>
      <p className="setting-description">自定义应用外观和显示效果</p>
      
      {/* 主题 */}
      <div className="setting-group">
        <label className="setting-label">主题</label>
        <div className="theme-selector">
          <button 
            className={`theme-option ${settings.interface.theme === 'light' ? 'active' : ''}`} 
            onClick={() => switchTheme('light')}
          >
            <Sun size={16}/>经典
          </button>
          <button 
            className={`theme-option ${settings.interface.theme === 'dark' ? 'active' : ''}`} 
            onClick={() => switchTheme('dark')}
          >
            <Moon size={16}/>深色
          </button>
          <button 
            className={`theme-option rainbow ${settings.interface.theme === 'rainbow' ? 'active' : ''}`} 
            onClick={() => switchTheme('rainbow')}
          >
            <Sparkles size={16}/>清新
          </button>
        </div>
        <p className="setting-hint">主题切换即时生效并自动保存</p>
      </div>

      {/* 快捷键设置 */}
      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <label className="setting-label">⌨️ 快捷键设置</label>
        <p className="setting-hint" style={{marginBottom: '12px'}}>
          点击快捷键可进行修改，按 Esc 取消。带 🌐 标记的为全局快捷键（系统级生效）
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
                    placeholder="按下快捷键..."
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
          <RefreshCw size={14} /> 重置为默认
        </button>
      </div>
    </div>
  );
};

export default InterfaceSection;
