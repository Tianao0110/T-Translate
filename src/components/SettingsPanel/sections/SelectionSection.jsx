// Selection-translate settings section.

import React from 'react';
import { useTranslation } from 'react-i18next';
import createLogger from '../../../utils/logger.js';
import { useConfirm } from '../../shared/ConfirmDialog.jsx';

const logger = createLogger('Settings:Selection');

const SelectionSection = ({
  settings,
  updateSetting,
  notify
}) => {
  const { t } = useTranslation();
  const [confirm, confirmDialog] = useConfirm();

  const handleToggleSelection = async () => {
    try {
      const result = await window.electron?.selection?.toggle?.();
      logger.debug('Selection toggle result:', result);
      // result is { enabled, error } (legacy boolean tolerated).
      const enabled = typeof result === 'object' ? result?.enabled : result;
      const error = typeof result === 'object' ? result?.error : null;

      if (error) {
        // e.g. the native hook failed to start — surface it, don't claim success.
        notify(t('selection.enableFailed'), 'error');
        updateSetting('selection', 'enabled', false);
        return;
      }
      if (typeof enabled === 'boolean') {
        updateSetting('selection', 'enabled', enabled);
        notify(enabled ? t('selection.enabled') : t('selection.disabledDesc'), 'success');
      }
    } catch (e) {
      logger.error('Selection toggle error:', e);
      notify(t('selection.toggleFailed'), 'error');
    }
  };

  // First-time opt-in shows a warning (CapsLock-direct can fire on accidental
  // key presses). After confirm, subsequent toggles are silent.
  const handleToggleSticky = async () => {
    const current = !!settings.selection.stickyViaCapsLock;
    if (current) {
      updateSetting('selection', 'stickyViaCapsLock', false);
      return;
    }
    if (settings.selection.stickyWarningShown) {
      updateSetting('selection', 'stickyViaCapsLock', true);
      return;
    }
    const ok = await confirm(
      `${t('selection.stickyWarningTitle')}\n\n${t('selection.stickyWarningBody')}`,
      { danger: false }
    );
    if (ok) {
      updateSetting('selection', 'stickyViaCapsLock', true);
      updateSetting('selection', 'stickyWarningShown', true);
    }
  };

  return (
    <div className="setting-content">
      <h3>{t('settings.selection.title')}</h3>
      <p className="setting-description">{t('selection.description')}</p>

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

      {/* Nested under master selection toggle — hidden when selection is off */}
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

      <div className="setting-group">
        <label className="setting-label">{t('selection.rainbowWindow')}</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${settings.selection.rainbowWindow ? 'active' : ''}`}
            onClick={() => updateSetting('selection', 'rainbowWindow', !settings.selection.rainbowWindow)}
          >
            {settings.selection.rainbowWindow ? t('common.on') : t('common.off')}
          </button>
          <span className="toggle-description">
            {settings.selection.rainbowWindow ? t('selection.rainbowOnDesc') : t('selection.rainbowOffDesc')}
          </span>
        </div>
      </div>

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
              onChange={(e) => updateSetting('selection', 'maxChars', parseInt(e.target.value) || 2000)}
              min="50"
              max="5000"
            />
          </div>
        </div>
        <p className="setting-hint">{t('selection.charLimitHint')}</p>
      </div>

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

      {confirmDialog}
    </div>
  );
};

export default SelectionSection;
