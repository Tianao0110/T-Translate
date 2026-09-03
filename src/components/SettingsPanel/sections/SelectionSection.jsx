// Selection-translate settings section.

import React from 'react';
import { useTranslation } from 'react-i18next';
import createLogger from '../../../utils/logger.js';
import { useConfirm } from '../../shared/ConfirmDialog.jsx';
import { Seg, Switch, Slider } from './shared';

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

  const sel = settings.selection;
  const outputMode = settings.screenshot?.outputMode || 'bubble';
  const opacity = sel.windowOpacity || 95;

  return (
    <div className="setting-content">
      <h3>{t('settings.selection.title')}</h3>

      <div className="setting-group">
        <label className="setting-label">{t('selection.enableSelection')}</label>
        <Switch
          checked={!!sel.enabled}
          onChange={() => handleToggleSelection()}
          label={t('selection.enableSelection')}
        />
        {sel.enabled && (
          <Switch
            checked={!!sel.stickyViaCapsLock}
            onChange={() => handleToggleSticky()}
            label={t('selection.stickyCapsLockLabel')}
          />
        )}
      </div>

      <div className="setting-group">
        <Switch
          checked={!!sel.showSourceByDefault}
          onChange={(on) => updateSetting('selection', 'showSourceByDefault', on)}
          label={t('selection.showSourceByDefault')}
        />
        <Switch
          checked={!!sel.autoCloseOnCopy}
          onChange={(on) => updateSetting('selection', 'autoCloseOnCopy', on)}
          label={t('selection.autoCloseOnCopy')}
        />
        <Switch
          checked={!!sel.rainbowWindow}
          onChange={(on) => updateSetting('selection', 'rainbowWindow', on)}
          label={t('selection.rainbowWindow')}
        />
      </div>

      <div className="setting-group">
        <div className="sliders">
          <Slider
            label={t('selection.triggerTimeout')}
            display={`${sel.triggerTimeout / 1000}${t('selection.seconds')}`}
            min={2000}
            max={10000}
            step={1000}
            value={sel.triggerTimeout}
            onChange={(v) => updateSetting('selection', 'triggerTimeout', Math.round(v))}
          />
          <Slider
            label={t('selection.windowOpacity')}
            display={`${opacity}%`}
            min={60}
            max={100}
            value={opacity}
            onChange={(v) => updateSetting('selection', 'windowOpacity', Math.round(v))}
          />
        </div>
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('selection.screenshotOutput')}</label>
        <Seg
          value={outputMode}
          onChange={(v) => updateSetting('screenshot', 'outputMode', v)}
          options={[
            { value: 'bubble', label: t('selection.bubble') },
            { value: 'main', label: t('selection.mainWindow') },
          ]}
        />
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('selection.charLimit')}</label>
        <div className="field-grid">
          <span>{t('selection.minChars')}</span>
          <input
            type="number"
            className="setting-input small"
            value={sel.minChars}
            onChange={(e) => updateSetting('selection', 'minChars', parseInt(e.target.value) || 2)}
            min="1"
            max="10"
          />
          <span>{t('selection.maxChars')}</span>
          <input
            type="number"
            className="setting-input small"
            value={sel.maxChars}
            onChange={(e) => updateSetting('selection', 'maxChars', parseInt(e.target.value) || 2000)}
            min="50"
            max="5000"
          />
        </div>
      </div>

      {confirmDialog}
    </div>
  );
};

export default SelectionSection;
