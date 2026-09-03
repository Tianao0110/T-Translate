// AI actions settings. The app ships a framework plus two neutral built-ins;
// everything else is a prompt config the user imports. Nothing here executes
// code — an action is data (display name, where it appears, which prompt), and
// the import gate is config/ai-actions.js normalizeActionConfig.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Trash2, Lock } from 'lucide-react';

import { BUILTIN_AI_ACTIONS, normalizeActionConfig } from '@config/ai-actions';
import { resolveActionLabel } from '../../../services/ai-action-runner.js';
import AiActionIcon from '../../shared/AiActionIcon.jsx';

const SURFACE_KEYS = {
  selection: 'aiActions.surfaceSelection',
  screenshot: 'aiActions.surfaceScreenshot',
  floating: 'aiActions.surfaceFloating',
};

const AiActionsSection = ({ settings, updateSetting, notify, confirm }) => {
  const { t, i18n } = useTranslation();

  const imported = settings.aiActions?.imported || [];

  const describeWhere = (action) => {
    const surfaces = (action.trigger?.surfaces || [])
      .map((s) => (SURFACE_KEYS[s] ? t(SURFACE_KEYS[s]) : s))
      .join(' / ');
    const mode = action.trigger?.mode === 'understand'
      ? t('aiActions.inUnderstandMode')
      : '';
    return [surfaces, mode].filter(Boolean).join(' · ');
  };

  const handleImport = async () => {
    const picked = await window.electron?.dialog?.showOpenDialog?.({
      title: t('aiActions.importTitle'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!picked || picked.canceled || !picked.filePaths?.length) return;

    const read = await window.electron?.fs?.readJSON?.(picked.filePaths[0]);
    if (!read?.success) {
      notify(t('aiActions.importUnreadable', { error: read?.error || '' }), 'error');
      return;
    }

    // A file may hold one action or a list of them.
    const entries = Array.isArray(read.data) ? read.data : [read.data];
    const accepted = [];
    for (const entry of entries) {
      const { ok, action, error } = normalizeActionConfig(entry);
      if (!ok) {
        notify(t('aiActions.importRejected', { error }), 'error');
        return;
      }
      accepted.push(action);
    }

    // An id already in use is replaced, so re-importing a corrected file is an
    // update rather than a duplicate entry.
    const kept = imported.filter((a) => !accepted.some((n) => n.id === a.id));
    updateSetting('aiActions', 'imported', [...kept, ...accepted]);
    notify(t('aiActions.importOk', { count: accepted.length }), 'success');
  };

  const handleRemove = async (action) => {
    const label = resolveActionLabel(action, i18n.language);
    const ok = await confirm(t('aiActions.removeConfirm', { name: label }));
    if (!ok) return;
    updateSetting('aiActions', 'imported', imported.filter((a) => a.id !== action.id));
  };

  return (
    <div className="setting-content">
      <h3>{t('settings.aiActions.title')}</h3>

      <div className="setting-group">
        <label className="setting-label">{t('aiActions.builtinTitle')}</label>
        <div className="ai-action-list">
          {BUILTIN_AI_ACTIONS.map((action) => (
            <div className="ai-action-item" key={action.id}>
              <span className="ai-action-icon"><AiActionIcon name={action.icon} size={15} /></span>
              <div className="ai-action-body">
                <div className="ai-action-name">
                  {resolveActionLabel(action, i18n.language)}
                  <Lock size={11} className="ai-action-lock" title={t('aiActions.builtinHint')} />
                </div>
                <div className="ai-action-meta">{describeWhere(action)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('aiActions.longForm')}</label>
        <input
          type="number"
          className="setting-input small"
          value={settings.aiActions?.longFormChars ?? 150}
          onChange={(e) => updateSetting(
            'aiActions', 'longFormChars',
            Math.min(2000, Math.max(10, parseInt(e.target.value) || 150))
          )}
          min="10"
          max="2000"
        />
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('aiActions.importedTitle')}</label>
        {imported.length === 0 ? (
          <div className="setting-hint-inline">{t('aiActions.importedEmpty')}</div>
        ) : (
          <div className="ai-action-list">
            {imported.map((action) => (
              <div className="ai-action-item" key={action.id}>
                <span className="ai-action-icon"><AiActionIcon name={action.icon} size={15} /></span>
                <div className="ai-action-body">
                  <div className="ai-action-name">{resolveActionLabel(action, i18n.language)}</div>
                  <div className="ai-action-meta">{describeWhere(action)}</div>
                </div>
                <button
                  className="ai-action-remove"
                  onClick={() => handleRemove(action)}
                  title={t('aiActions.remove')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button className="ai-action-import" onClick={handleImport}>
          <Upload size={14} /> {t('aiActions.import')}
        </button>
      </div>
    </div>
  );
};

export default AiActionsSection;
