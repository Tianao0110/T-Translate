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
  selection: ['aiActions.surfaceSelection', '划词'],
  screenshot: ['aiActions.surfaceScreenshot', '主面板'],
  floating: ['aiActions.surfaceFloating', '悬浮窗'],
};

const AiActionsSection = ({ settings, updateSetting, notify, confirm }) => {
  const { t, i18n } = useTranslation();

  const imported = settings.aiActions?.imported || [];

  const describeWhere = (action) => {
    const surfaces = (action.trigger?.surfaces || [])
      .map((s) => t(...(SURFACE_KEYS[s] || [s, s])))
      .join(' / ');
    const mode = action.trigger?.mode === 'understand'
      ? t('aiActions.inUnderstandMode', '理解模式下')
      : '';
    return [surfaces, mode].filter(Boolean).join(' · ');
  };

  const handleImport = async () => {
    const picked = await window.electron?.dialog?.showOpenDialog?.({
      title: t('aiActions.importTitle', '导入 AI 动作配置'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!picked || picked.canceled || !picked.filePaths?.length) return;

    const read = await window.electron?.fs?.readJSON?.(picked.filePaths[0]);
    if (!read?.success) {
      notify(t('aiActions.importUnreadable', '文件读不出来：{{error}}').replace('{{error}}', read?.error || ''), 'error');
      return;
    }

    // A file may hold one action or a list of them.
    const entries = Array.isArray(read.data) ? read.data : [read.data];
    const accepted = [];
    for (const entry of entries) {
      const { ok, action, error } = normalizeActionConfig(entry);
      if (!ok) {
        notify(t('aiActions.importRejected', '配置不合规：{{error}}').replace('{{error}}', error), 'error');
        return;
      }
      accepted.push(action);
    }

    // An id already in use is replaced, so re-importing a corrected file is an
    // update rather than a duplicate entry.
    const kept = imported.filter((a) => !accepted.some((n) => n.id === a.id));
    updateSetting('aiActions', 'imported', [...kept, ...accepted]);
    notify(
      t('aiActions.importOk', '已导入 {{count}} 个动作，保存后生效').replace('{{count}}', accepted.length),
      'success'
    );
  };

  const handleRemove = async (action) => {
    const label = resolveActionLabel(action, i18n.language);
    const ok = await confirm(
      t('aiActions.removeConfirm', '确定移除「{{name}}」吗？').replace('{{name}}', label)
    );
    if (!ok) return;
    updateSetting('aiActions', 'imported', imported.filter((a) => a.id !== action.id));
  };

  return (
    <div className="setting-content">
      <h3>{t('settings.aiActions.title', 'AI 动作')}</h3>
      <p className="setting-description">
        {t('aiActions.description', '在看到的内容上做一层理解。一个动作就是一份提示词配置，不是代码——内置两个，其余靠导入。')}
      </p>

      <div className="setting-group">
        <label className="setting-label">{t('aiActions.builtinTitle', '内置动作')}</label>
        <div className="ai-action-list">
          {BUILTIN_AI_ACTIONS.map((action) => (
            <div className="ai-action-item" key={action.id}>
              <span className="ai-action-icon"><AiActionIcon name={action.icon} size={15} /></span>
              <div className="ai-action-body">
                <div className="ai-action-name">
                  {resolveActionLabel(action, i18n.language)}
                  <Lock size={11} className="ai-action-lock" title={t('aiActions.builtinHint', '内置动作，随程序发布')} />
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
        <p className="setting-hint">{t('aiActions.longFormHint')}</p>
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('aiActions.importedTitle', '导入的动作')}</label>
        {imported.length === 0 ? (
          <div className="setting-hint-inline">{t('aiActions.importedEmpty', '还没有导入任何动作')}</div>
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
                  title={t('aiActions.remove', '移除')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button className="ai-action-import" onClick={handleImport}>
          <Upload size={14} /> {t('aiActions.import', '导入配置文件')}
        </button>
        <div className="setting-hint">
          {t('aiActions.importHint', 'JSON 文件，一个动作或一组动作。字段不合规会被拒绝并说明原因，提示词里只允许已知变量。')}
        </div>
      </div>
    </div>
  );
};

export default AiActionsSection;
