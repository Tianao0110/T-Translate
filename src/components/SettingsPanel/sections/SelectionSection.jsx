// src/components/SettingsPanel/sections/SelectionSection.jsx
// 划词翻译设置区块组件 - 国际化版

import React, { useState } from 'react';
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
  const [showStickyWarning, setShowStickyWarning] = useState(false);

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

  // 切换 CapsLock 直出模式：首次开启时弹警告，之后静默
  const handleToggleSticky = () => {
    const current = !!settings.selection.stickyViaCapsLock;
    if (current) {
      // 关闭：直接关
      updateSetting('selection', 'stickyViaCapsLock', false);
      return;
    }
    // 开启：第一次弹警告，之后直接开
    if (settings.selection.stickyWarningShown) {
      updateSetting('selection', 'stickyViaCapsLock', true);
    } else {
      setShowStickyWarning(true);
    }
  };

  const confirmStickyWarning = () => {
    updateSetting('selection', 'stickyViaCapsLock', true);
    updateSetting('selection', 'stickyWarningShown', true);
    setShowStickyWarning(false);
  };

  const cancelStickyWarning = () => {
    setShowStickyWarning(false);
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

      {/* CapsLock 直出模式（二级开关：主开关关闭时隐藏） */}
      {settings.selection.enabled && (
        <div
          className="setting-group"
          style={{
            marginLeft: '16px',
            paddingLeft: '16px',
            borderLeft: '3px solid var(--border-primary, #e5e7eb)',
          }}
        >
          <label className="setting-label">{t('selection.stickyCapsLockLabel')}</label>
          <div className="toggle-wrapper">
            <button
              className={`toggle-button ${settings.selection.stickyViaCapsLock ? 'active' : ''}`}
              onClick={handleToggleSticky}
            >
              {settings.selection.stickyViaCapsLock ? t('common.on') : t('common.off')}
            </button>
            <span className="toggle-description">
              {t('selection.stickyCapsLockDesc')}
            </span>
          </div>
        </div>
      )}

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

      {/* CapsLock 直出模式首次开启警告弹窗（复用 .update-modal-* 样式） */}
      {showStickyWarning && (
        <div className="update-modal-overlay" onClick={cancelStickyWarning}>
          <div className="update-modal" onClick={(e) => e.stopPropagation()}>
            <div className="update-modal-header">
              <h3>{t('selection.stickyWarningTitle')}</h3>
            </div>
            <div className="update-modal-body">
              <p style={{ lineHeight: 1.6, margin: 0, whiteSpace: 'pre-line' }}>
                {t('selection.stickyWarningBody')}
              </p>
            </div>
            <div className="update-modal-footer">
              <button className="btn-secondary" onClick={cancelStickyWarning}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" onClick={confirmStickyWarning}>
                {t('selection.stickyWarningConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SelectionSection;
