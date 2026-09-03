// Privacy mode picker + data-management actions.

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Shield, Lock, Trash2, ClipboardList, Database, Check, X, Minus, ArrowRightLeft, Download, Upload, Table2, ChevronLeft } from 'lucide-react';
import useTranslationStore from '../../../stores/translation-store';
import translationService from '../../../services/stack-client.js';
import { PRIVACY_MODES, PRIVACY_MODE_IDS } from '../constants.js';
import { PRIVACY_MODULES, PRIVACY_MODE_ORDER, moduleState } from '../../../utils/privacy-module-matrix.js';
import { buildMigrationPack, parseMigrationPack, stripSecrets, MAX_PACK_BYTES } from '../../../utils/migration-pack.js';
import { validateImportedActions, refreshImportedActions } from '../../../services/ai-action-store.js';
import { getAllProviderMetadata } from '../../../config/provider-icons.js';

const formatBytes = (bytes) => {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const PrivacySection = ({
  settings,
  updateSetting,
  notify,
  confirm,
  reloadSettings
}) => {
  const { t } = useTranslation();
  // Reactive subscription — nothing else re-renders this section on mode change
  const currentMode = useTranslationStore((s) => s.translationMode) || PRIVACY_MODE_IDS.STANDARD;
  const modeConfig = PRIVACY_MODES[currentMode];

  // PRIVACY_MODES stores icon names as strings (so the config file stays
  // pure data); resolve them to actual lucide components here.
  const getModeIcon = (iconName, size = 24) => {
    const icons = {
      'Zap': Zap,
      'Shield': Shield,
      'Lock': Lock,
    };
    const IconComponent = icons[iconName] || Zap;
    return <IconComponent size={size} />;
  };

  const getModeName = (modeId) => {
    const modeKeys = {
      [PRIVACY_MODE_IDS.STANDARD]: 'privacy.modes.standard',
      [PRIVACY_MODE_IDS.OFFLINE]: 'privacy.modes.offline',
      [PRIVACY_MODE_IDS.SECURE]: 'privacy.modes.incognito',
    };
    return t(modeKeys[modeId] || 'privacy.modes.standard');
  };

  // Matrix columns use the config ids ('secure'), the seg shows the user-facing
  // names ('无痕'). Same order everywhere.
  const modeIds = PRIVACY_MODE_ORDER;
  const stateIcon = (state) => (state === 'on' ? <Check size={12} /> : state === 'part' ? <Minus size={12} /> : <X size={12} />);
  // 'main' = mode picker + this mode's module list; 'detail' = the read-only
  // three-mode comparison behind the 详细 button.
  const [view, setView] = useState('main');

  // A cell is a pill (icon + one word) with a short reason under it when the
  // module is restricted; the full sentence lives in the tooltip only.
  const statePill = (m, mode) => {
    const state = moduleState(m, mode);
    const short = state === 'on' ? '' : t(`privacy.modules.${m}.${mode}Short`, { defaultValue: '' });
    return (
      <span className="pm-cell" title={t(`privacy.modules.${m}.${mode}`)}>
        <span className={`pm-pill ${state}`}>{stateIcon(state)}{t(`privacy.stateWord.${state}`)}</span>
        {short && <span className="pm-sub">{short}</span>}
      </span>
    );
  };

  // Storage footprint for the data-management panel. Counts come from the
  // store, sizes from localStorage scan + a main-process stat call.
  const [dataStats, setDataStats] = useState(null);

  const refreshDataStats = useCallback(async () => {
    const state = useTranslationStore.getState();

    let localStorageBytes = 0;
    let docProgressCount = 0;
    let docProgressBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const bytes = k.length + (localStorage.getItem(k)?.length || 0);
        localStorageBytes += bytes;
        // Document-translation resume blobs (dt_progress_<fingerprint>) carry
        // translated text — itemized so they're visible, not buried in the total.
        if (k.startsWith('dt_progress_')) {
          docProgressCount++;
          docProgressBytes += bytes;
        }
      }
    } catch { /* size stays 0 */ }

    let cacheCount = 0;
    try {
      cacheCount = (await translationService.getCacheStats())?.l2Stats?.total ?? 0;
    } catch { /* count stays 0 */ }

    const main = (await window.electron?.app?.getDataStats?.()) || {};
    const vault = (await window.electron?.historyVault?.status?.()) || null;

    setDataStats({
      historyCount: state.history.length,
      favoritesCount: state.favorites.length,
      cacheCount,
      localStorageBytes,
      docProgressCount,
      docProgressBytes,
      vaultAvailable: !!vault?.available,
      vaultFileSize: vault?.fileSize || 0,
      settingsFileSize: main.settingsFileSize || 0,
      logsDirSize: main.logsDirSize || 0,
    });
  }, []);

  useEffect(() => {
    refreshDataStats();
  }, [refreshDataStats]);

  // Mode change hits two places: translation-store (persisted; drives the
  // secure-mode history stash) and main process (offline gate + key access).
  const handleModeChange = (mode) => {
    useTranslationStore.getState().setTranslationMode(mode.id);
    window.electron?.privacy?.setMode?.(mode.id);
    notify(t('privacy.switchedTo', { mode: getModeName(mode.id) }), 'success');
  };

  const handleClearHistory = async () => {
    if (!(await confirm(t('privacy.clearHistoryConfirm')))) return;
    useTranslationStore.getState().clearHistory?.();
    notify(t('privacy.historyCleared'), 'success');
    refreshDataStats();
  };

  const handleClearAllData = async () => {
    if (!(await confirm(t('privacy.clearAllConfirm')))) return;
    localStorage.clear();
    // The encrypted history vault lives outside localStorage — clear it too.
    try { await window.electron?.historyVault?.clear?.(); } catch { /* best effort */ }
    window.electron?.store?.clear?.();
    window.location.reload();
  };

  const handleClearCache = async () => {
    if (!(await confirm(t('translationSettings.clearCacheConfirm')))) return;
    await translationService.clearCache();
    notify(t('translationSettings.cacheCleared'), 'success');
    refreshDataStats();
  };

  // ===== Migration pack =====

  // Parsed pack + per-block checkboxes; non-null renders the confirm modal.
  const [importState, setImportState] = useState(null);

  const handleExportPack = async () => {
    try {
      if (!window.electron?.store || !window.electron?.dialog?.saveFile) {
        notify(t('privacy.migration.needApp'), 'warning');
        return;
      }
      // Read the PERSISTED settings, never this panel's in-memory copy — the
      // panel decrypts OCR keys into its inputs, and those must not reach a
      // shareable file. The stored bucket is already key-free.
      const storedSettings = await window.electron.store.get('settings');
      const { favorites, customLanguages } = useTranslationStore.getState();
      const appVersion = (await window.electron?.app?.getVersion?.()) || '';
      const pack = buildMigrationPack({
        settings: storedSettings,
        favorites,
        customLanguages,
        appVersion,
        providersMeta: getAllProviderMetadata(),
      });
      const filename = `t-translate-migration-${new Date().toISOString().slice(0, 10)}.json`;
      const result = await window.electron.dialog.saveFile({
        defaultPath: filename,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        data: JSON.stringify(pack, null, 2),
      });
      if (result?.success) notify(t('privacy.migration.exported'), 'success');
      else if (result && !result.canceled) {
        notify(t('privacy.migration.exportFailed') + (result.error ? `: ${result.error}` : ''), 'error');
      }
    } catch (e) {
      notify(t('privacy.migration.exportFailed') + ': ' + e.message, 'error');
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after a failed try
    if (!file) return;
    if (file.size > MAX_PACK_BYTES) {
      notify(t('privacy.migration.tooLarge'), 'error');
      return;
    }
    try {
      const parsed = parseMigrationPack(await file.text());
      if (!parsed.ok) {
        notify(t(parsed.error === 'newer-version'
          ? 'privacy.migration.newerVersion'
          : 'privacy.migration.invalidFile'), 'error');
        return;
      }
      const s = parsed.summary;
      if (!s.settingsBuckets && !s.glossary && !s.favorites && !s.customLanguages) {
        notify(t('privacy.migration.emptyPack'), 'warning');
        return;
      }
      setImportState({
        ...parsed,
        checks: {
          settings: s.settingsBuckets > 0,
          glossary: s.glossary > 0,
          favorites: s.favorites > 0,
          customLanguages: s.customLanguages > 0,
        },
      });
    } catch (err) {
      notify(t('privacy.migration.invalidFile') + ': ' + err.message, 'error');
    }
  };

  const toggleImportCheck = (key) =>
    setImportState((prev) => prev && ({ ...prev, checks: { ...prev.checks, [key]: !prev.checks[key] } }));

  const applyImport = async () => {
    const { payload, checks } = importState;
    const results = [];
    try {
      if (checks.settings && payload.settings) {
        // Same defense as export: a hand-edited pack must not smuggle keys in.
        const clean = stripSecrets(payload.settings, getAllProviderMetadata());
        if (clean.aiActions) {
          clean.aiActions.imported = validateImportedActions(clean.aiActions.imported);
        }
        if (window.electron?.store) {
          // Per-bucket dot-path writes: buckets absent from the pack keep
          // their local values instead of being wiped by a whole-key set.
          for (const [bucket, value] of Object.entries(clean)) {
            await window.electron.store.set(`settings.${bucket}`, value);
          }
        }
        await refreshImportedActions();
        results.push(t('privacy.migration.appliedSettings', { count: Object.keys(clean).length }));
      }

      const store = useTranslationStore.getState();
      const seen = new Set((store.favorites || []).map((f) => `${f.sourceText} ${f.translatedText}`));
      const addUnique = (entry) => {
        const key = `${entry.sourceText} ${entry.translatedText}`;
        if (seen.has(key)) return false;
        seen.add(key);
        store.addToFavorites(entry);
        return true;
      };

      if (checks.glossary) {
        let added = 0;
        payload.glossary.forEach((term, i) => {
          if (addUnique({
            id: `mig_${Date.now()}_g${i}`,
            sourceText: term.source,
            translatedText: term.target,
            note: term.note,
            tags: term.tags,
            folderId: 'glossary',
            timestamp: Date.now(),
          })) added++;
        });
        results.push(t('privacy.migration.appliedGlossary', { count: added }));
      }

      if (checks.favorites) {
        let added = 0;
        payload.favorites.forEach((f, i) => {
          if (addUnique({ ...f, id: `mig_${Date.now()}_f${i}`, timestamp: Date.now() })) added++;
        });
        results.push(t('privacy.migration.appliedFavorites', { count: added }));
      }

      if (checks.customLanguages) {
        const before = useTranslationStore.getState().customLanguages.length;
        payload.customLanguages.forEach((l) => store.addCustomLanguage(l));
        const added = useTranslationStore.getState().customLanguages.length - before;
        results.push(t('privacy.migration.appliedLanguages', { count: added }));
      }

      // Multi-window take-effect path (same as a settings save).
      try { await window.electron?.floatingWindow?.notifySettingsChanged?.(); } catch { /* best effort */ }
      try { await translationService.reload?.(); } catch { /* best effort */ }
      await reloadSettings?.();
      refreshDataStats();

      setImportState(null);
      notify(t('privacy.migration.importDone', { detail: results.join(' / ') }), 'success');
    } catch (e) {
      notify(t('privacy.migration.importFailed') + ': ' + e.message, 'error');
    }
  };

  if (view === 'detail') {
    return (
      <div className="setting-content">
        <div className="audio-subhead">
          <button type="button" className="audio-back" onClick={() => setView('main')}>
            <ChevronLeft size={14} />{t('settings.privacy.title')}
          </button>
          <h3>{t('privacy.detailTitle')}</h3>
        </div>
        <table className="pm-table">
          <thead>
            <tr>
              <th></th>
              {modeIds.map((id) => (
                <th key={id} className={currentMode === id ? 'cur' : ''}>{t(`privacy.modeShort.${id}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRIVACY_MODULES.map((m) => (
              <tr key={m}>
                <td className="mod">{t(`privacy.modules.${m}.name`)}</td>
                {modeIds.map((id) => (
                  <td key={id} className={currentMode === id ? 'cur' : ''}>{statePill(m, id)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="setting-content">
      <div className="pm-head">
        <h3>{t('settings.privacy.title')}</h3>
        <button type="button" className="btn-small" onClick={() => setView('detail')}>
          <Table2 size={12} /><span style={{ marginLeft: 4 }}>{t('privacy.detail')}</span>
        </button>
      </div>

      {/* Mode picker: the house segmented style; the selected segment IS the
          current mode, so no separate banner. */}
      <div className="seg">
        {modeIds.map((id) => {
          const mode = PRIVACY_MODES[id];
          if (!mode) return null;
          return (
            <button
              key={id}
              type="button"
              className={currentMode === id ? 'on' : ''}
              onClick={() => handleModeChange(mode)}
            >
              {getModeIcon(mode.icon, 13)}
              {getModeName(id)}
            </button>
          );
        })}
      </div>

      {/* What this mode means per module: name + state pill (+ short reason) */}
      <div className="mode-features-panel">
        <h4><ClipboardList size={15} /> {t('privacy.featuresTitle')}</h4>
        <div className="feature-list">
          {PRIVACY_MODULES.map((m) => (
            <div key={m} className="feature-item pm-row">
              <span className="feature-name">{t(`privacy.modules.${m}.name`)}</span>
              {statePill(m, currentMode)}
            </div>
          ))}
        </div>
      </div>

      {/* Data management */}
      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <h4 style={{display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px', color: 'var(--text-primary)'}}><Database size={15} /> {t('privacy.dataManagement')}</h4>

        {dataStats && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '8px 16px',
            marginBottom: '16px',
            padding: '12px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            fontSize: '13px',
          }}>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.history')}</span><br/>{dataStats.historyCount} {t('privacy.stats.items')}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.favorites')}</span><br/>{dataStats.favoritesCount} {t('privacy.stats.items')}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.cache')}</span><br/>{dataStats.cacheCount} {t('privacy.stats.items')}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.historyStore')}</span><br/>{dataStats.vaultAvailable
              ? formatBytes(dataStats.vaultFileSize)
              : t('privacy.stats.plaintext')}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.docProgress')}</span><br/>{dataStats.docProgressCount} {t('privacy.stats.items')} · {formatBytes(dataStats.docProgressBytes)}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.localData')}</span><br/>{formatBytes(dataStats.localStorageBytes)}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.settingsFile')}</span><br/>{formatBytes(dataStats.settingsFileSize)}</div>
            <div><span style={{color: 'var(--text-secondary)'}}>{t('privacy.stats.logs')}</span><br/>{formatBytes(dataStats.logsDirSize)}</div>
          </div>
        )}

        <div className="setting-row">
          <span>{t('privacy.autoDeleteHistory')}</span>
          <div className="input-with-suffix">
            <input
              type="number"
              className="setting-input small"
              value={settings.privacy?.autoDeleteDays || 0}
              onChange={(e) => updateSetting('privacy', 'autoDeleteDays', parseInt(e.target.value) || 0)}
              min="0"
              max="365"
              disabled={currentMode === PRIVACY_MODE_IDS.SECURE}
            />
            <span className="input-suffix">{t('privacy.daysLater')}</span>
          </div>
        </div>
        <p className="setting-hint">
          {t('privacy.zeroMeansNever')}
          {currentMode === PRIVACY_MODE_IDS.SECURE ? t('privacy.incognitoDisabled') : ''}
        </p>
      </div>

      {/* Migration pack */}
      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <h4 style={{display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: 'var(--text-primary)'}}><ArrowRightLeft size={15} /> {t('privacy.migration.title')}</h4>
        <p className="setting-hint" style={{marginBottom: '12px'}}>{t('privacy.migration.hint')}</p>
        <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
          <button className="neutral-button" onClick={handleExportPack}>
            <Download size={16} /> {t('privacy.migration.export')}
          </button>
          <label className="neutral-button">
            <Upload size={16} /> {t('privacy.migration.import')}
            <input type="file" accept=".json" onChange={handleImportFile} style={{display: 'none'}} />
          </label>
        </div>
      </div>

      <div className="setting-group">
        <div className="danger-actions">
          <button className="danger-button" onClick={handleClearHistory}>
            <Trash2 size={16} /> {t('settings.privacy.clearHistory')}
          </button>
          <button className="danger-button" onClick={handleClearCache}>
            <Trash2 size={16} /> {t('translationSettings.clearCache')}
          </button>
          <button className="danger-button" onClick={handleClearAllData}>
            <Trash2 size={16} /> {t('settings.privacy.clearAll')}
          </button>
        </div>
      </div>

      {importState && (
        <div className="migration-modal-overlay" onClick={() => setImportState(null)}>
          <div className="migration-modal" onClick={(e) => e.stopPropagation()}>
            <h4><ArrowRightLeft size={15} /> {t('privacy.migration.importTitle')}</h4>
            <div className="migration-meta">
              {t('privacy.migration.packMeta', {
                version: importState.meta.appVersion || '?',
                date: importState.meta.exportedAt ? importState.meta.exportedAt.slice(0, 10) : '?',
              })}
            </div>
            <div className="migration-rows">
              {importState.summary.settingsBuckets > 0 && (
                <label className="setting-toggle">
                  <input type="checkbox" checked={importState.checks.settings} onChange={() => toggleImportCheck('settings')} />
                  <span>
                    {t('privacy.migration.blockSettings', { count: importState.summary.settingsBuckets })}
                    {importState.summary.importedActions > 0
                      ? t('privacy.migration.blockSettingsActions', { count: importState.summary.importedActions })
                      : ''}
                  </span>
                </label>
              )}
              {importState.summary.glossary > 0 && (
                <label className="setting-toggle">
                  <input type="checkbox" checked={importState.checks.glossary} onChange={() => toggleImportCheck('glossary')} />
                  <span>{t('privacy.migration.blockGlossary', { count: importState.summary.glossary })}</span>
                </label>
              )}
              {importState.summary.favorites > 0 && (
                <label className="setting-toggle">
                  <input type="checkbox" checked={importState.checks.favorites} onChange={() => toggleImportCheck('favorites')} />
                  <span>{t('privacy.migration.blockFavorites', { count: importState.summary.favorites })}</span>
                </label>
              )}
              {importState.summary.customLanguages > 0 && (
                <label className="setting-toggle">
                  <input type="checkbox" checked={importState.checks.customLanguages} onChange={() => toggleImportCheck('customLanguages')} />
                  <span>{t('privacy.migration.blockLanguages', { count: importState.summary.customLanguages })}</span>
                </label>
              )}
            </div>
            <div className="migration-actions">
              <button className="neutral-button" onClick={() => setImportState(null)}>
                <X size={16} /> {t('common.cancel')}
              </button>
              <button
                className="neutral-button"
                disabled={!Object.values(importState.checks).some(Boolean)}
                onClick={applyImport}
              >
                <Check size={16} /> {t('privacy.migration.applyImport')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrivacySection;
