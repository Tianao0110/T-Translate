// src/components/SettingsPanel/sections/SelectionSection.jsx
// 划词翻译设置区块组件 - 国际化版

import React from 'react';
import { useTranslation } from 'react-i18next';
import createLogger from '../../../utils/logger.js';

const logger = createLogger('Settings:Selection');

/**
 * 划词翻译设置区块
 */
const SelectionSection = ({
  settings,
  updateSetting,
  notify
}) => {
  const { t } = useTranslation();

  // 切换划词翻译开关
  const handleToggleSelection = async () => {
    try {
      const newState = await window.electron?.selection?.toggle?.();
      logger.debug('Selection toggle result:', newState);
      if (typeof newState === 'boolean') {
        updateSetting('selection', 'enabled', newState);
        notify(newState ? t('selection.enabled') : t('selection.disabled'), 'success');
      }
    } catch (e) {
      logger.error('Selection toggle error:', e);
      notify(t('selection.toggleFailed'), 'error');
    }
  };

  return (
    <div className="setting-content">
      <h3>{t('settings.selection.title')}</h3>
      <p className="setting-description">{t('selection.description')}</p>
      
      {/* 启用/禁用 */}
      <div className="setting-group">
        <label className="setting-label">{t('selection.enableSelection')}</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${settings.selection.enabled ? 'active' : ''}`}
            onClick={handleToggleSelection}
          >
            {settings.selection.enabled ? t('common.on') : t('common.off')}
          </button>
          <span className="toggle-description">
            {settings.selection.enabled ? t('selection.enabledDesc') : t('selection.disabledDesc')}
          </span>
        </div>
        <p className="setting-hint">
          {t('selection.shortcutHint', {shortcut: settings.shortcuts?.selectionTranslate || 'Ctrl+Shift+T'})}
        </p>
      </div>

      {/* 按钮自动消失时间 */}
      <div className="setting-group">
        <label className="setting-label">{t('selection.triggerTimeout')}</label>
        <div className="setting-row">
          <input
            type="range"
            className="setting-range"
            min="2000"
            max="10000"
            step="1000"
            value={settings.selection.triggerTimeout}
            onChange={(e) => updateSetting('selection', 'triggerTimeout', parseInt(e.target.value))}
          />
          <span className="range-value">{settings.selection.triggerTimeout / 1000}{t('selection.seconds')}</span>
        </div>
        <p className="setting-hint">{t('selection.triggerTimeoutHint')}</p>
      </div>

      {/* 默认显示原文 */}
      <div className="setting-group">
        <label className="setting-label">{t('selection.showSourceByDefault')}</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${settings.selection.showSourceByDefault ? 'active' : ''}`}
            onClick={() => updateSetting('selection', 'showSourceByDefault', !settings.selection.showSourceByDefault)}
          >
            {settings.selection.showSourceByDefault ? t('common.on') : t('common.off')}
          </button>
          <span className="toggle-description">
            {settings.selection.showSourceByDefault ? t('selection.showSourceOnDesc') : t('selection.showSourceOffDesc')}
          </span>
        </div>
      </div>

      {/* 复制后自动关闭 */}
      <div className="setting-group">
        <label className="setting-label">{t('selection.autoCloseOnCopy')}</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${settings.selection.autoCloseOnCopy ? 'active' : ''}`}
            onClick={() => updateSetting('selection', 'autoCloseOnCopy', !settings.selection.autoCloseOnCopy)}
          >
            {settings.selection.autoCloseOnCopy ? t('common.on') : t('common.off')}
          </button>
          <span className="toggle-description">
            {settings.selection.autoCloseOnCopy ? t('selection.autoCloseOnDesc') : t('selection.autoCloseOffDesc')}
          </span>
        </div>
      </div>

      {/* 窗口透明度 */}
      <div className="setting-group">
        <label className="setting-label">{t('selection.windowOpacity')}</label>
        <div className="setting-row">
          <input
            type="range"
            className="setting-range"
            min="60"
            max="100"
            value={settings.selection.windowOpacity || 95}
            onChange={(e) => updateSetting('selection', 'windowOpacity', parseInt(e.target.value))}
          />
          <span className="range-value">{settings.selection.windowOpacity || 95}%</span>
        </div>
        <p className="setting-hint">{t('selection.opacityHint')}</p>
      </div>

      {/* 截图翻译输出模式 */}
      <div className="setting-group">
        <label className="setting-label">{t('selection.screenshotOutput')}</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${(settings.screenshot?.outputMode || 'bubble') === 'bubble' ? 'active' : ''}`}
            onClick={() => updateSetting('screenshot', 'outputMode', 
              (settings.screenshot?.outputMode || 'bubble') === 'bubble' ? 'main' : 'bubble'
            )}
          >
            {(settings.screenshot?.outputMode || 'bubble') === 'bubble' ? t('selection.bubble') : t('selection.mainWindow')}
          </button>
          <span className="toggle-description">
            {(settings.screenshot?.outputMode || 'bubble') === 'bubble' 
              ? t('selection.bubbleDesc') 
              : t('selection.mainWindowDesc')}
          </span>
        </div>
        <p className="setting-hint">{t('selection.outputHint')}</p>
      </div>

      {/* 字符数限制 */}
      <div className="setting-group">
        <label className="setting-label">{t('selection.charLimit')}</label>
        <div className="setting-row double">
          <div className="input-with-label">
            <label>{t('selection.minChars')}</label>
            <input
              type="number"
              className="setting-input small"
              value={settings.selection.minChars}
              onChange={(e) => updateSetting('selection', 'minChars', parseInt(e.target.value) || 2)}
              min="1"
              max="10"
            />
          </div>
          <div className="input-with-label">
            <label>{t('selection.maxChars')}</label>
            <input
              type="number"
              className="setting-input small"
              value={settings.selection.maxChars}
              onChange={(e) => updateSetting('selection', 'maxChars', parseInt(e.target.value) || 500)}
              min="50"
              max="2000"
            />
          </div>
        </div>
        <p className="setting-hint">{t('selection.charLimitHint')}</p>
      </div>

      {/* 使用说明 */}
      <div className="setting-group">
        <label className="setting-label">{t('selection.instructions')}</label>
        <div className="help-box">
          <p><strong>{t('selection.workflow')}:</strong></p>
          <ol>
            <li>{t('selection.step1')}</li>
            <li>{t('selection.step2')}</li>
            <li>{t('selection.step3')}</li>
            <li>{t('selection.step4')}</li>
          </ol>
          <p style={{marginTop: '8px'}}><strong>{t('selection.quickActions')}:</strong></p>
          <ul>
            <li>{t('selection.action1')}</li>
            <li>{t('selection.action2')}</li>
            <li>{t('selection.action3')}</li>
            <li>{t('selection.action4')}</li>
            <li>{t('selection.action5')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SelectionSection;
